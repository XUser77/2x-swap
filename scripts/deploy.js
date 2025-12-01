/* Deployment script for X2Swap (deploys X2Pool internally)
 *
 * Usage (mainnet fork defaults):
 *   ASSET=0x... TOKEN_NAME="ETH-USDC X2 Pool" TOKEN_SYMBOL="2xETHxUSDC" POSITION_DURATION=2592000 npx hardhat run scripts/deploy.js --network <network>
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
  const name = process.env.TOKEN_NAME || "ETH-USDC X2 Pool";
  const symbol = process.env.TOKEN_SYMBOL || "2xETHxUSDC";
  const positionDuration = process.env.POSITION_DURATION
    ? BigInt(process.env.POSITION_DURATION)
    : 30n * 24n * 60n * 60n; // default 30 days in seconds

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address}`);
  console.log(`Asset: ${asset}`);

  const X2UniswapRouter = await hre.ethers.getContractFactory("X2UniswapRouter");
  const x2uniswapRouter = await X2UniswapRouter.deploy(asset, targetToken, uniswapRouter);

  const X2Swap = await hre.ethers.getContractFactory("X2Swap");
  const x2swap = await X2Swap.deploy(asset, targetToken, x2uniswapRouter.target, name, symbol, positionDuration);
  await x2swap.waitForDeployment();
  const pool = await x2swap.pool();

  console.log(`X2UniswapRouter deployed to: ${x2uniswapRouter.target}`);
  console.log(`X2Swap deployed to: ${x2swap.target}`);
  console.log(`X2Pool deployed to: ${pool}`);

  // Read asset from the deployed pool to persist source-of-truth
  const assetAddr = await (await hre.ethers.getContractAt("X2Pool", pool)).asset();
  console.log(`Underlying asset: ${assetAddr}`);

  const deployment = {
    network: hre.network.name,
    x2swap: x2swap.target
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
