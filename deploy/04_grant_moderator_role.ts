const { ethers } = require("hardhat");

module.exports = async ({ deployments, getNamedAccounts }) => {
    const { execute, read, log } = deployments;
    const { deployer } = await getNamedAccounts();

    // Retrieve deployed contract addresses
    const fundraisingCenter = await deployments.get("FundraisingCenter");
    const fundraisingCenterAddress = fundraisingCenter.address;

    // Define the MINTER_ROLE hash
    const MODERATOR_ROLE = "0x71f3d55856e4058ed06ee057d79ada615f65cdf5f9ee88181b914225088f834f";
    
    // FIXME: Update this address with the new moderator address
    const newModerator = "0xca21359C4AdE7EA3808f504e0b71B495204d710b";

    try {
        // Check if FundraisingCenter already has the MINTER_ROLE
        const hasRole = await read("FundraisingCenter", { from: deployer }, "hasRole", MODERATOR_ROLE, newModerator);

        if (hasRole) {
            log(`FundraisingCenter already has MODERATOR_ROLE in FundraisingCenter at ${fundraisingCenterAddress}`);
        } else {
            // Grant MINTER_ROLE to FundraisingCenter via ProxyAdmin
            await execute(
                "FundraisingCenter",
                { from: deployer, log: true },
                "grantRole",
                MODERATOR_ROLE,
                newModerator
            );
            log(`MODERATOR_ROLE granted to ${newModerator}`);
        }
    } catch (error) {
        log(`Error granting MODERATOR_ROLE: ${error.message}`);
        throw error; // Rethrow to ensure Hardhat properly detects the failure
    }
};

module.exports.tags = ["GrantModeratorRole"];
module.exports.dependencies = ["PeaqNFT", "FundraisingCenter"];
