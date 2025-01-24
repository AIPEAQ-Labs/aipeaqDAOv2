const { ethers } = require("hardhat");

module.exports = async ({ deployments, getNamedAccounts }) => {
    const { execute, read, log } = deployments;
    const { deployer } = await getNamedAccounts();

    log("Granting MINTER_ROLE to FundraisingCenter...");

    // Retrieve deployed contract addresses
    const peaqNFT = await deployments.get("PeaqNFT");
    const fundraisingCenter = await deployments.get("FundraisingCenter");

    const peaqNFTAddress = peaqNFT.address;
    const fundraisingCenterAddress = fundraisingCenter.address;

    // Define the MINTER_ROLE hash
    const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

    try {
        // Check if FundraisingCenter already has the MINTER_ROLE
        const hasRole = await read("PeaqNFT", { from: deployer }, "hasRole", MINTER_ROLE, fundraisingCenterAddress);

        if (hasRole) {
            log(`FundraisingCenter already has MINTER_ROLE in PeaqNFT at ${peaqNFTAddress}`);
        } else {
            // Grant MINTER_ROLE to FundraisingCenter via ProxyAdmin
            await execute(
                "PeaqNFT",
                { from: deployer, log: true },
                "grantRole",
                MINTER_ROLE,
                fundraisingCenterAddress
            );
            log(`MINTER_ROLE granted to FundraisingCenter at ${fundraisingCenterAddress}`);
        }
    } catch (error) {
        log(`Error granting MINTER_ROLE: ${error.message}`);
        throw error; // Rethrow to ensure Hardhat properly detects the failure
    }
};

module.exports.tags = ["GrantMinterRole"];
module.exports.dependencies = ["PeaqNFT", "FundraisingCenter"];
