require("@nomicfoundation/hardhat-toolbox");

const MAINNET_RPC = "https://eth-mainnet.g.alchemy.com/v2/9yZVy-d0ROhS8okYdpyLJg3YdHwihB7w";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: MAINNET_RPC ? { forking: { url: MAINNET_RPC }, chainId: 31338 } : {},
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31338
    },
    x2swap: {
      url: "http://185.146.3.206:8545",
      chainId: 31337
    }
  }
};
