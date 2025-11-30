/* Deployment script for X2Swap (deploys X2Pool internally)
 *
 * Usage (mainnet fork defaults):
 *   ASSET=0x... TOKEN_NAME="ETH-USDC X2 Pool" TOKEN_SYMBOL="2xETHxUSDC" npx hardhat run scripts/deploy.js --network <network>
 *
 * If ASSET is omitted, defaults to mainnet USDC for fork testing.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const asset = process.env.ASSET || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC mainnet
  const targetToken = process.env.ASSET || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH mainnet
  const name = process.env.TOKEN_NAME || "ETH-USDC X2 Pool";
  const symbol = process.env.TOKEN_SYMBOL || "2xETHxUSDC";

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address}`);
  console.log(`Asset: ${asset}`);

  const Swap = await hre.ethers.getContractFactory("X2Swap");
  const swap = await Swap.deploy(asset, targetToken, name, symbol);
  await swap.waitForDeployment();
  const pool = await swap.pool();

  console.log(`X2Swap deployed to: ${swap.target}`);
  console.log(`X2Pool deployed to: ${pool}`);

  // Read asset from the deployed pool to persist source-of-truth
  const assetAddr = await (await hre.ethers.getContractAt("X2Pool", pool)).asset();
  console.log(`Underlying asset: ${assetAddr}`);

  const deployment = {
    network: hre.network.name,
    x2swap: swap.target
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
