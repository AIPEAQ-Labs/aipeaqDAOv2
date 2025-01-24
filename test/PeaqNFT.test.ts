// const { expect } = require("chai");
// const { ethers, upgrades } = require("hardhat");
import { expect } from "chai";
import { Signer } from "ethers";
import { upgrades, ethers } from "hardhat";

const COMMON = 1;
const RARE = 2;
const EPIC = 3;
const LEGENDARY = 4;


let owner, minter, addr1: Signer;
let PeaqNFT: any;
let peaqNFT: any;

describe("PeaqNFT", function () {
    const generateTokenId = (nftType, index) => {
        return ethers.getBigInt(nftType) << 32n | ethers.getBigInt(index);
    };

    const idToType = (tokenId: bigint) => {
        return tokenId >> 32n;
    };

    beforeEach(async function () {
        // Deploy the contract
        [owner, minter, addr1] = await ethers.getSigners();
        PeaqNFT = await ethers.getContractFactory("PeaqNFT");
        peaqNFT = await upgrades.deployProxy(PeaqNFT, { initializer: "initialize" });

        // Grant MINTER_ROLE to the minter
        const MINTER_ROLE = await peaqNFT.MINTER_ROLE();
        await peaqNFT.grantRole(MINTER_ROLE, minter.address);
    });

    it("should initialize correctly", async function () {
        expect(await peaqNFT.name()).to.equal("PeaqNFT");
        expect(await peaqNFT.symbol()).to.equal("PNFT");

        const DEFAULT_ADMIN_ROLE = await peaqNFT.DEFAULT_ADMIN_ROLE();
        expect(await peaqNFT.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("should mint NFTs correctly", async function () {
        const COMMON = 1; // Enum value for COMMON

        await peaqNFT.connect(minter).mint(minter.address, COMMON, 2);

        const tokenId1 = generateTokenId(COMMON, 0);
        const tokenId2 = generateTokenId(COMMON, 1);

        expect(await peaqNFT.ownerOf(tokenId1)).to.equal(minter.address);
        expect(await peaqNFT.ownerOf(tokenId2)).to.equal(minter.address);
    });

    it("should restrict minting to MINTER_ROLE", async function () {
        await expect(peaqNFT.mint(minter.address, COMMON, 1)).to.be.revertedWith(`AccessControl: account ${owner.address.toLowerCase()} is missing role ${await peaqNFT.MINTER_ROLE()}`);
    });

    it("should set and get share revenue percentage", async function () {
        const percentage = 5000; // 50.00%

        await peaqNFT.setShareRevenuePercentage(COMMON, percentage);
        expect(await peaqNFT.getShareRevenuePercentage(COMMON)).to.equal(percentage);
    });

    it("should emit RevenueSharePercentageSet event when setting percentage", async function () {
        const percentage = 5000; // 50.00%

        await expect(peaqNFT.setShareRevenuePercentage(COMMON, percentage))
            .to.emit(peaqNFT, "RevenueSharePercentageSet")
            .withArgs(COMMON, percentage);
    });

    it("should reject setting percentage above MAX_PERCENTAGE", async function () {
        const COMMON = 1; // Enum value for COMMON
        const invalidPercentage = 101_00; // 101.00%

        await expect(peaqNFT.setShareRevenuePercentage(COMMON, invalidPercentage)).to.be.revertedWith("PeaqNFT: Invalid percentage");
    });

    it("should correctly derive NftType from tokenId", async function () {
        let tokenId: bigint;
        tokenId = generateTokenId(COMMON, 0);
        expect(idToType(tokenId)).to.equal(1);
        expect(idToType(tokenId)).to.equal(COMMON);

        tokenId = generateTokenId(RARE, 0);
        expect(idToType(tokenId)).to.equal(2);
        expect(idToType(tokenId)).to.equal(RARE);

        tokenId = generateTokenId(EPIC, 0);
        expect(idToType(tokenId)).to.equal(3);
        expect(idToType(tokenId)).to.equal(EPIC);

        tokenId = generateTokenId(LEGENDARY, 0);
        expect(idToType(tokenId)).to.equal(4);
        expect(idToType(tokenId)).to.equal(LEGENDARY);
    });

    it("should return share revenue percentage for a token", async function () {
        const EPIC = 2; // Enum value for EPIC
        const percentage = 3000; // 30.00%
        const index = 0;
        const tokenId = generateTokenId(EPIC, index);

        await peaqNFT.setShareRevenuePercentage(EPIC, percentage);
        expect(await peaqNFT.getShareRevenuePercentageForToken(tokenId)).to.equal(percentage);
    });

    it("should support ERC721 and AccessControl interfaces", async function () {
        const ERC721_INTERFACE_ID = "0x80ac58cd";
        const ACCESS_CONTROL_INTERFACE_ID = "0x7965db0b";

        expect(await peaqNFT.supportsInterface(ERC721_INTERFACE_ID)).to.be.true;
        expect(await peaqNFT.supportsInterface(ACCESS_CONTROL_INTERFACE_ID)).to.be.true;
    });
});
