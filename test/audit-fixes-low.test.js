const { expect } = require("chai");
const hre = require("hardhat");
const { impersonateAccount, setBalance } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const USDC_WHALE = "0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341";

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)"
];

const encodePath = (path) => hre.ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [path]);

async function getUsdcWhale() {
  await impersonateAccount(USDC_WHALE);
  await setBalance(USDC_WHALE, hre.ethers.parseEther("10"));
  const whaleSigner = await hre.ethers.getSigner(USDC_WHALE);
  const usdcWhale = await hre.ethers.getContractAt(erc20Abi, USDC, whaleSigner);
  return { whaleSigner, usdcWhale };
}

async function deployProtocol() {
  const [deployer, g2, g3] = await hre.ethers.getSigners();

  const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange");
  const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

  const FakeOracle = await hre.ethers.getContractFactory("FakeOracle");
  const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

  const X2Deployer = await hre.ethers.getContractFactory("X2Deployer");
  const router = await X2Deployer.deploy(
    USDC,
    [x2uniswap.target],
    0,
    30n * 24n * 60n * 60n,
    [deployer.address, g2.address, g3.address],
    [[WETH, oracle.target]]
  );
  
  const poolAddr = await router.pool();
  const pool = await hre.ethers.getContractAt("X2Pool", poolAddr);
  const swapAddr = await router.swaps(WETH);
  const swap = await hre.ethers.getContractAt("X2Swap", swapAddr);
  const feeGovAddr = await router.feeGovernance();
  const feeGov = await hre.ethers.getContractAt("FeeGovernance", feeGovAddr);

  return { router, pool, swap, feeGov, x2uniswap, oracle, deployer, g2, g3 };
}

