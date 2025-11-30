/* Deployment script for LiquidityPool + LPToken (LPToken is deployed inside the pool)
 *
 * Usage:
 *   SOURCE_TOKEN=0x... TARGET_TOKEN=0x... TOKEN_NAME="X2 MyToken" TOKEN_SYMBOL="X2MY" \
 *   npx hardhat run scripts/deploy.js --network <network>
 *
 * Expects a Hardhat environment with LiquidityPool compiled.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const source = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC
  const target = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH9
  const name = "2x LP USDC-ETH";
  const symbol = "2xUSDCxETH";

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address}`);

  const LiquidityPool = await hre.ethers.getContractFactory("LiquidityPool");
  const pool = await LiquidityPool.deploy(source, target, name, symbol);
  await pool.waitForDeployment();

  console.log(`LiquidityPool deployed to: ${pool.target}`);
  console.log(`LPToken deployed to: ${await pool.lpToken()}`);
  console.log(`Source token: ${await pool.sourceToken()}`);
  console.log(`Target token: ${await pool.targetToken()}`);

  const deployment = {
    network: hre.network.name,
    sourceToken: source,
    targetToken: target,
    pool: pool.target,
    lpToken: await pool.lpToken()
  };

  const dataDir = path.join(__dirname, "..", "web/data");
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
