/* Deployment script for X2Swap (deploys X2Pool internally)
 *
 * Usage (mainnet fork defaults):
 *   ASSET=0x... POSITION_DURATION=2592000 npx hardhat run scripts/deploy.js --network <network>
 *
 * If ASSET is omitted, defaults to mainnet USDC for fork testing.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function logDeploymentGas(label, contract) {
  const tx = contract.deploymentTransaction();
  if (!tx) {
    console.log(`${label} gas used: n/a`);
    return;
  }
  const receipt = await tx.wait();
  console.log(`${label} gas used: ${receipt.gasUsed.toString()}`);
}

async function main() {
  const asset = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC mainnet
  const targetTokens = [
    { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
    { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" }
  ];
  const uniswapV2Router = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2
  const uniswapV3Router = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // SwapRouter02
  const uniswapV3Quoter = "0x5e55c9e631fae526cd4b0526c4818d6e0a9ef0e3"; // QuoterV2
  const uniswapV3Fee = 3000n // 0.3%;
  const feeBps = 12n; // 0.12%
  const positionDuration = 365n * 24n * 60n * 60n; // 365 days

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address}`);
  console.log(`Asset: ${asset}`);

  const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange");
  const X2UniswapV3Exchange = await hre.ethers.getContractFactory("X2UniswapV3Exchange");
  // const FakeOracle = await hre.ethers.getContractFactory("FakeOracle");

  const exchanges = [];
  const exchangeConfigs = {};
  const targetConfigs = [];

  for (const target of targetTokens) {
    const x2uniswapV2 = await X2UniswapV2Exchange.deploy(asset, target.address, uniswapV2Router);
    await x2uniswapV2.waitForDeployment();
    await logDeploymentGas(`X2UniswapV2Exchange(${target.symbol})`, x2uniswapV2);

    const x2uniswapV3 = await X2UniswapV3Exchange.deploy(
      asset,
      target.address,
      uniswapV3Router,
      uniswapV3Quoter,
      uniswapV3Fee
    );
    await x2uniswapV3.waitForDeployment();
    await logDeploymentGas(`X2UniswapV3Exchange(${target.symbol})`, x2uniswapV3);

    // const fakeOracle = await FakeOracle.deploy(uniswapV2Router, asset, target.address);
    // await fakeOracle.waitForDeployment();
    // await logDeploymentGas(`FakeOracle(${target.symbol})`, fakeOracle);

    const exchangeSet = [x2uniswapV2.target, x2uniswapV3.target];
    exchanges.push(...exchangeSet);
    exchangeConfigs[target.address] = exchangeSet;
    if ("WETH" === target.symbol) {
      targetConfigs.push([target.address, "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"]);
    } else if ("WBTC" === target.symbol) {
      targetConfigs.push([target.address, "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c"]);
    }

    console.log(`${target.symbol} X2UniswapV2Exchange deployed to: ${x2uniswapV2.target}`);
    console.log(`${target.symbol} X2UniswapV3Exchange deployed to: ${x2uniswapV3.target}`);
    // console.log(`${target.symbol} FakeOracle deployed to: ${fakeOracle.target}`);
  }

  const governors = [
    "0xB5EDA84c1D370f590cc295fFCB108B41029F018B", // Deployer address
    "0xae8028A0BCcF407D609e7497e672CB4bA8b8FEe1",
    "0x8096aB260890db23BD9fF1f664C1ED9fFb9040f0",
    "0xd22E92eeD1576ff7640dd258AB57E3463273b1bA",
    "0x3b3bc2b5e4e46c8373dd0f6aac46c5ded0ddeb1c"
  ];

  const X2Deployer = await hre.ethers.getContractFactory("X2Deployer");
  const x2deployer = await X2Deployer.deploy(
    asset,
    exchanges,
    feeBps,
    positionDuration,
    governors,
    targetConfigs
  );
  await x2deployer.waitForDeployment();
  await logDeploymentGas("X2Deployer", x2deployer);

  const swapsByTarget = {};
  for (const target of targetTokens) {
    swapsByTarget[target.address] = await x2deployer.swaps(target.address);
  }
  const pool = await x2deployer.pool();

  console.log(`X2Deployer deployed to: ${x2deployer.target}`);
  for (const target of targetTokens) {
    console.log(`${target.symbol} X2Swap deployed to: ${swapsByTarget[target.address]}`);
  }
  console.log(`X2Pool deployed to: ${pool}`);

  // Read asset from the deployed pool to persist source-of-truth
  const assetAddr = await (await hre.ethers.getContractAt("X2Pool", pool)).asset();
  console.log(`Underlying asset: ${assetAddr}`);

  const networkConfig = hre.network.config || {};
  const rpcUrl = typeof networkConfig.url === "string" ? networkConfig.url : null;
  const chainId = networkConfig.chainId != null ? Number(networkConfig.chainId) : null;

  const deployment = {
    rpcUrl,
    chainId,
    x2deployer: x2deployer.target,
    targets: targetTokens.map((target) => ({
      symbol: target.symbol,
      targetToken: target.address,
      swap: swapsByTarget[target.address],
      exchanges: exchangeConfigs[target.address]
    }))
  };

  const dataDir = path.join(__dirname, "..", "web", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const outPath = path.join(dataDir, "deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`Deployment info saved to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
