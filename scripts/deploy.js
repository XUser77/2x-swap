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
  const asset = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // USDC mainnet
  const targetTokens = [
    { symbol: "WETH", address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" },
    // { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" }
  ];
  const uniswapV2Router = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3"; // Uniswap V2
  const uniswapV3Router = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // SwapRouter02
  const uniswapV3Quoter = "0x5e55c9e631fae526cd4b0526c4818d6e0a9ef0e3"; // QuoterV2
  const uniswapV3Fee = 3000 // 0.3%;
  const feeBps = 50n; // 0.5%
  const positionDuration = 365n * 24n * 60n * 60n; // 365 days

  const [deployer, g2, g3] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address}`);
  console.log(`Asset: ${asset}`);

  const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange");
  const X2UniswapV3Exchange = await hre.ethers.getContractFactory("X2UniswapV3Exchange");
  const FakeOracle = await hre.ethers.getContractFactory("FakeOracle");

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

    const fakeOracle = await FakeOracle.deploy(uniswapV2Router, asset, target.address);
    await fakeOracle.waitForDeployment();
    await logDeploymentGas(`FakeOracle(${target.symbol})`, fakeOracle);

    const exchangeSet = [x2uniswapV2.target, x2uniswapV3.target];
    exchanges.push(...exchangeSet);
    exchangeConfigs[target.address] = exchangeSet;
    targetConfigs.push([target.address, fakeOracle.target]);

    console.log(`${target.symbol} X2UniswapV2Exchange deployed to: ${x2uniswapV2.target}`);
    console.log(`${target.symbol} X2UniswapV3Exchange deployed to: ${x2uniswapV3.target}`);
    console.log(`${target.symbol} FakeOracle deployed to: ${fakeOracle.target}`);
  }

  const governors = process.env.GOVERNORS
    ? process.env.GOVERNORS.split(",").map((s) => s.trim()).filter(Boolean)
    : [deployer.address, g2.address, g3.address];

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
