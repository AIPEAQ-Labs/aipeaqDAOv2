// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";

// Abstract contract to share NftType
abstract contract NftTypes {
    enum NftType {
        NONE, 
        COMMON,
        EPIC, 
        LEGENDARY
    }
}

contract PeaqNFT is ERC721Upgradeable, AccessControlUpgradeable, NftTypes {
    using CountersUpgradeable for CountersUpgradeable.Counter;

    // Define roles
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_PERCENTAGE = 100_00; // denotes 100.00%

    // Track the next index for each type
    mapping(NftType => CountersUpgradeable.Counter) private _tokenTypeCounters;
    mapping(NftType => uint256) private _shareRevenuePercentages;

    event RevenueSharePercentageSet(NftType indexed nftType, uint256 percentage);

    function initialize() public initializer {
        __ERC721_init("PeaqNFT", "PNFT");
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // Generate token ID based on type and index
    // Format: [ZeroLeading (216 bits)][Type (8 bits)][Index (32 bits)]
    function _generateTokenId(NftType nftType, uint256 index) private pure returns (uint256) {
        return (uint256(nftType) << 32) | index;
    }

    // Mint function
    function mint(address who, NftType nftType, uint16 amount) external onlyRole(MINTER_ROLE) {
        for (uint16 i = 0; i < amount; i++) {
            uint256 index = _tokenTypeCounters[nftType].current();
            uint256 tokenId = _generateTokenId(nftType, index);
            _mint(who, tokenId);
            _tokenTypeCounters[nftType].increment();
        }
    }

    function setShareRevenuePercentage(NftType nftType, uint256 percentage) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(percentage <= MAX_PERCENTAGE, "PeaqNFT: Invalid percentage");
        _shareRevenuePercentages[nftType] = percentage;
        emit RevenueSharePercentageSet(nftType, percentage);
    }

    function getShareRevenuePercentage(NftType nftType) public view returns (uint256) {
        return _shareRevenuePercentages[nftType];
    }

    function getShareRevenuePercentageForToken(uint256 tokenId) public view returns (uint256) {
        NftType nftType = idToType(tokenId);
        return getShareRevenuePercentage(nftType);
    }

    function idToType(uint256 tokenId) public pure returns (NftType) {
        uint8 typeInt8 = uint8((tokenId >> 32) & 0xFF);
        return NftType(typeInt8);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable, ERC721Upgradeable) returns (bool) {
        return AccessControlUpgradeable.supportsInterface(interfaceId) || ERC721Upgradeable.supportsInterface(interfaceId);
    }
}
