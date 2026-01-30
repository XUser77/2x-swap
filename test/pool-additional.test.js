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

// Helper to get future deadline
async function getDeadline() {
  const latestBlock = await hre.ethers.provider.getBlock('latest');
  return latestBlock.timestamp + 600;
}

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

describe("X2Pool Additional Functionality", function () {
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

  describe("Swap Registration", function () {
    it("Should allow deployer to register swap", async function () {
      const { pool, router } = await deployProtocol();
      const [, , , newSwap] = await hre.ethers.getSigners();
      
      // Need to impersonate the X2Deployer contract (which is the deployer for X2Pool)
      await impersonateAccount(router.target);
      await setBalance(router.target, hre.ethers.parseEther("1"));
      const routerSigner = await hre.ethers.getSigner(router.target);
      
      await pool.connect(routerSigner).registerSwap(newSwap.address);
      
      expect(await pool.isSwap(newSwap.address)).to.equal(true);
    });

    it("Should reject non-deployer registering swap", async function () {
      const { pool } = await deployProtocol();
      const [, , , nonDeployer, newSwap] = await hre.ethers.getSigners();
      
      await expect(
        pool.connect(nonDeployer).registerSwap(newSwap.address)
      ).to.be.revertedWith("Not deployer");
    });

    it("Should reject registering zero address swap", async function () {
      const { pool, router } = await deployProtocol();
      
      await impersonateAccount(router.target);
      await setBalance(router.target, hre.ethers.parseEther("1"));
      const routerSigner = await hre.ethers.getSigner(router.target);
      
      await expect(
        pool.connect(routerSigner).registerSwap(hre.ethers.ZeroAddress)
      ).to.be.revertedWith("Bad swap");
    });

    it("Should emit SwapRegistered event", async function () {
      const { pool, router } = await deployProtocol();
      const [, , , newSwap] = await hre.ethers.getSigners();
      
      await impersonateAccount(router.target);
      await setBalance(router.target, hre.ethers.parseEther("1"));
      const routerSigner = await hre.ethers.getSigner(router.target);
      
      await expect(
        pool.connect(routerSigner).registerSwap(newSwap.address)
      ).to.emit(pool, "SwapRegistered")
        .withArgs(newSwap.address);
    });
  });

  describe("Borrow Functionality", function () {
    it("Should allow registered swap to borrow", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const debtBefore = await pool.totalDebt();
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      await swap.connect(trader).openPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const debtAfter = await pool.totalDebt();
      expect(debtAfter).to.be.gt(debtBefore);
    });

    it("Should reject non-swap borrowing", async function () {
      const { pool } = await deployProtocol();
      const [, lender, nonSwap] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await expect(
        pool.connect(nonSwap).borrow(1_000n * 10n ** 6n)
      ).to.be.revertedWith("Not swap");
    });

    it("Should reject borrow of zero amount", async function () {
      const { pool, swap } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      // Impersonate swap to call borrow directly
      await impersonateAccount(swap.target);
      await setBalance(swap.target, hre.ethers.parseEther("1"));
      const swapSigner = await hre.ethers.getSigner(swap.target);
      
      await expect(
        pool.connect(swapSigner).borrow(0n)
      ).to.be.revertedWith("Zero amount");
    });

    it("Should reject borrow exceeding pool liquidity", async function () {
      const { pool, swap } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const totalAssets = await pool.totalAssets();
      
      await impersonateAccount(swap.target);
      await setBalance(swap.target, hre.ethers.parseEther("1"));
      const swapSigner = await hre.ethers.getSigner(swap.target);
      
      await expect(
        pool.connect(swapSigner).borrow(totalAssets + 1n)
      ).to.be.revertedWith("Insufficient pool liquidity");
    });

    it("Should reject borrow when paused", async function () {
      const { pool, swap, feeGov, deployer, g2 } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      // Pause
      const proposalId = await feeGov.connect(deployer).proposePause.staticCall();
      await feeGov.connect(deployer).proposePause();
      await feeGov.connect(deployer).vote(proposalId);
      await feeGov.connect(g2).vote(proposalId);
      await feeGov.connect(deployer).execute(proposalId);
      
      await impersonateAccount(swap.target);
      await setBalance(swap.target, hre.ethers.parseEther("1"));
      const swapSigner = await hre.ethers.getSigner(swap.target);
      
      await expect(
        pool.connect(swapSigner).borrow(1_000n * 10n ** 6n)
      ).to.be.revertedWith("Protocol emergency paused");
    });
  });

  describe("Return Borrow Functionality", function () {
    it("Should allow swap to return borrowed funds", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      const tx = await swap.connect(trader).openPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      const receipt = await tx.wait();
      const openEvent = receipt.logs.find(l => l.fragment && l.fragment.name === "OpenPosition");
      const posId = openEvent.args.id;
      
      const debtBefore = await pool.totalDebt();
      
      await swap.connect(trader).closePosition(
        posId,
        500,
        x2uniswap.target,
        encodePath([WETH, USDC]),
        await getDeadline()
      );
      
      const debtAfter = await pool.totalDebt();
      expect(debtAfter).to.be.lt(debtBefore);
    });

    it("Should reject non-swap returning", async function () {
      const { pool } = await deployProtocol();
      const [, , nonSwap] = await hre.ethers.getSigners();
      
      await expect(
        pool.connect(nonSwap).returnBorrow(1_000n * 10n ** 6n, 1_000n * 10n ** 6n)
      ).to.be.revertedWith("Not swap");
    });

    it("Should reject returning more debt than total debt", async function () {
      const { pool, swap } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await impersonateAccount(swap.target);
      await setBalance(swap.target, hre.ethers.parseEther("1"));
      const swapSigner = await hre.ethers.getSigner(swap.target);
      
      await expect(
        pool.connect(swapSigner).returnBorrow(1_000n * 10n ** 6n, 1_000n * 10n ** 6n)
      ).to.be.revertedWith("Exceeds debt");
    });
  });

  describe("View Functions", function () {
    it("Should return current utilization rate", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const utilizationBefore = await pool.currentUtilizationBps();
      expect(utilizationBefore).to.equal(0);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      await swap.connect(trader).openPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const utilizationAfter = await pool.currentUtilizationBps();
      expect(utilizationAfter).to.be.gt(0);
    });
  });

  describe("Mint Functionality", function () {
    it("Should allow minting shares", async function () {
      const { pool } = await deployProtocol();
      const [, alice] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(alice.address, 10_000n * 10n ** 6n);
      
      await usdc.connect(alice).approve(pool.target, hre.ethers.MaxUint256);
      
      const shares = 5_000n * 10n ** 6n;
      await pool.connect(alice).mint(shares, alice.address);
      
      expect(await pool.balanceOf(alice.address)).to.equal(shares);
    });

    it("Should enforce MIN_DEPOSIT in mint", async function () {
      const { pool } = await deployProtocol();
      const [, alice] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(alice.address, 10_000n * 10n ** 6n);
      
      await usdc.connect(alice).approve(pool.target, hre.ethers.MaxUint256);
      
      // Try to mint shares that would require < MIN_DEPOSIT assets
      await expect(
        pool.connect(alice).mint(100n, alice.address)
      ).to.be.revertedWith("Deposit amount too small");
    });
  });
});
