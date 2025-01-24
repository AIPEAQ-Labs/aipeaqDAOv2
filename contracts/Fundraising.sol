// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import { PeaqNFT, NftTypes } from "./PeaqNFT.sol";

contract FundraisingCenter is AccessControl, ReentrancyGuard, NftTypes {
    using Counters for Counters.Counter;

    // Roles
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");

    // Config variables
    uint256 public maxStartTime;
    uint256 public maxDuration;
    mapping(NftType => uint256) public nftDurations;

    PeaqNFT public nftContract;

    enum Status {
        CREATION,
        CANCELLED,
        OPEN,
        FAILED,
        SUCCESS
    }

    struct User {
        mapping(NftType => uint256) contributions; // number of NFTs bought
        uint256 totalValue;
        bool refunded;
        bool fullClaimed;
        uint256 claimedCount;
        uint256 totalContribution;
    }

    struct Fundraising {
        address moderator;
        uint256 startTime;
        uint256 targetTime;
        uint256 targetAmount;
        mapping(NftType => uint256) basePrices;
        mapping(NftType => uint256) maxBuyAmounts;
        Status status;
        
        uint256 totalContribution;
        bool fundClaimed;
        mapping(address => User) users;
        mapping(address => bool) whitelist;
        mapping(NftType => uint256) boughtAmounts;
    }

    mapping(uint256 => Fundraising) public fundraisings;
    Counters.Counter private _fundraisingIdCounter;

    event FundraisingCreated(uint256 indexed fundraisingId, address indexed moderator, uint256 startTime, uint256 duration, uint256 targetAmount);
    event FundraisingCancelled(uint256 indexed fundraisingId);
    event ContributionMade(uint256 indexed fundraisingId, address indexed user, BuyAmount[] amounts);
    event RefundClaimed(uint256 indexed fundraisingId, address indexed user, uint256 amount);
    event FundClaimed(uint256 indexed fundraisingId, address indexed moderator, uint256 amount);
    event NftClaimed(uint256 indexed fundraisingId, address indexed user);
    event WhitelistUpdated(uint256 indexed fundraisingId, address indexed user, bool isAdded);
    event MaxStartTimeUpdated(uint256 newMaxStartTime);
    event MaxDurationUpdated(uint256 newMaxDuration);
    event BasePriceUpdated(uint256 indexed fundraisingId, NftType indexed nftType, uint256 newBasePrice);
    event NftDurationUpdated(NftType nftType, uint256 newDuration);
    event NftContractUpdated(address newNftContract);

    constructor(
        address nftContractAddress,
        uint256 _maxStartTime, 
        uint256 _maxDuration, 
        uint256 _legendaryDuration, 
        uint256 _epicDuration 
    ) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        nftContract = PeaqNFT(nftContractAddress);
        maxStartTime = _maxStartTime;
        maxDuration = _maxDuration;
        nftDurations[NftType.LEGENDARY] = _legendaryDuration;
        nftDurations[NftType.EPIC] = _epicDuration;
    }

    modifier onlyFundraisingModerator(uint256 fundraisingId) {
        require(fundraisings[fundraisingId].moderator == msg.sender, "only moderator");
        _;
    }

    /**
     * DEFAULT ADMIN FUNCTIONS
     */

    function setMaxStartTime(uint256 _maxStartTime) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxStartTime = _maxStartTime;
        emit MaxStartTimeUpdated(_maxStartTime);
    }

    function setMaxDuration(uint256 _maxDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxDuration = _maxDuration;
        emit MaxDurationUpdated(_maxDuration);
    }

    function setNftDuration(NftType nftType, uint256 duration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        nftDurations[nftType] = duration;
        emit NftDurationUpdated(nftType, duration);
    }

    function setNftContractAddress(address nftContractAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        nftContract = PeaqNFT(nftContractAddress);
        emit NftContractUpdated(nftContractAddress);
    }

    /**
     * FUNDRAISING MANAGEMENT FUNCTIONS
     */

    // Fundraising creation and cancellation
    function createFundraising(
        uint256 startTime, 
        uint256 duration, 
        uint256 targetAmount, 
        uint256 basePriceLegendary, 
        uint256 basePriceEpic, 
        uint256 basePriceCommon,
        uint256 maxBuyAmountLegendary,
        uint256 maxBuyAmountEpic
    ) external onlyRole(MODERATOR_ROLE) {
        require(startTime <= block.timestamp + maxStartTime, "Start time too late");
        require(duration <= maxDuration, "Duration too long");
        require(maxBuyAmountLegendary > 0 && maxBuyAmountEpic > 0, "invalid max buy amount");

        uint256 fundraisingId = _fundraisingIdCounter.current();
        _fundraisingIdCounter.increment();

        Fundraising storage newFundraising = fundraisings[fundraisingId];
        newFundraising.startTime = startTime;
        newFundraising.targetTime = startTime + duration;
        newFundraising.targetAmount = targetAmount;
        newFundraising.basePrices[NftType.LEGENDARY] = basePriceLegendary;
        newFundraising.basePrices[NftType.EPIC] = basePriceEpic;
        newFundraising.basePrices[NftType.COMMON] = basePriceCommon;
        newFundraising.maxBuyAmounts[NftType.LEGENDARY] = maxBuyAmountLegendary;
        newFundraising.maxBuyAmounts[NftType.EPIC] = maxBuyAmountEpic;
        newFundraising.maxBuyAmounts[NftType.COMMON] = type(uint256).max - maxBuyAmountLegendary - maxBuyAmountEpic;
        newFundraising.moderator = msg.sender;
        newFundraising.status = Status.CREATION;

        emit FundraisingCreated(fundraisingId, msg.sender, startTime, duration, targetAmount);
    }

    function setBasePrice(uint256 fundraisingId, NftType nftType, uint256 newBasePrice) external onlyFundraisingModerator(fundraisingId) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        require(_updateStatus(fundraising) == Status.CREATION, "Fundraising not in creation");
        fundraising.basePrices[nftType] = newBasePrice;
        emit BasePriceUpdated(fundraisingId, nftType, newBasePrice);
    }

    function cancelFundraising(uint256 fundraisingId) external onlyFundraisingModerator(fundraisingId) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        require(_updateStatus(fundraising) == Status.CREATION, "Fundraising not in creation");

        fundraising.status = Status.CANCELLED;
        emit FundraisingCancelled(fundraisingId);
    }

    // Whitelist management
    function addToWhitelist(uint256 fundraisingId, address user) external onlyFundraisingModerator(fundraisingId) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        fundraising.whitelist[user] = true;
        emit WhitelistUpdated(fundraisingId, user, true);
    }

    function removeFromWhitelist(uint256 fundraisingId, address user) external onlyFundraisingModerator(fundraisingId) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        fundraising.whitelist[user] = false;
        emit WhitelistUpdated(fundraisingId, user, false);
    }

    // Fund claiming
    function claimFund(uint256 fundraisingId) external nonReentrant onlyFundraisingModerator(fundraisingId) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        require(_updateStatus(fundraising) == Status.SUCCESS, "Fundraising not successful");
        require(!fundraising.fundClaimed, "already claimed");

        fundraising.fundClaimed = true;
        payable(fundraising.moderator).transfer(fundraising.totalContribution);

        emit FundClaimed(fundraisingId, msg.sender, fundraising.totalContribution);
    }

    /**
     * CONTRIBUTION FUNCTIONS
     */

    struct BuyAmount {
        NftType nftType;
        uint256 amount;
    }

    // Contribution logic
    function contribute(uint256 fundraisingId, uint256 number) external payable nonReentrant {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        require(_updateStatus(fundraising) == Status.OPEN, "Not open");

        BuyAmount[] memory amounts;
        uint256 totalValue;

        (amounts, totalValue) = _determineBuyAmounts(fundraising, number, block.timestamp);
        require(msg.value >= totalValue, "Invalid value");

        User storage user = fundraising.users[msg.sender];
        bool userWhitelisted = fundraising.whitelist[msg.sender];
        for (uint i; i < amounts.length; i++) {
            uint256 amount = amounts[i].amount;
            if (amount == 0) {
                continue;
            }

            NftType nftType = amounts[i].nftType;
            require(userWhitelisted || nftType != NftType.LEGENDARY, "Not whitelisted");            
            user.contributions[nftType] += amount;
            user.totalContribution += amount; 
            fundraising.boughtAmounts[nftType] += amount;
        }

        user.totalValue += totalValue;
        fundraising.totalContribution += totalValue;

        // refund if overpaid
        if (msg.value > totalValue) {
            payable(msg.sender).transfer(msg.value - totalValue);
        }

        emit ContributionMade(fundraisingId, msg.sender, amounts);
    }

    // @notice Determine the NFT type to buy based on the number of NFTs and the current time
    // @dev This function is called by the user to determine the NFT type to buy based on the number of NFTs and the current time
    // @param timestamp The front-end should pass the current timestamp, as the `contribute()` method always uses `block.timestamp`.
    // Many eth-client treat `block.timestamp` as zero in view functions, so the front-end should pass the current timestamp.
    function determineBuyAmounts(uint256 fundraisingId, uint256 number, uint256 timestamp) public view returns (BuyAmount[] memory amounts, uint256 totalValue) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        return _determineBuyAmounts(fundraising, number, timestamp);
    }

    function _determineBuyAmounts(Fundraising storage fundraising, uint256 number, uint256 timestamp) private view returns (BuyAmount[] memory amounts, uint256 totalValue) {
        require(number > 0, "Invalid number");        
        
        amounts = new BuyAmount[](4);
        totalValue = 0;

        // cache to memory
        uint256[] memory boughtAmounts = new uint256[](4);
        uint256[] memory maxBuyAmounts = new uint256[](4);
        for (uint8 i = uint8(NftType.COMMON); i <= uint8(NftType.LEGENDARY); i++) {
            NftType cType = NftType(i);
            boughtAmounts[i] = fundraising.boughtAmounts[cType];
            maxBuyAmounts[i] = fundraising.maxBuyAmounts[cType];
        }

        // calculate elapsed time
        uint256 elapsed = timestamp - fundraising.startTime;
        uint256 accum = 0;
        uint256 counter = 0;

        // loop through NFT types from legendary to common
        // and determine the amount to buy for each type
        // if the elapsed time is within the duration of the NFT type and the user has not bought the maximum amount
        // then the user can buy the NFT type, otherwise, move to the next type
        for (uint8 i = uint8(NftType.LEGENDARY); i >= uint8(NftType.COMMON); i--) {
            NftType cType = NftType(i);
            accum += nftDurations[cType];
            if (elapsed < accum) {
                for (uint8 j = i; j >= uint8(NftType.COMMON); j--) {
                    NftType jType = NftType(j);
                    uint256 remaining =  maxBuyAmounts[j] - boughtAmounts[j];
                    uint256 toBuy = number > remaining ? remaining : number;
                    if (toBuy == 0) {
                        continue;
                    }
                    amounts[counter++] = BuyAmount(jType, toBuy);
                    totalValue += toBuy * fundraising.basePrices[jType];
                    number -= toBuy;

                    if (number == 0) {
                        // set length of `amounts` to non-zero values
                        assembly {
                            mstore(amounts, counter)
                        }
                        return (amounts, totalValue);
                    }
                }
            }
        }

        // if the timestamp is in the last open phase, the user can only buy common NFTs
        amounts[0] = BuyAmount(NftType.COMMON, number);
        totalValue = number * fundraising.basePrices[NftType.COMMON];
        assembly {
            mstore(amounts, 1)
        }
        return (amounts, totalValue);
    }

    // @notice User claim refund 
    // @dev User can claim their refund if "fundraising is canceled" or "target is not reached and fundraising is over"
    function refund(uint256 fundraisingId) external nonReentrant {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        require(_updateStatus(fundraising) == Status.FAILED, "fundraising not failed");
        User storage user = fundraising.users[msg.sender];
        require(!user.refunded, "Already refunded");

        uint256 refundAmount;
        for (uint8 i = uint8(NftType.COMMON); i <= uint8(NftType.LEGENDARY); i++) {
            NftType cType = NftType(i);
            refundAmount += user.contributions[cType] * fundraising.basePrices[cType];
        }
        require(refundAmount > 0, "No refund available");

        user.refunded = true;
        payable(msg.sender).transfer(refundAmount);

        emit RefundClaimed(fundraisingId, msg.sender, refundAmount);
    }

    // @notice User claim NFTs after fundraising is over
    // @dev This function is called by the user to claim their NFTs after the target is reached and the fundraising is over.
    // If there is `out-of-gas` issue, use `claimNft(uint256, uint amount)` instead.
    function claimAllNft(uint256 fundraisingId) external nonReentrant {
        _claimNft(fundraisingId, type(uint256).max);
    }

    // @notice User claim NFTs in batches to avoid out-of-gas issues
    // @dev This function is called by the user to claim a specific amount of NFTs sequentially from common to legendary type.
    function claimNft(uint256 fundraisingId, uint256 amount) external nonReentrant {
        _claimNft(fundraisingId, amount);        
    }

    // @dev Internal function to claim NFTs
    function _claimNft(uint256 fundraisingId, uint256 amount) internal {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        require(_updateStatus(fundraising) == Status.SUCCESS, "Raise not success");

        User storage user = fundraising.users[msg.sender];
        require(!user.fullClaimed, "already claimed");

        uint256 claimed = user.claimedCount;
        uint256 accumContribution;
        uint256 totalContribution = user.totalContribution;
        for (uint8 i = uint8(NftType.COMMON); i <= uint8(NftType.LEGENDARY); i++) {
            NftType cType = NftType(i);
            // Check if user has any contribution for the NFT type
            accumContribution += user.contributions[cType];
            int256 available = int256(accumContribution) - int256(claimed);
            
            if (available > 0) {
                // Claim the minimum of the available NFTs and the requested amount
                uint256 toClaim = uint256(available) > amount ? amount : uint256(available);
                nftContract.mint(msg.sender, cType, uint16(toClaim));
                claimed += toClaim;
                amount -= toClaim;

                // If the user has claimed the requested amount or all of their contributions, exit the loop
                if (amount == 0 || claimed >= totalContribution) {
                    break;
                }
            }
        }
        
        // Update the user's claimed count and check if they have claimed all of their contributions
        user.claimedCount = claimed;
        if (user.claimedCount == user.totalContribution) {
            user.fullClaimed = true;
        }

        emit NftClaimed(fundraisingId, msg.sender);
    }

    function _updateStatus(Fundraising storage fundraising) internal returns (Status) {
        Status status = _calcStatus(fundraising);
        fundraising.status = status;
        return status;
    }

    function _calcStatus(Fundraising storage fundraising) internal view returns (Status) {
        if (fundraising.status == Status.CANCELLED || fundraising.status == Status.FAILED || fundraising.status == Status.SUCCESS) {
            return fundraising.status;
        }

        if (block.timestamp >= fundraising.targetTime) {
            if (isTargetReached(fundraising)) {
                return Status.SUCCESS;
            } else {
                return Status.FAILED;
            }
        }

        if (block.timestamp >= fundraising.startTime) {
            return Status.OPEN;
        }

        return fundraising.status;
    }

    function isTargetReached(Fundraising storage fundraising) internal view returns (bool) {
        return fundraising.totalContribution >= fundraising.targetAmount;
    }

    /**
     * GETTER FUNCTIONS
     */
    
    function getFundraisingStatus(uint256 fundraisingId) external view returns (Status) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        return _calcStatus(fundraising);
    }

    struct FundraisingInfo {
        address moderator;
        uint256 startTime;
        uint256 targetTime;
        uint256 targetAmount;
        uint256 totalContribution;
        bool fundClaimed;
    }

    function getFundraising(uint256 fundraisingId) external view returns (FundraisingInfo memory) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        FundraisingInfo memory info = FundraisingInfo(
            fundraising.moderator,
            fundraising.startTime,
            fundraising.targetTime,
            fundraising.targetAmount,
            fundraising.totalContribution,
            fundraising.fundClaimed
        );
        return info;
    }

    function getFundraisingBasePrice(uint256 fundraisingId, NftType nftType) external view returns (uint256) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        return fundraising.basePrices[nftType];
    }

    function getFundraisingMaxBuyAmount(uint256 fundraisingId, NftType nftType) external view returns (uint256) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        return fundraising.maxBuyAmounts[nftType];
    }

    function getFundraisingBoughtAmount(uint256 fundraisingId, NftType nftType) external view returns (uint256) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        return fundraising.boughtAmounts[nftType];
    }

    struct UserContribution {
        uint256 totalValue;
        uint256 totalContribution;
        uint256 claimedCount;
        bool refunded;
        bool fullClaimed;
        bool whitelisted;
    }

    function getUserContribution(uint256 fundraisingId, address user) external view returns (UserContribution memory) {
        Fundraising storage $fundraising = fundraisings[fundraisingId];
        User storage $user = $fundraising.users[user];
        return UserContribution(
            $user.totalValue,
            $user.totalContribution,
            $user.claimedCount,
            $user.refunded,
            $user.fullClaimed,
            $fundraising.whitelist[user]
        );
    }

    function getUserWhitelisted(uint256 fundraisingId, address user) external view returns (bool) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        return fundraising.whitelist[user];
    }

    function getUserContributionByType(uint256 fundraisingId, address user, NftType nftType) external view returns (uint256) {
        Fundraising storage fundraising = fundraisings[fundraisingId];
        User storage $user = fundraising.users[user];
        return $user.contributions[nftType];
    }
}
