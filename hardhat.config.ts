import { HardhatUserConfig } from "hardhat/types";
import "@nomicfoundation/hardhat-toolbox";
import '@openzeppelin/hardhat-upgrades';
import * as dotenv from "dotenv";
import "hardhat-contract-sizer";
import 'hardhat-deploy';

dotenv.config();

const accounts = {
  mnemonic: process.env.MNEMONIC,
  count: 30,
};

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: true
            }
          }
        }
      },
      {
        version: "0.4.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },
  networks: {
    hardhat: {
      chainId: 1,
    },
    localhost: {
      url: "http://127.0.0.1:7545",
      chainId: 1337,
    },
    gam3Testnet: {
      url: "https://testnet-rpc.gam3.ai",
      chainId: 39855,
      accounts,
    },
    arbitrumOne: {
      url: "https://arb-mainnet.g.alchemy.com/v2/36LQwSV7w6OsIOWnESZn8AILaEGxg6a3/",
      accounts,
      chainId: 42161,
    },
    arbitrumSepolia: {
      url: "https://arb-sepolia.g.alchemy.com/v2/36LQwSV7w6OsIOWnESZn8AILaEGxg6a3",
      accounts,
      chainId: 421614,
    },
    lumiaTestnet: {
      url: process.env.LUMIA_TESTNET_URL || "https://testnet-rpc.lumia.org",
      accounts:
        process.env.LUMIA_TESTNET_PRIVATE_KEY !== undefined ? [process.env.LUMIA_TESTNET_PRIVATE_KEY] : [],
      chainId: 1952959480,
    },
    peaqTestnet: {
      url: "https://erpc-async.agung.peaq.network/",
      accounts: 
        process.env.PEAQ_TESTNET_PRIVATE_KEY !== undefined ? [process.env.PEAQ_TESTNET_PRIVATE_KEY] : [],
      chainId: 9990,
    }
  },
  etherscan: {
    apiKey: { 
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
      lumiaTestnet: process.env.LUMIA_TESTNET_API_KEY || "empty",
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io/"
        }
      },
      {
        network: "lumiaTestnet",
        chainId: 1952959480,
        urls: {
          apiURL: "https://testnet-explorer.lumia.org:443/api",
          browserURL: "https://testnet-explorer.lumia.org:443"
        }
      },
    ]
  },
  namedAccounts: {
    deployer: {
      default: 0,
    }
  }
};

export default config;
