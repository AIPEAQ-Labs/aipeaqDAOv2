const { ethers } = require("hardhat");

module.exports = async ({ deployments, getNamedAccounts }) => {
    const { execute, read, log } = deployments;
    const { deployer } = await getNamedAccounts();

    // Retrieve deployed contract addresses
    const fundraisingCenter = await deployments.get("FundraisingCenter");
    const fundraisingCenterAddress = fundraisingCenter.address;

    // Define the MINTER_ROLE hash
    const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
    
    // FIXME: Update this address with the new moderator address
    const newModerator = "0xca21359C4AdE7EA3808f504e0b71B495204d710b";

    try {
        // Check if FundraisingCenter already has the MINTER_ROLE
        const hasRole = await read("FundraisingCenter", { from: deployer }, "hasRole", DEFAULT_ADMIN_ROLE, newModerator);

        if (hasRole) {
            log(`FundraisingCenter already has DEFAULT_ADMIN_ROLE in FundraisingCenter at ${fundraisingCenterAddress}`);
        } else {
            // Grant MINTER_ROLE to FundraisingCenter via ProxyAdmin
            await execute(
                "FundraisingCenter",
                { from: deployer, log: true },
                "grantRole",
                DEFAULT_ADMIN_ROLE,
                newModerator
            );
            log(`DEFAULT_ADMIN_ROLE granted to ${newModerator}`);
        }
    } catch (error) {
        log(`Error granting DEFAULT_ADMIN_ROLE: ${error.message}`);
        throw error; // Rethrow to ensure Hardhat properly detects the failure
    }
};

module.exports.tags = ["GrantDefaultAdminRole"];
module.exports.dependencies = ["PeaqNFT", "FundraisingCenter"];
