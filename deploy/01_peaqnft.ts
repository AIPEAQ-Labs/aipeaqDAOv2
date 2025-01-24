// deployments/01_deploy_peaqNFT.js
const { ethers } = require("hardhat");

module.exports = async ({ deployments, getNamedAccounts }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log("Deploying PeaqNFT with deployer:", deployer);

    const peaqNFT = await deploy("PeaqNFT", {
        from: deployer,
        log: true,
        proxy: {
            proxyContract: "OpenZeppelinTransparentProxy",
            execute: {
                init: {
                    methodName: "initialize",
                    args: [],
                }
            }
        },
    });

    console.log("PeaqNFT deployed at:", peaqNFT.address);
};

module.exports.tags = ["PeaqNFT"];
