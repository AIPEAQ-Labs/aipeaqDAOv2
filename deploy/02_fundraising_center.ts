// deployments/02_deploy_fundraisingCenter.js
const { ethers } = require("hardhat");

module.exports = async ({ deployments, getNamedAccounts }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log("Deploying FundraisingCenter with deployer:", deployer);

    // Fetch the PeaqNFT contract address from previous deployments
    const peaqNFT = await deployments.get("PeaqNFT");
    console.log("PeaqNFT address:", peaqNFT.address);

    const maxStartTime = 604800; // 7 days in seconds
    const maxDuration = 2592000; // 30 days in seconds
    const legendaryDuration = 10 * 60; // 10 minutes in seconds
    const epicDuration = 30 * 60; // 30 minutes in seconds


    await deploy("FundraisingCenter", {
        from: deployer,
        args: [
            peaqNFT.address,
            maxStartTime,
            maxDuration,
            legendaryDuration,
            epicDuration,
        ],
        log: true,
    });

    console.log("FundraisingCenter deployed!");
};

module.exports.tags = ["FundraisingCenter"];
