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

async function main() {
  const asset = process.env.ASSET || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC mainnet
  const targetToken = process.env.TARGET_TOKEN || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH mainnet
  const uniswapRouter = process.env.ROUTER || "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2
  const priceOracle = process.env.PRICE_ORACLE || ""; // optional override
  const feeBps = process.env.FEE_BPS ? BigInt(process.env.FEE_BPS) : 50n; // default 0.5%
  const positionDuration = process.env.POSITION_DURATION
    ? BigInt(process.env.POSITION_DURATION)
    : 30n * 24n * 60n * 60n; // default 30 days in seconds

  const [deployer, g2, g3] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address}`);
  console.log(`Asset: ${asset}`);

  const X2UniswapExchange = await hre.ethers.getContractFactory("X2UniswapExchange");
  const x2uniswapRouter = await X2UniswapExchange.deploy(asset, targetToken, uniswapRouter);

  let oracleAddr = priceOracle;
  if (!oracleAddr) {
    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle");
    const fakeOracle = await FakeOracle.deploy(uniswapRouter, asset, targetToken);
    await fakeOracle.waitForDeployment();
    oracleAddr = fakeOracle.target;
    console.log(`FakeOracle deployed to: ${oracleAddr}`);
  } else {
    console.log(`Using PRICE_ORACLE: ${oracleAddr}`);
  }

  const feeWithdrawers = process.env.FEE_WITHDRAWERS
    ? process.env.FEE_WITHDRAWERS.split(",").map((s) => s.trim()).filter(Boolean)
    : [deployer.address];
  const governors = process.env.GOVERNORS
    ? process.env.GOVERNORS.split(",").map((s) => s.trim()).filter(Boolean)
    : [deployer.address, g2.address, g3.address];

  const X2Deployer = await hre.ethers.getContractFactory("X2Deployer");
  const x2deployer = await X2Deployer.deploy(
    asset,
    x2uniswapRouter.target,
    oracleAddr,
    feeBps,
    positionDuration,
    governors,
    feeWithdrawers,
    [targetToken]
  );
  await x2deployer.waitForDeployment();

  const x2swap = await x2deployer.swaps(targetToken);
  const pool = await x2deployer.pool();

  console.log(`X2UniswapExchange deployed to: ${x2uniswapRouter.target}`);
  console.log(`X2Deployer deployed to: ${x2deployer.target}`);
  console.log(`X2Swap deployed to: ${x2swap}`);
  console.log(`X2Pool deployed to: ${pool}`);

  // Read asset from the deployed pool to persist source-of-truth
  const assetAddr = await (await hre.ethers.getContractAt("X2Pool", pool)).asset();
  console.log(`Underlying asset: ${assetAddr}`);

  const deployment = {
    network: hre.network.name,
    x2deployer: x2deployer.target,
    targetToken
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
