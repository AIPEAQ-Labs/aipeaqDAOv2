import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, Signer } from "ethers";
import { FundraisingCenter, PeaqNFT } from "../typechain-types";
import { parse } from "dotenv";

const peaqType = {
    t0_none: 0,
    t1_common: 1,
    t3_epic: 2,
    t4_legendary: 3,
}

const peaqDuration = {
    t0_none: 0,
    t1_common: 0,
    t3_epic: 30 * 60, // 30 minutes
    t4_legendary: 10 * 60, // 10 minutes
}

const peaqPrice = {
    t1_common: ethers.parseEther("1"),
    t3_epic: ethers.parseEther("3"),
    t4_legendary: ethers.parseEther("4"),
}

const peaqMaxBuyAmount = {
    t1_common: BigInt(0),
    t3_epic: BigInt(5),
    t4_legendary: BigInt(3),
}

const targetAmount = peaqPrice.t1_common * BigInt(10) + peaqPrice.t3_epic * peaqMaxBuyAmount.t3_epic + peaqPrice.t4_legendary * peaqMaxBuyAmount.t4_legendary;

const fundrationStatus = {
    creation: 0,
    cancelled: 1,
    open: 2,
    failed: 3,
    success: 4,
}

let maxStartTime = 3 * 24 * 60 * 60;
let maxDuration = 3 * 24 * 60 * 60;

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

let fundraisingCenter: FundraisingCenter;
let peaqNFT: any;

