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

async function assertHasCode(provider, address, label) {
  if (!address) throw new Error(`${label} is empty`);
  const code = await provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(
      `${label} has no contract code at ${address}. ` +
        `You are likely deploying to a non-forked chain. ` +
        `Set MAINNET_RPC/FORK_URL for forking, or deploy/provide ${label} for your custom testnet.`
    );
  }
}

async function main() {
  const asset = process.env.ASSET || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC mainnet
  const targetToken = process.env.TARGET_TOKEN || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH mainnet
  const uniswapV2Router = process.env.ROUTER || "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2
  const uniswapV3Router =
    process.env.UNISWAP_V3_ROUTER || "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"; // SwapRouter02
  const uniswapV3Quoter =
    process.env.UNISWAP_V3_QUOTER || "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"; // QuoterV2
  const uniswapV3Fee = process.env.UNISWAP_V3_FEE ? Number(process.env.UNISWAP_V3_FEE) : 3000;
  const priceOracle = process.env.PRICE_ORACLE || ""; // optional override
  const feeBps = process.env.FEE_BPS ? BigInt(process.env.FEE_BPS) : 50n; // default 0.5%
  const positionDuration = process.env.POSITION_DURATION
    ? BigInt(process.env.POSITION_DURATION)
    : 30n * 24n * 60n * 60n; // default 30 days in seconds

  const [deployer, g2, g3] = await hre.ethers.getSigners();
  console.log(`Deploying with ${deployer.address}`);
  console.log(`Asset: ${asset}`);

  const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange");
  const x2uniswapV2 = await X2UniswapV2Exchange.deploy(asset, targetToken, uniswapV2Router);
  await x2uniswapV2.waitForDeployment();

  const X2UniswapV3Exchange = await hre.ethers.getContractFactory("X2UniswapV3Exchange");
  const x2uniswapV3 = await X2UniswapV3Exchange.deploy(
    asset,
    targetToken,
    uniswapV3Router,
    uniswapV3Quoter,
    uniswapV3Fee
  );
  await x2uniswapV3.waitForDeployment();

  let oracleAddr = priceOracle;
  if (!oracleAddr) {
    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle");
    const fakeOracle = await FakeOracle.deploy(uniswapV2Router, asset, targetToken);
    await fakeOracle.waitForDeployment();
    oracleAddr = fakeOracle.target;
    console.log(`FakeOracle deployed to: ${oracleAddr}`);
  } else {
    console.log(`Using PRICE_ORACLE: ${oracleAddr}`);
  }

  const governors = process.env.GOVERNORS
    ? process.env.GOVERNORS.split(",").map((s) => s.trim()).filter(Boolean)
    : [deployer.address, g2.address, g3.address];

  const X2Deployer = await hre.ethers.getContractFactory("X2Deployer");
  const x2deployer = await X2Deployer.deploy(
    asset,
    [x2uniswapV2.target, x2uniswapV3.target],
    feeBps,
    positionDuration,
    governors,
    [[targetToken, oracleAddr]]
  );
  await x2deployer.waitForDeployment();

  const x2swap = await x2deployer.swaps(targetToken);
  const pool = await x2deployer.pool();

  console.log(`X2UniswapV2Exchange deployed to: ${x2uniswapV2.target}`);
  console.log(`X2UniswapV3Exchange deployed to: ${x2uniswapV3.target}`);
  console.log(`X2Deployer deployed to: ${x2deployer.target}`);
  console.log(`X2Swap deployed to: ${x2swap}`);
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
    targetToken,
    exchange: x2uniswapV2.target,
    exchanges: [x2uniswapV2.target, x2uniswapV3.target],
    uniswapV3Fee: uniswapV3Fee
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
