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
      chainId: 31338,
    },
    x2swap: {
      url: "https://node.usr.kz",
      chainId: 31337
    },
    testnet: {
      url: "https://eth-sepolia.g.alchemy.com/v2/9yZVy-d0ROhS8okYdpyLJg3YdHwihB7w",
      accounts: [
        "0x2f75361d164d12a2fa7657ea25502799506640583ca96a8fc9bbf18d6fd81fd3",
        "0xe6a4e6432fb6fa7bcc8ce4ab5ec6e10902f4670de4ebafed3de1230b5530dcc8",
        "0x237adc1ad8f45da1f56103a339605e4fa0d568109d6ade10e533f546b7b54503"
      ]
    },
    mainnet: {
      url: "https://eth-mainnet.g.alchemy.com/v2/9yZVy-d0ROhS8okYdpyLJg3YdHwihB7w",
      chainId: 1
    }
  },
  etherscan: {
    apiKey: "KJUIWFP7UR6UYHRZH78DM4YG9GH3ZU1TA6",
  },
};