describe("FundraisingCenter", function () {
    let admin: Signer;
    let moderator: Signer;
    let user1: Signer;
    let user2: Signer;
    let addresses: Signer[];

    before(async function () {
        [admin, moderator, user1, user2, ...addresses] = await ethers.getSigners();

        // Deploy PeaqNFT contract
        const PeaqNFT = await ethers.getContractFactory("PeaqNFT");
        peaqNFT = await upgrades.deployProxy(PeaqNFT, { initializer: "initialize" });
        expect(await peaqNFT.name()).to.equal("PeaqNFT");

        // Deploy FundraisingCenter contract
        const FundraisingCenter = await ethers.getContractFactory("FundraisingCenter");
        fundraisingCenter = await FundraisingCenter.connect(admin).deploy(
            await peaqNFT.getAddress(),
            maxStartTime,
            maxDuration,
            peaqDuration.t4_legendary,
            peaqDuration.t3_epic
        );
        // // await fundraisingCenter.deployed();
        await fundraisingCenter.waitForDeployment();

        // Grant MINTER_ROLE to the fundraisingCenter contract in PeaqNFT
        const MINTER_ROLE = await peaqNFT.MINTER_ROLE();
        await peaqNFT.connect(admin).grantRole(MINTER_ROLE, fundraisingCenter.getAddress());

        // Grant MODERATOR_ROLE to moderator in FundraisingCenter
        const MODERATOR_ROLE = await fundraisingCenter.MODERATOR_ROLE();
        await fundraisingCenter.connect(admin).grantRole(MODERATOR_ROLE, await moderator.getAddress());
    });

    describe("0. Test for config after contract creation", function () {
        it("should set the correct initial configuration", async function () {
            expect(await fundraisingCenter.maxStartTime()).to.equal(maxStartTime);
            expect(await fundraisingCenter.maxDuration()).to.equal(maxDuration);
            expect(await fundraisingCenter.nftDurations(peaqType.t1_common)).to.equal(peaqDuration.t1_common); // NONE
            expect(await fundraisingCenter.nftDurations(peaqType.t3_epic)).to.equal(peaqDuration.t3_epic); // EPIC
            expect(await fundraisingCenter.nftDurations(peaqType.t4_legendary)).to.equal(peaqDuration.t4_legendary); // LEGENDARY
        });
    });

    describe("1. Default admin functions", function () {
        it("should allow admin to update configurations", async function () {
            maxStartTime = 2 * 24 * 60 * 60;
            await fundraisingCenter.connect(admin).setMaxStartTime(maxStartTime);
            expect(await fundraisingCenter.maxStartTime()).to.equal(maxStartTime);
        });

        it("should emit events on admin updates", async function () {
            maxDuration = 2 * 24 * 60 * 60;
            await expect(fundraisingCenter.connect(admin).setMaxDuration(maxDuration))
                .to.emit(fundraisingCenter, "MaxDurationUpdated")
                .withArgs(maxDuration);
        });

        it("should prevent unauthorized access to admin functions", async function () {
            // 'AccessControl: account 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc is missing role 0x0000000000000000000000000000000000000000000000000000000000000000'
            await expect(
                fundraisingCenter.connect(user1).setMaxDuration(10 * 24 * 60 * 60)
            ).to.be.revertedWith(`AccessControl: account ${(await user1.getAddress()).toLocaleLowerCase()} is missing role ${ZERO_BYTES32}`);
        });
    });

    describe("2. Fundraising flow", function () {
        describe("2.1 Creation phase", function () {
            let snapshotId: string;

            beforeEach(async () => {
                snapshotId = await ethers.provider.send("evm_snapshot", []);
            });

            afterEach(async () => {
                await ethers.provider.send("evm_revert", [snapshotId]);
            });

            it("should allow moderator to create a fundraising with updated targetTime", async function () {
                const startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                const duration = 3600; // 1 hour

                await expect(createFundraising(moderator, startTime, duration, targetAmount))
                    .to.emit(fundraisingCenter, "FundraisingCreated")
                    .withArgs(
                        0, // Fundraising ID
                        await moderator.getAddress(),
                        startTime,
                        duration,
                        targetAmount
                    );

                // Verify the targetTime is correctly calculated and stored
                const fundraising = await fundraisingCenter.getFundraising(0);
                expect(fundraising.targetTime).to.equal(startTime + duration);
            });

            it("should reject fundraising with invalid timestamps", async function () {
                const startTime = Math.floor(Date.now() / 1000) + 4 * 24 * 60 * 60; // Start in 4 days
                const duration = 3600; // 1 hour

                await expect(createFundraising(moderator, startTime, duration, targetAmount)).to.be.revertedWith("Start time too late");
            });

            it("should allow the moderator to set basePrice for fundraising in CREATION phase", async function () {
                const startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                const duration = 3600; // 1 hour

                await createFundraising(moderator, startTime, duration, targetAmount);

                const newLegendayPrice = ethers.parseEther("2");
                await expect(fundraisingCenter.connect(moderator).setBasePrice(0, peaqType.t4_legendary, newLegendayPrice))
                    .to.emit(fundraisingCenter, "BasePriceUpdated")
                    .withArgs(0, peaqType.t4_legendary, newLegendayPrice);
            });

            it("should reject basePrice update when not in CREATION phase", async function () {
                const startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                const duration = 3600; // 1 hour

                await createFundraising(moderator, startTime, duration, targetAmount);

                // Simulate time passing for the fundraising to move to OPEN
                await ethers.provider.send("evm_increaseTime", [3601]);
                await ethers.provider.send("evm_mine", []);

                const newBasePrice = ethers.parseEther("0.5");
                await expect(
                    fundraisingCenter.connect(moderator).setBasePrice(0, peaqType.t4_legendary, newBasePrice)
                ).to.be.revertedWith("Fundraising not in creation");
            });
        });

        describe("2.2 Cancel phase", function () {
            let snapshotId: string;
            let fundraisingId: number;

            beforeEach(async function () {
                snapshotId = await ethers.provider.send("evm_snapshot", []);

                // Create a fundraising for cancel tests
                const startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                const duration = 3600; // 1 hour

                let tx = await createFundraising(moderator, startTime, duration, targetAmount);

                await expect(tx).to.emit(fundraisingCenter, "FundraisingCreated").withArgs(0, await moderator.getAddress(), startTime, duration, targetAmount);

                fundraisingId = 0; // First fundraising ID is 0
            });

            afterEach(async function () {
                await ethers.provider.send("evm_revert", [snapshotId]);
            });

            it("should allow moderator to cancel a fundraising in the CREATION phase", async function () {
                await expect(fundraisingCenter.connect(moderator).cancelFundraising(fundraisingId))
                    .to.emit(fundraisingCenter, "FundraisingCancelled")
                    .withArgs(fundraisingId);

                const status = await fundraisingCenter.getFundraisingStatus(fundraisingId);
                expect(status).to.equal(fundrationStatus.cancelled);
            });

            it("should prevent unauthorized users from cancelling a fundraising", async function () {
                await expect(
                    fundraisingCenter.connect(user1).cancelFundraising(fundraisingId)
                ).to.be.revertedWith(`only moderator`);
            });

            it("should not allow cancelling a fundraising in the OPEN phase", async function () {
                // Simulate time passing for the fundraising to move to OPEN
                await ethers.provider.send("evm_increaseTime", [3601]);
                await ethers.provider.send("evm_mine", []);

                await expect(
                    fundraisingCenter.connect(moderator).cancelFundraising(fundraisingId)
                ).to.be.revertedWith("Fundraising not in creation");
            });

            it("should emit an event when a fundraising is cancelled", async function () {
                await expect(fundraisingCenter.connect(moderator).cancelFundraising(fundraisingId))
                    .to.emit(fundraisingCenter, "FundraisingCancelled")
                    .withArgs(fundraisingId);
            });

            it("should not canncel double time", async function () {
                await expect(fundraisingCenter.connect(moderator).cancelFundraising(fundraisingId))
                    .to.emit(fundraisingCenter, "FundraisingCancelled")
                    .withArgs(fundraisingId);
                await expect(fundraisingCenter.connect(moderator).cancelFundraising(fundraisingId))
                    .to.be.revertedWith("Fundraising not in creation");
            });
        });

        describe("2.3 Open phase", function () {
            let fundraisingId: number;
            let startTime: number;
            let duration: number;

            let snapshotIdLevel2: string;
            before(async function () {
                snapshotIdLevel2 = await ethers.provider.send("evm_snapshot", []);
            });
            after(async function () {
                await ethers.provider.send("evm_revert", [snapshotIdLevel2]);
            });

            describe("2.3.1 Common check", function () {
                let snapshotId: string;
                let fundraisingId: number;

                beforeEach(async () => {
                    snapshotId = await ethers.provider.send("evm_snapshot", []);

                    startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                    duration = 7200; // 2 hour

                    let tx = await createFundraising(moderator, startTime, duration, targetAmount);

                    await expect(tx).to.emit(fundraisingCenter, "FundraisingCreated").withArgs(0, await moderator.getAddress(), startTime, duration, targetAmount);

                    fundraisingId = 0; // First fundraising ID is 0
                });

                afterEach(async () => {
                    await ethers.provider.send("evm_revert", [snapshotId]);
                });

                it("should not allow cancelling a fundraising in the OPEN phase", async function () {
                    // Simulate time passing for the fundraising to move to OPEN
                    await ethers.provider.send("evm_increaseTime", [3601]);
                    await ethers.provider.send("evm_mine", []);

                    await expect(
                        fundraisingCenter.connect(moderator).cancelFundraising(fundraisingId)
                    ).to.be.revertedWith("Fundraising not in creation");
                });

                it("should not allow claiming NFT, fund or refund in the OPEN phase", async function () {
                    // Simulate time passing for the fundraising to move to OPEN
                    await ethers.provider.send("evm_increaseTime", [3601]);
                    await ethers.provider.send("evm_mine", []);

                    await expect(fundraisingCenter.connect(user1).claimNft(fundraisingId, 1)).to.be.revertedWith("Raise not success");
                    await expect(fundraisingCenter.connect(moderator).claimFund(fundraisingId)).to.be.revertedWith("Fundraising not successful");
                    await expect(fundraisingCenter.connect(user1).refund(fundraisingId)).to.be.revertedWith("fundraising not failed");
                });

                it("should return 'open' phase after the start timestamp", async function () {
                    // Simulate time passing for the fundraising to move to OPEN
                    await ethers.provider.send("evm_increaseTime", [3601]);
                    await ethers.provider.send("evm_mine", []);

                    const status = await fundraisingCenter.getFundraisingStatus(fundraisingId);
                    expect(status).to.equal(fundrationStatus.open);
                });

                it("should only allow whitelisted users to mint in the first 10 minutes", async function () {
                    await fundraisingCenter.connect(moderator).addToWhitelist(fundraisingId, await user1.getAddress());

                    // Simulate time passing for the fundraising to move to OPEN
                    await ethers.provider.send("evm_increaseTime", [61]);
                    await ethers.provider.send("evm_mine", []);

                    let buyAmounts = [
                        [BigInt(peaqType.t4_legendary), BigInt(1)]
                    ]
                    await expect(fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t4_legendary }))
                        .to.emit(fundraisingCenter, "ContributionMade")
                        .withArgs(fundraisingId, await user1.getAddress(), buyAmounts);

                    await expect(fundraisingCenter.connect(user2).contribute(fundraisingId, 1, { value: peaqPrice.t4_legendary }))
                        .to.be.revertedWith("Not whitelisted");
                });
            });

            describe("2.3.2 Contribution and recognition", function () {
                before(async function () {
                    startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                    duration = 7200; // 2 hour

                    let tx = await createFundraising(moderator, startTime, duration, targetAmount);

                    await expect(tx).to.emit(fundraisingCenter, "FundraisingCreated").withArgs(0, await moderator.getAddress(), startTime, duration, targetAmount);

                    fundraisingId = 0;

                    let fundrasing = await fundraisingCenter.getFundraising(fundraisingId);
                    expect(fundrasing.targetAmount).to.equal(targetAmount);
                    expect(fundrasing.targetTime).to.equal(startTime + duration);
                    expect(fundrasing.startTime).to.equal(startTime);
                    expect(fundrasing.totalContribution).to.equal(0);
                    expect(fundrasing.moderator).to.equal(await moderator.getAddress());

                    expect(await fundraisingCenter.getFundraisingBasePrice(fundraisingId, peaqType.t4_legendary)).equal(peaqPrice.t4_legendary);
                    expect(await fundraisingCenter.getFundraisingBasePrice(fundraisingId, peaqType.t3_epic)).equal(peaqPrice.t3_epic);
                    expect(await fundraisingCenter.getFundraisingBasePrice(fundraisingId, peaqType.t1_common)).equal(peaqPrice.t1_common);
                    expect(await fundraisingCenter.getFundraisingMaxBuyAmount(fundraisingId, peaqType.t4_legendary)).equal(peaqMaxBuyAmount.t4_legendary);
                    expect(await fundraisingCenter.getFundraisingMaxBuyAmount(fundraisingId, peaqType.t3_epic)).equal(peaqMaxBuyAmount.t3_epic);
                });

                describe("Check fund raising status", function () {
                    it("should the status to be 'open' after the start timestamp", async function () {
                        // Simulate time passing for the fundraising to move to OPEN
                        await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + 1]);
                        await ethers.provider.send("evm_mine", []);

                        const status = await fundraisingCenter.getFundraisingStatus(fundraisingId);
                        expect(status).to.equal(fundrationStatus.open);

                        // get current block timestamp
                        const blockNumBefore = await ethers.provider.getBlockNumber();
                        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
                        const currentBlockTimestamp = blockBefore.timestamp;

                        let fundrasing = await fundraisingCenter.getFundraising(fundraisingId);

                        expect(currentBlockTimestamp).to.equal(startTime + 1);
                        expect(startTime).to.equal(parseInt(fundrasing.startTime));

                        console.log("Start time", startTime);
                    });
                });

                describe("Legendary NFTs", function () {
                    describe("Basic test", function () {
                        it("should not allow non-whitelisted users to mint in the first 10 minutes", async function () {
                            await fundraisingCenter.connect(moderator).addToWhitelist(fundraisingId, await user1.getAddress());
                            await expect(fundraisingCenter.connect(user2).contribute(fundraisingId, 1, { value: peaqPrice.t4_legendary }))
                                .to.be.revertedWith("Not whitelisted");
                        });

                        it("should recognize legendary type NFTs in the user's contribution in the first 10 minutes", async function () {
                            await fundraisingCenter.connect(moderator).addToWhitelist(fundraisingId, await user1.getAddress());
                            await fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t4_legendary });
                            const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t4_legendary);
                            expect(userContribution).to.equal(1);
                        });

                        it("should charge the correct native token amount", async function () {
                            await fundraisingCenter.connect(moderator).addToWhitelist(fundraisingId, await user1.getAddress());
                            let amounts = [
                                [BigInt(peaqType.t4_legendary), BigInt(1)]
                            ]
                            await expect(fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t4_legendary }))
                                .to.emit(fundraisingCenter, "ContributionMade")
                                .withArgs(fundraisingId, await user1.getAddress(), amounts);
                            const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t4_legendary);
                            expect(userContribution).to.equal(2);
                        });
                    });

                    describe("Whitelist contribute over target amount", function () {
                        let snapslotLevel4: string;
                        before(async function () {
                            snapslotLevel4 = await ethers.provider.send("evm_snapshot", []);
                        });

                        after(async function () {
                            await ethers.provider.send("evm_revert", [snapslotLevel4]);
                        });

                        it("should be able to contribute upto target amount", async function () {
                            let expectedAmounts = [
                                [BigInt(peaqType.t4_legendary), BigInt(1)],
                                [BigInt(peaqType.t3_epic), BigInt(5)],
                                [BigInt(peaqType.t1_common), BigInt(10)]
                            ]
                            await expect(fundraisingCenter.connect(user1).contribute(fundraisingId, 16, { value: peaqPrice.t4_legendary * BigInt(16) }))
                                .to.emit(fundraisingCenter, "ContributionMade")
                                .withArgs(fundraisingId, await user1.getAddress(), expectedAmounts);

                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t4_legendary)).equal(BigInt(3));
                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t3_epic)).equal(BigInt(5));
                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t1_common)).equal(BigInt(10));
                        });

                        it("should be able to contribute over target amount", async function () {
                            let expectedAmounts = [
                                [BigInt(peaqType.t1_common), BigInt(1)]
                            ]
                            await expect(fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t1_common }))
                                .to.emit(fundraisingCenter, "ContributionMade")
                                .withArgs(fundraisingId, await user1.getAddress(), expectedAmounts);

                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t4_legendary)).equal(BigInt(3));
                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t3_epic)).equal(BigInt(5));
                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t1_common)).equal(BigInt(11));
                        });
                    });

                    describe("Mint all max amounts of legendary, overpaid and change for epics", function () {
                        let snapslotLevel4: string;
                        let nextPhaseTimestamp: number;
                        beforeEach(async function () {
                            snapslotLevel4 = await ethers.provider.send("evm_snapshot", []);
                            nextPhaseTimestamp = startTime + peaqDuration.t4_legendary;
                        });

                        afterEach(async function () {
                            await ethers.provider.send("evm_revert", [snapslotLevel4]);
                        });

                        it("should determineBuyAmounts return correct amount", async function () {
                            let fund = await fundraisingCenter.getFundraising(fundraisingId);
                            let timestamp = await lastBlockTimestamp() + 1;
                            let buyAmounts = await fundraisingCenter.determineBuyAmounts(fundraisingId, BigInt(10 + 5 + 3 - 2), timestamp)

                            let expectedAmounts = [
                                [BigInt(peaqType.t4_legendary), BigInt(1)],
                                [BigInt(peaqType.t3_epic), BigInt(5)],
                                [BigInt(peaqType.t1_common), BigInt(10)]
                            ]

                            expect(buyAmounts.amounts[0].nftType).equal(peaqType.t4_legendary);
                            expect(buyAmounts.amounts[0].amount).equal(BigInt(1))
                            expect(buyAmounts.amounts[1].nftType).equal(peaqType.t3_epic);
                            expect(buyAmounts.amounts[1].amount).equal(BigInt(5))
                            expect(buyAmounts.amounts[2].nftType).equal(peaqType.t1_common);
                            expect(buyAmounts.amounts[2].amount).equal(BigInt(10))
                            expect(buyAmounts.totalValue).equal(BigInt(1) * peaqPrice.t4_legendary + BigInt(5) * peaqPrice.t3_epic + BigInt(10) * peaqPrice.t1_common);
                        });

                        it("should mint all max amounts of legendary, overpaid and change for epics", async function () {
                            let timestamp = await lastBlockTimestamp() + 1;
                            let buyAmounts = await fundraisingCenter.determineBuyAmounts(fundraisingId, BigInt(10 + 5 + 3 - 2), timestamp)

                            let expectedAmounts = [
                                [BigInt(peaqType.t4_legendary), BigInt(1)],
                                [BigInt(peaqType.t3_epic), BigInt(5)],
                                [BigInt(peaqType.t1_common), BigInt(10)]
                            ]

                            let sendValue = peaqPrice.t4_legendary * BigInt(16);
                            let actualValue = BigInt(1) * peaqPrice.t4_legendary + BigInt(5) * peaqPrice.t3_epic + BigInt(10) * peaqPrice.t1_common;
                            expect(buyAmounts.totalValue).equal(actualValue);
                            let beforeBalance = await ethers.provider.getBalance(await user1.getAddress());


                            let tx = await fundraisingCenter.connect(user1).contribute(fundraisingId, 16, { value: sendValue })
                            let txFee = (await tx.wait())?.fee;
                            await expect(tx)
                                .to.emit(fundraisingCenter, "ContributionMade")
                                .withArgs(fundraisingId, await user1.getAddress(), expectedAmounts);

                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t4_legendary)).equal(BigInt(3));
                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t3_epic)).equal(BigInt(5));
                            expect(await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t1_common)).equal(BigInt(10));;

                            let balanceAfter = await ethers.provider.getBalance(await user1.getAddress());
                            expect(beforeBalance - balanceAfter).equal(actualValue + txFee!);
                        })
                    });

                    describe("Mint before move to next phase of nft", function () {
                        let snapslotLevel4: string;
                        let nextPhaseTimestamp: number;
                        before(async function () {
                            snapslotLevel4 = await ethers.provider.send("evm_snapshot", []);
                            nextPhaseTimestamp = startTime + peaqDuration.t4_legendary;
                        });

                        after(async function () {
                            await ethers.provider.send("evm_revert", [snapslotLevel4]);
                        });

                        it("should mint ledenary in the last minute of the legendary phase", async function () {
                            await fundraisingCenter.connect(moderator).addToWhitelist(fundraisingId, await user1.getAddress());

                            // Simulate time passing for the fundraising to move to the legendary phase
                            // await ethers.provider.send("evm_setAutomine", [false]);
                            await ethers.provider.send("evm_setNextBlockTimestamp", [nextPhaseTimestamp - 1]);
                            await fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t4_legendary });

                            const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t4_legendary);
                            expect(userContribution).to.equal(3);
                        });

                        it("should not mint ledenary after the legendary phase", async function () {
                            // Simulate time passing for the fundraising to move to the legendary phase
                            // await ethers.provider.send("evm_setNextBlockTimestamp", [nextPhaseTimestamp]);
                            await ethers.provider.send("evm_setNextBlockTimestamp", [nextPhaseTimestamp]);
                            await fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t3_epic });

                            const legendContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t4_legendary);
                            expect(legendContribution).to.equal(3);
                            const epicContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t3_epic);
                            expect(epicContribution).to.equal(1);
                        });
                    });
                });

                describe("Epic NFTs", function () {
                    let epicPhaseTimestamp: number;
                    let rarePhaseTimestamp: number;

                    before(async function () {
                        epicPhaseTimestamp = startTime + peaqDuration.t4_legendary;
                        rarePhaseTimestamp = epicPhaseTimestamp + peaqDuration.t3_epic;
                    });

                    it("should whilelist user to mint in the next 30 minutes after legendary phase", async function () {
                        // Simulate time passing for the fundraising to move to the epic phase
                        await ethers.provider.send("evm_setNextBlockTimestamp", [epicPhaseTimestamp]);
                        await fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t3_epic });
                        const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t3_epic);
                        expect(userContribution).to.equal(1);
                    });

                    it("should non-whilelist user to mint in the next 30 minutes after legendary phase", async function () {
                        await fundraisingCenter.connect(user2).contribute(fundraisingId, 1, { value: peaqPrice.t3_epic });
                        const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user2.getAddress(), peaqType.t3_epic);
                        expect(userContribution).to.equal(1);
                    });

                    it("should mint the epic in the last minute of the epic phase", async function () {
                        // Simulate time passing for the fundraising to move to the epic phase
                        await ethers.provider.send("evm_setNextBlockTimestamp", [rarePhaseTimestamp - 1]);
                        await fundraisingCenter.connect(user2).contribute(fundraisingId, 1, { value: peaqPrice.t3_epic });
                        const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user2.getAddress(), peaqType.t3_epic);
                        expect(userContribution).to.equal(2);
                    });
                });

                describe("Common NFTs", function () {
                    let commonPhaseTimestamp: number;
                    let endTimestamp: number;

                    before(async function () {
                        commonPhaseTimestamp = startTime + peaqDuration.t4_legendary + peaqDuration.t3_epic;
                        endTimestamp = startTime + duration;
                    });

                    it("should recognize common type NFTs in the user's contribution after the next 60 minutes", async function () {
                        // Simulate time passing for the fundraising to move to the common phase
                        await ethers.provider.send("evm_setNextBlockTimestamp", [commonPhaseTimestamp]);
                        await ethers.provider.send("evm_mine", []);

                        await fundraisingCenter.connect(user1).contribute(fundraisingId, 1, { value: peaqPrice.t1_common });
                        let user1Contribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user1.getAddress(), peaqType.t1_common);
                        expect(user1Contribution).to.equal(1);

                        await fundraisingCenter.connect(user2).contribute(fundraisingId, 1, { value: peaqPrice.t1_common });
                        let user2Contribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user2.getAddress(), peaqType.t1_common);
                        expect(user2Contribution).to.equal(1);
                    });

                    it("should change if overpaid", async function () {
                        let timestamp = await lastBlockTimestamp() + 1;
                        let amount = BigInt(20);
                        let buyAmounts = await fundraisingCenter.determineBuyAmounts(fundraisingId, amount, timestamp)

                        let actualValue = peaqPrice.t1_common * amount;
                        expect(buyAmounts.totalValue).equal(actualValue);
                        expect(buyAmounts.amounts[0].nftType).equal(peaqType.t1_common);
                        expect(buyAmounts.amounts[0].amount).equal(amount);

                        let sendValue = actualValue * BigInt(2);
                        let balanceBefore = await ethers.provider.getBalance(await user2.getAddress());

                        let tx = await fundraisingCenter.connect(user2).contribute(fundraisingId, amount, { value: sendValue });
                        let txFee = (await tx.wait())?.fee;

                        const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user2.getAddress(), peaqType.t1_common);
                        expect(userContribution).to.equal(21);

                        let balanceAfter = await ethers.provider.getBalance(await user2.getAddress());
                        expect(balanceBefore - balanceAfter).equal(actualValue + txFee!);
                    });

                    it("should mint in the last minute of the open phase", async function () {
                        // Simulate time passing for the fundraising to move to the common phase
                        await ethers.provider.send("evm_setNextBlockTimestamp", [endTimestamp - 1]);
                        await fundraisingCenter.connect(user2).contribute(fundraisingId, 1, { value: peaqPrice.t1_common });
                        const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user2.getAddress(), peaqType.t1_common);
                        expect(userContribution).to.equal(22);
                    });

                    it("should not mint after the open phase", async function () {
                        // Simulate time passing for the fundraising to move to the common phase
                        await ethers.provider.send("evm_setNextBlockTimestamp", [endTimestamp]);
                        await expect(fundraisingCenter.connect(user2).contribute(fundraisingId, 1, { value: peaqPrice.t1_common }))
                            .to.be.revertedWith("Not open");
                        const userContribution = await fundraisingCenter.getUserContributionByType(fundraisingId, await user2.getAddress(), peaqType.t1_common);
                        expect(userContribution).to.equal(22);
                    });
                });
            });
        });

        describe("2.4 End phase", function () {
            describe("2.4.1 Fundraising successful, and claiming", function () {
                let fundraisingId: number;
                let startTime: number;
                let duration: number;

                let userCtrb = {
                    t4_legendary: Number(peaqMaxBuyAmount.t4_legendary),
                    t3_epic: Number(peaqMaxBuyAmount.t3_epic),
                    t1_common: 10,
                    total: Number(peaqMaxBuyAmount.t4_legendary) + Number(peaqMaxBuyAmount.t3_epic) + 10,
                }

                let snapshotIdLevel3: string;
                before(async function () {
                    snapshotIdLevel3 = await ethers.provider.send("evm_snapshot", []);

                    startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                    duration = 7200; // 2 hour

                    let tx = await createFundraising(moderator, startTime, duration, targetAmount);

                    fundraisingId = 0
                    await expect(tx).to.emit(fundraisingCenter, "FundraisingCreated").withArgs(fundraisingId, await moderator.getAddress(), startTime, duration, targetAmount);
                    let fund = await fundraisingCenter.getFundraising(fundraisingId);
                    expect(fund.targetAmount).to.equal(targetAmount);
                    console.log("fund.startTime", fund.startTime);
                    console.log("duration", duration);
                    console.log("fund.targetTime", fund.targetTime);
                    expect(fund.targetTime).to.equal(startTime + duration);
                    expect(fund.startTime).to.equal(startTime);
                    expect(fund.totalContribution).to.equal(0);
                    expect(fund.moderator).to.equal(await moderator.getAddress());

                    // Increase time to move to the open phase
                    await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);

                    // Whitelist user1
                    await fundraisingCenter.connect(moderator).addToWhitelist(0, await user1.getAddress());

                    // Contribute 3 legendary NFTs
                    await fundraisingCenter.connect(user1).contribute(0, userCtrb.t4_legendary, { value: peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) });

                    // Contribute 5 epic NFTs
                    await ethers.provider.send("evm_increaseTime", [peaqDuration.t4_legendary]);
                    await fundraisingCenter.connect(user1).contribute(0, userCtrb.t3_epic, { value: peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) });

                    // Contribute 10 common NFTs
                    await ethers.provider.send("evm_increaseTime", [peaqDuration.t3_epic]);
                    await fundraisingCenter.connect(user1).contribute(0, userCtrb.t1_common, { value: peaqPrice.t1_common * BigInt(userCtrb.t1_common) });
                });

                after(async function () {
                    await ethers.provider.send("evm_revert", [snapshotIdLevel3]);
                });

                describe("Common check", function () {
                    it("should user contribution correctly", async function () {
                        let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                        expect(userContribution.totalContribution).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);
                        expect(userContribution.totalValue).to.equal(peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common));
                        expect(userContribution.refunded).to.be.false;
                        expect(userContribution.fullClaimed).to.be.false;
                        expect(userContribution.claimedCount).to.equal(0);

                        let legendaryContribution = await fundraisingCenter.getUserContributionByType(0, await user1.getAddress(), peaqType.t4_legendary);
                        expect(legendaryContribution).to.equal(userCtrb.t4_legendary);
                        let epicContribution = await fundraisingCenter.getUserContributionByType(0, await user1.getAddress(), peaqType.t3_epic);
                        expect(epicContribution).to.equal(userCtrb.t3_epic);
                        let commonContribution = await fundraisingCenter.getUserContributionByType(0, await user1.getAddress(), peaqType.t1_common);
                        expect(commonContribution).to.equal(userCtrb.t1_common);
                    });

                    it("should user cannot claim before the end of the fundraising", async function () {
                        await expect(fundraisingCenter.connect(user1).claimAllNft(fundraisingId))
                            .to.be.revertedWith("Raise not success");
                    });

                    it("should fundraising status is 'open' before the end of the fundraising", async function () {
                        await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + duration - 1]);
                        await ethers.provider.send("evm_mine", []);
                        const status = await fundraisingCenter.getFundraisingStatus(fundraisingId);
                        expect(status).to.equal(fundrationStatus.open);
                    });

                    it("should fundraising status is 'success' after the end of the fundraising", async function () {
                        await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + duration]);
                        await ethers.provider.send("evm_mine", [])
                        const status = await fundraisingCenter.getFundraisingStatus(fundraisingId);
                        expect(status).to.equal(fundrationStatus.success);
                    });
                });

                describe("Claiming NFTs", function () {
                    describe("Claiming all NFTs", function () {
                        let snapshotIdLevel4: string;
                        before(async function () {
                            snapshotIdLevel4 = await ethers.provider.send("evm_snapshot", []);
                        });
                        after(async function () {
                            await ethers.provider.send("evm_revert", [snapshotIdLevel4]);
                        });

                        it("should not allow user refund after the end of the fundraising", async function () {
                            await expect(fundraisingCenter.connect(user1).refund(fundraisingId))
                                .to.be.revertedWith("fundraising not failed");
                        });

                        it("should allow user to claim all NFTs after the end of the fundraising", async function () {
                            let tx = await fundraisingCenter.connect(user1).claimAllNft(fundraisingId);
                            await expect(tx)
                                .to.emit(fundraisingCenter, "NftClaimed")
                                .withArgs(fundraisingId, await user1.getAddress());

                            let legendaryIds = generateTokenIds(peaqType.t4_legendary, 0, userCtrb.t4_legendary);
                            let epicIds = generateTokenIds(peaqType.t3_epic, 0, userCtrb.t3_epic);
                            let commonIds = generateTokenIds(peaqType.t1_common, 0, userCtrb.t1_common);

                            for (let i = 0; i < userCtrb.t4_legendary; i++) {
                                await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), legendaryIds[i]);
                                await expect(await peaqNFT.ownerOf(legendaryIds[i])).equal(await user1.getAddress());
                            }
                            for (let i = 0; i < userCtrb.t3_epic; i++) {
                                await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), epicIds[i]);
                                await expect(await peaqNFT.ownerOf(epicIds[i])).to.equal(await user1.getAddress());
                            }
                            for (let i = 0; i < userCtrb.t1_common; i++) {
                                await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), commonIds[i]);
                                await expect(await peaqNFT.ownerOf(commonIds[i])).to.equal(await user1.getAddress());
                            }

                            // Check NFT balances of user
                            let userNftBalance = await peaqNFT.balanceOf(await user1.getAddress());
                            expect(userNftBalance).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);

                            let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                            expect(userContribution.totalContribution).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);
                            expect(userContribution.totalValue).to.equal(peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common));
                            expect(userContribution.refunded).to.be.false;
                            expect(userContribution.fullClaimed).to.be.true;
                            expect(userContribution.claimedCount).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common)
                        });

                        it("should not allow user to claim all NFTs twice", async function () {
                            await expect(fundraisingCenter.connect(user1).claimAllNft(fundraisingId))
                                .to.be.revertedWith("already claimed");
                        });

                        it("should not allow user to refund after claiming all NFTs", async function () {
                            await expect(fundraisingCenter.connect(user1).refund(fundraisingId))
                                .to.be.revertedWith("fundraising not failed");
                        });
                    });

                    describe("Claiming NFTs by batch", function () {
                        let firstBatch: number;
                        let secondBatch: number;
                        let lastBatch: number;

                        before(async function () {
                            firstBatch = userCtrb.t1_common - 1;
                            secondBatch = 1 + userCtrb.t3_epic - 2;
                            lastBatch = userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common - firstBatch - secondBatch;
                            console.log("firstBatch", firstBatch);
                            console.log("secondBatch", secondBatch);
                            console.log("lastBatch", lastBatch);
                        });

                        describe("First batches", function () {
                            it("should allow user to claim NFTs by batch", async function () {
                                let tx = await fundraisingCenter.connect(user1).claimNft(fundraisingId, firstBatch);
                                await expect(tx)
                                    .to.emit(fundraisingCenter, "NftClaimed")
                                    .withArgs(fundraisingId, await user1.getAddress());

                                let commonIds = generateTokenIds(peaqType.t1_common, 0, firstBatch);

                                for (let i = 0; i < firstBatch; i++) {
                                    console.log(i, commonIds[i])
                                    await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), commonIds[i]);
                                    await expect(await peaqNFT.ownerOf(commonIds[i])).equal(await user1.getAddress());
                                };

                                let userNftBalance = await peaqNFT.balanceOf(await user1.getAddress());
                                expect(userNftBalance).to.equal(firstBatch);

                                let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                                expect(userContribution.totalContribution).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);
                                expect(userContribution.totalValue).to.equal(peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common));
                                expect(userContribution.refunded).to.be.false;
                                expect(userContribution.fullClaimed).to.be.false;
                                expect(userContribution.claimedCount).to.equal(firstBatch)
                            })

                            it("should allow user to claim NFTs by second batch", async function () {
                                let tx = await fundraisingCenter.connect(user1).claimNft(fundraisingId, secondBatch);
                                await expect(tx)
                                    .to.emit(fundraisingCenter, "NftClaimed")
                                    .withArgs(fundraisingId, await user1.getAddress());

                                let commonIds = generateTokenIds(peaqType.t1_common, firstBatch, 1);
                                let epicIds = generateTokenIds(peaqType.t3_epic, 0, secondBatch - 1);

                                await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), commonIds[0]);
                                console.log(commonIds[0])
                                await expect(await peaqNFT.ownerOf(commonIds[0])).equal(await user1.getAddress());
                                for (let i = 0; i < secondBatch - 1; i++) {
                                    console.log(i, epicIds[i])
                                    //     await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), epicIds[i]);
                                    await expect(await peaqNFT.ownerOf(epicIds[i])).equal(await user1.getAddress());
                                };

                                let userNftBalance = await peaqNFT.balanceOf(await user1.getAddress());
                                expect(userNftBalance).to.equal(firstBatch + secondBatch);

                                let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                                expect(userContribution.totalContribution).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);
                                expect(userContribution.totalValue).to.equal(peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common));
                                expect(userContribution.refunded).to.be.false;
                                expect(userContribution.fullClaimed).to.be.false;
                                expect(userContribution.claimedCount).to.equal(firstBatch + secondBatch)
                            });
                        });

                        describe("Last batch by batch", function () {
                            let snapshotIdLevel5: string;
                            before(async function () {
                                snapshotIdLevel5 = await ethers.provider.send("evm_snapshot", []);
                            });
                            after(async function () {
                                await ethers.provider.send("evm_revert", [snapshotIdLevel5]);
                            });

                            it("should allow user to claim NFTs by last batch", async function () {
                                let tx = await fundraisingCenter.connect(user1).claimNft(fundraisingId, lastBatch);
                                await expect(tx)
                                    .to.emit(fundraisingCenter, "NftClaimed")
                                    .withArgs(fundraisingId, await user1.getAddress());

                                let epicIds = generateTokenIds(peaqType.t3_epic, secondBatch - 1, 2);
                                let legendaryIds = generateTokenIds(peaqType.t4_legendary, 0, userCtrb.t4_legendary);

                                for (let i = 0; i < epicIds.length; i++) {
                                    await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), epicIds[i]);
                                    await expect(await peaqNFT.ownerOf(epicIds[i])).equal(await user1.getAddress());
                                }
                                for (let i = 0; i < legendaryIds.length; i++) {
                                    await expect(tx).to.emit(peaqNFT, "Transfer").withArgs(ZERO_ADDRESS, await user1.getAddress(), legendaryIds[i]);
                                    await expect(await peaqNFT.ownerOf(legendaryIds[i])).equal(await user1.getAddress());
                                }

                                let userNftBalance = await peaqNFT.balanceOf(await user1.getAddress());
                                expect(userNftBalance).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);

                                let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                                expect(userContribution.totalContribution).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);
                                expect(userContribution.totalValue).to.equal(peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common));
                                expect(userContribution.refunded).to.be.false;
                                expect(userContribution.fullClaimed).to.be.true;
                                expect(userContribution.claimedCount).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common)
                            });

                            it("should not allow user to claim NFTs by last batch twice", async function () {
                                await expect(fundraisingCenter.connect(user1).claimNft(fundraisingId, 1))
                                    .to.be.revertedWith("already claimed");
                            });
                        });

                        describe("Claiming NFTs by batch with wrong number", function () {
                            let snapshotIdLevel5: string;
                            before(async function () {
                                snapshotIdLevel5 = await ethers.provider.send("evm_snapshot", []);
                            });
                            after(async function () {
                                await ethers.provider.send("evm_revert", [snapshotIdLevel5]);
                            });

                            it("should allow user to claim NFTs by batch with larger number but the total number of claimed NFTs is correct", async function () {
                                let tx = await fundraisingCenter.connect(user1).claimNft(fundraisingId, lastBatch + 1);
                                await expect(tx)
                                    .to.emit(fundraisingCenter, "NftClaimed")
                                    .withArgs(fundraisingId, await user1.getAddress());

                                let userNftBalance = await peaqNFT.balanceOf(await user1.getAddress());
                                expect(userNftBalance).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);

                                let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                                expect(userContribution.totalContribution).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);
                                expect(userContribution.totalValue).to.equal(peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common));
                                expect(userContribution.refunded).to.be.false;
                                expect(userContribution.fullClaimed).to.be.true;
                                expect(userContribution.claimedCount).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common)
                            });

                            it("should not allow user to claim NFT again after full claimed", async function () {
                                await expect(fundraisingCenter.connect(user1).claimNft(fundraisingId, 1))
                                    .to.be.revertedWith("already claimed");
                            });
                        });

                        describe("Claiming NFTs by batch with claim all", function () {
                            let snapshotIdLevel5: string;
                            before(async function () {
                                snapshotIdLevel5 = await ethers.provider.send("evm_snapshot", []);
                            });
                            after(async function () {
                                await ethers.provider.send("evm_revert", [snapshotIdLevel5]);
                            });

                            it("should allow user to claim NFTs by batch with claim all", async function () {
                                let tx = await fundraisingCenter.connect(user1).claimAllNft(fundraisingId);
                                await expect(tx)
                                    .to.emit(fundraisingCenter, "NftClaimed")
                                    .withArgs(fundraisingId, await user1.getAddress());

                                let userNftBalance = await peaqNFT.balanceOf(await user1.getAddress());
                                expect(userNftBalance).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);

                                let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                                expect(userContribution.totalContribution).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common);
                                expect(userContribution.totalValue).to.equal(peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common));
                                expect(userContribution.refunded).to.be.false;
                                expect(userContribution.fullClaimed).to.be.true;
                                expect(userContribution.claimedCount).to.equal(userCtrb.t4_legendary + userCtrb.t3_epic + userCtrb.t1_common)
                            });

                            it("should not allow user to claim NFT again after full claimed", async function () {
                                await expect(fundraisingCenter.connect(user1).claimNft(fundraisingId, 1))
                                    .to.be.revertedWith("already claimed");
                            });
                        });
                    })

                });

                describe("Claiming funds", function () {
                    it("should not allow user to claim funds after the end of the fundraising", async function () {
                        await expect(fundraisingCenter.connect(user1).claimFund(fundraisingId))
                            .to.be.revertedWith("only moderator");
                    });

                    it("should allow moderator to claim funds after the end of the fundraising", async function () {
                        let balanceBefore = await ethers.provider.getBalance(await moderator.getAddress());

                        let tx = await fundraisingCenter.connect(moderator).claimFund(fundraisingId);
                        let txFee = (await tx.wait())?.fee;
                        let actualTarget = peaqPrice.t4_legendary * BigInt(userCtrb.t4_legendary) + peaqPrice.t3_epic * BigInt(userCtrb.t3_epic) + peaqPrice.t1_common * BigInt(userCtrb.t1_common);
                        expect(targetAmount).to.lessThanOrEqual(actualTarget);
                        await expect(tx)
                            .to.emit(fundraisingCenter, "FundClaimed")
                            .withArgs(fundraisingId, await moderator.getAddress(), actualTarget);

                        let balanceAfter = await ethers.provider.getBalance(await moderator.getAddress());
                        expect(actualTarget).to.equal(BigInt(balanceAfter) - BigInt(balanceBefore) + BigInt(txFee!));
                    });

                    it("should not allow moderator to claim funds twice", async function () {
                        await expect(fundraisingCenter.connect(moderator).claimFund(fundraisingId))
                            .to.be.revertedWith("already claimed");
                    });
                });
            });

            describe("2.4.2 Fundraising failed, and refunds", function () {
                let fundraisingId: number;
                let startTime: number;
                let duration: number;

                let userCtrb = {
                    t4_legendary: 3,
                    t3_epic: 1,
                    total: 4,
                    totalValue: peaqPrice.t4_legendary * BigInt(3) + peaqPrice.t3_epic * BigInt(1),
                }

                let snapshotIdLevel3: string;
                before(async function () {
                    snapshotIdLevel3 = await ethers.provider.send("evm_snapshot", []);

                    startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute
                    duration = 7200; // 2 hour

                    let tx = await createFundraising(moderator, startTime, duration, targetAmount);

                    fundraisingId = 0
                    await expect(tx).to.emit(fundraisingCenter, "FundraisingCreated").withArgs(fundraisingId, await moderator.getAddress(), startTime, duration, targetAmount);
                    let fund = await fundraisingCenter.getFundraising(fundraisingId);
                    expect(fund.targetAmount).to.equal(targetAmount);
                    expect(await fundraisingCenter.getFundraisingBasePrice(fundraisingId, peaqType.t4_legendary)).to.equal(peaqPrice.t4_legendary);
                    expect(await fundraisingCenter.getFundraisingBasePrice(fundraisingId, peaqType.t3_epic)).to.equal(peaqPrice.t3_epic);
                    expect(await fundraisingCenter.getFundraisingBasePrice(fundraisingId, peaqType.t1_common)).to.equal(peaqPrice.t1_common);
                    console.log("fund.startTime", fund.startTime);
                    console.log("duration", duration);
                    console.log("fund.targetTime", fund.targetTime);
                    expect(fund.targetTime).to.equal(startTime + duration);
                    expect(fund.startTime).to.equal(startTime);
                    expect(fund.totalContribution).to.equal(0);
                    expect(fund.moderator).to.equal(await moderator.getAddress());

                    // Increase time to move to the open phase
                    await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);

                    // Whitelist user1
                    await fundraisingCenter.connect(moderator).addToWhitelist(0, await user1.getAddress());

                    // Contribute only 3 legendary NFTs + 1 epic NFT
                    await fundraisingCenter.connect(user1).contribute(0, userCtrb.t4_legendary + userCtrb.t3_epic, { value: userCtrb.totalValue });
                });

                after(async function () {
                    await ethers.provider.send("evm_revert", [snapshotIdLevel3]);
                });

                describe("Common check", function () {
                    it("should user contribution correctly", async function () {
                        let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                        expect(userContribution.totalContribution).to.equal(userCtrb.total);
                        expect(userContribution.totalValue).to.equal(userCtrb.totalValue);
                        expect(userContribution.refunded).to.be.false;
                        expect(userContribution.fullClaimed).to.be.false;
                        expect(userContribution.claimedCount).to.equal(0);

                        let legendaryContribution = await fundraisingCenter.getUserContributionByType(0, await user1.getAddress(), peaqType.t4_legendary);
                        expect(legendaryContribution).to.equal(userCtrb.t4_legendary);
                        let epicContribution = await fundraisingCenter.getUserContributionByType(0, await user1.getAddress(), peaqType.t3_epic);
                        expect(epicContribution).to.equal(userCtrb.t3_epic);
                        let commonContribution = await fundraisingCenter.getUserContributionByType(0, await user1.getAddress(), peaqType.t1_common);
                        expect(commonContribution).to.equal(0);
                    });

                    it("should user cannot claim before the end of the fundraising", async function () {
                        await expect(fundraisingCenter.connect(user1).claimAllNft(fundraisingId))
                            .to.be.revertedWith("Raise not success");
                    });

                    it("should user cannot refund before the end of the fundraising", async function () {
                        await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + duration - 1]);
                        await expect(fundraisingCenter.connect(user1).refund(fundraisingId))
                            .to.be.revertedWith("fundraising not failed");
                    });

                    it("should fundraising status is 'open' before the end of the fundraising", async function () {
                        const status = await fundraisingCenter.getFundraisingStatus(fundraisingId);
                        expect(status).to.equal(fundrationStatus.open);
                    });

                    it("should fundraising status is 'failed' after the end of the fundraising", async function () {
                        await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + duration]);
                        await ethers.provider.send("evm_mine", [])
                        const status = await fundraisingCenter.getFundraisingStatus(fundraisingId);
                        expect(status).to.equal(fundrationStatus.failed);
                    });
                });

                describe("Claiming: all failed", function () {
                    it("should not allow user to claim NFTs", async function () {
                        await expect(fundraisingCenter.connect(user1).claimAllNft(fundraisingId))
                            .to.be.revertedWith("Raise not success");

                        await expect(fundraisingCenter.connect(user1).claimNft(fundraisingId, 1))
                            .to.be.revertedWith("Raise not success");
                    });

                    it("should not allow user to claim funds", async function () {
                        await expect(fundraisingCenter.connect(user1).claimFund(fundraisingId))
                            .to.be.revertedWith("only moderator");
                    });

                    it("should not allow moderator to claim funds", async function () {
                        await expect(fundraisingCenter.connect(moderator).claimFund(fundraisingId))
                            .to.be.revertedWith("Fundraising not successful");
                    })
                });

                describe("Refund", function () {
                    it("should allow user to refund after the end of the fundraising", async function () {
                        let balanceBefore = await ethers.provider.getBalance(await user1.getAddress());

                        let tx = await fundraisingCenter.connect(user1).refund(fundraisingId);
                        let txFee = (await tx.wait())?.fee;
                        await expect(tx)
                            .to.emit(fundraisingCenter, "RefundClaimed")
                            .withArgs(fundraisingId, await user1.getAddress(), userCtrb.totalValue);

                        let balanceAfter = await ethers.provider.getBalance(await user1.getAddress());
                        expect(userCtrb.totalValue).to.equal(BigInt(balanceAfter) - BigInt(balanceBefore) + BigInt(txFee!));
                    });

                    it('should the user contribution is refunded', async function () {
                        let userContribution = await fundraisingCenter.getUserContribution(0, await user1.getAddress());
                        expect(userContribution.totalContribution).to.equal(userCtrb.total);
                        expect(userContribution.totalValue).to.equal(userCtrb.totalValue);
                        expect(userContribution.refunded).to.be.true;
                        expect(userContribution.fullClaimed).to.be.false;
                    });

                    it("should not allow user to refund twice", async function () {
                        await expect(fundraisingCenter.connect(user1).refund(fundraisingId))
                            .to.be.revertedWith("Already refunded");
                    });
                });
            });
        });
    });
});

const lastBlockTimestamp = async () => {
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    return block.timestamp;
}

const printLastBlockTimestamp = async () => {
    console.log("Block timestamp: ", lastBlockTimestamp());
}

const printLog = async (tx) => {
    const receipt = await tx.wait();
    console.log(receipt.logs);
}

const generateTokenId = (nftType, index) => {
    let id = (ethers.getBigInt(nftType) << 32n | ethers.getBigInt(index));
    return parseInt(id.toString());
};

const generateTokenIds = (nftType, startIndex, count) => {
    let tokenIds = [];
    for (let i = 0; i < count; i++) {
        tokenIds.push(generateTokenId(nftType, startIndex + i));
    }
    return tokenIds;
}

const createFundraising = async (moderator, startTime, duration, targetAmount) => {
    return fundraisingCenter
        .connect(moderator)
        .createFundraising(
            startTime, duration, targetAmount,
            peaqPrice.t4_legendary, peaqPrice.t3_epic, peaqPrice.t1_common,
            peaqMaxBuyAmount.t4_legendary, peaqMaxBuyAmount.t3_epic
        );
}