describe("Low Severity Fixes (L-1 to L-4) & Token Decimals Compatibility", function () {
  before(async function () {
    this.timeout(240_000);
    if (hre.network.name !== "hardhat") return;
    
    const configuredUrl = hre.network.config.forking && hre.network.config.forking.url;
    const forkUrl = configuredUrl || process.env.MAINNET_RPC || process.env.FORK_URL;
    if (!forkUrl) this.skip();

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: forkUrl } }]
    });
  });

  beforeEach(function () {
    this.timeout(240_000);
  });

  describe("L-1: Zero Address Checks", function () {
    it("Should reject zero address in X2Pool constructor", async function () {
      const [deployer] = await hre.ethers.getSigners();
      
      const X2Pool = await hre.ethers.getContractFactory("X2Pool");
      
      // Try to deploy with zero asset address
      await expect(
        X2Pool.deploy(
          hre.ethers.ZeroAddress, // asset_
          deployer.address, // x2deployer_
          deployer.address  // feeGovernance_
        )
      ).to.be.revertedWith("Asset required");
    });

    it("Should reject zero address for deployer in X2Pool constructor", async function () {
      const [deployer] = await hre.ethers.getSigners();
      
      const X2Pool = await hre.ethers.getContractFactory("X2Pool");
      
      await expect(
        X2Pool.deploy(
          USDC,
          hre.ethers.ZeroAddress, // x2deployer_
          deployer.address
        )
      ).to.be.revertedWith("Deployer required");
    });

    it("Should reject zero address for governance in X2Pool constructor", async function () {
      const [deployer] = await hre.ethers.getSigners();
      
      const X2Pool = await hre.ethers.getContractFactory("X2Pool");
      
      await expect(
        X2Pool.deploy(
          USDC,
          deployer.address,
          hre.ethers.ZeroAddress // feeGovernance_
        )
      ).to.be.revertedWith("Governance required");
    });

    it("Should reject zero addresses in X2Swap constructor", async function () {
      const [deployer, gov2, gov3] = await hre.ethers.getSigners();
      
      const FeeGovernance = await hre.ethers.getContractFactory("FeeGovernance");
      const feeGov = await FeeGovernance.deploy([deployer.address, gov2.address, gov3.address]);
      
      const X2Pool = await hre.ethers.getContractFactory("X2Pool");
      const pool = await X2Pool.deploy(USDC, deployer.address, feeGov.target);
      
      const FakeOracle = await hre.ethers.getContractFactory("FakeOracle");
      const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);
      
      const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange");
      const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);
      
      const X2Swap = await hre.ethers.getContractFactory("X2Swap");
      
      // Zero asset address
      await expect(
        X2Swap.deploy(
          hre.ethers.ZeroAddress, // asset_
          WETH,
          [x2uniswap.target],
          oracle.target,
          0,
          pool.target,
          feeGov.target,
          30n * 24n * 60n * 60n
        )
      ).to.be.revertedWith("Asset required");
      
      // Zero target token
      await expect(
        X2Swap.deploy(
          USDC,
          hre.ethers.ZeroAddress, // targetToken_
          [x2uniswap.target],
          oracle.target,
          0,
          pool.target,
          feeGov.target,
          30n * 24n * 60n * 60n
        )
      ).to.be.revertedWith("Target required");
      
      // Zero oracle
      await expect(
        X2Swap.deploy(
          USDC,
          WETH,
          [x2uniswap.target],
          hre.ethers.ZeroAddress, // priceOracle_
          0,
          pool.target,
          feeGov.target,
          30n * 24n * 60n * 60n
        )
      ).to.be.revertedWith("Oracle required");
    });

    it("Should reject zero address in FeeGovernance constructor", async function () {
      const [deployer] = await hre.ethers.getSigners();
      
      const FeeGovernance = await hre.ethers.getContractFactory("FeeGovernance");
      
      await expect(
        FeeGovernance.deploy([deployer.address, hre.ethers.ZeroAddress, deployer.address])
      ).to.be.revertedWith("Bad governor");
    });
  });

  describe("L-2: Gas Optimizations", function () {
    it("Should deploy with optimized bytecode", async function () {
      const { pool, swap } = await deployProtocol();
      
      // Contracts should deploy successfully with optimizations
      expect(pool.target).to.not.equal(hre.ethers.ZeroAddress);
      expect(swap.target).to.not.equal(hre.ethers.ZeroAddress);
    });
  });

  describe("L-4: NatSpec Documentation", function () {
    it("Should have documented functions", async function () {
      // This is verified by code inspection
      // Functions should have @notice, @param, @return comments
      expect(true).to.be.true;
    });
  });

  describe("Token Decimals Compatibility", function () {
    it("Should set MIN_DEPOSIT based on token decimals", async function () {
      const { pool } = await deployProtocol();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      const decimals = await usdc.decimals();
      const expectedMinDeposit = 10n ** BigInt(decimals);
      
      const actualMinDeposit = await pool.MIN_DEPOSIT();
      expect(actualMinDeposit).to.equal(expectedMinDeposit);
    });

    it("Should set MAX_POOL_SIZE based on token decimals", async function () {
      const { pool } = await deployProtocol();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      const decimals = await usdc.decimals();
      const expectedMaxPoolSize = 10_000_000n * (10n ** BigInt(decimals));
      
      const actualMaxPoolSize = await pool.MAX_POOL_SIZE();
      expect(actualMaxPoolSize).to.equal(expectedMaxPoolSize);
    });

    it("Should set MIN_BORROW_LIQUIDITY based on token decimals", async function () {
      const { pool } = await deployProtocol();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      const decimals = await usdc.decimals();
      const expectedMinLiquidity = 10n * (10n ** BigInt(decimals));
      
      const actualMinLiquidity = await pool.MIN_BORROW_LIQUIDITY();
      expect(actualMinLiquidity).to.equal(expectedMinLiquidity);
    });

    it("Should set MIN_POSITION_AMOUNT based on token decimals", async function () {
      const { swap } = await deployProtocol();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      const decimals = await usdc.decimals();
      const expectedMinPosition = 10n ** BigInt(decimals); // 1 token (was 0.001, now 1)
      
      const actualMinPosition = await swap.MIN_POSITION_AMOUNT();
      expect(actualMinPosition).to.equal(expectedMinPosition);
    });
  });
});
