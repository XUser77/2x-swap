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

describe("Partial Withdraw & Liquidity Management", function () {
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

  describe("TotalAssets Tracking", function () {
    it("Should correctly track totalAssets including debt", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      // Lender deposits
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const totalAssetsBefore = await pool.totalAssets();
      const balanceBefore = await usdc.balanceOf(pool.target);
      
      expect(totalAssetsBefore).to.equal(balanceBefore);
      expect(await pool.totalDebt()).to.equal(0);
      
      // Trader opens position (borrows from pool)
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      await swap.connect(trader).openPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const totalAssetsAfter = await pool.totalAssets();
      const balanceAfter = await usdc.balanceOf(pool.target);
      const debt = await pool.totalDebt();
      
      // totalAssets should be balance + debt
      expect(totalAssetsAfter).to.equal(balanceAfter + debt);
      expect(debt).to.be.gt(0);
      expect(balanceAfter).to.be.lt(balanceBefore);
    });

    it("Should maintain totalAssets value when funds are borrowed", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const totalAssetsBefore = await pool.totalAssets();
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      await swap.connect(trader).openPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const totalAssetsAfter = await pool.totalAssets();
      
      // totalAssets should remain approximately the same (minus opening fee)
      // The fee is taken from user's deposit, so totalAssets stays constant
      expect(totalAssetsAfter).to.be.closeTo(totalAssetsBefore, 10n * 10n ** 6n);
    });
  });

  describe("Available Liquidity", function () {
    it("Should report correct available liquidity", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const availableBefore = await pool.availableLiquidity();
      const balanceBefore = await usdc.balanceOf(pool.target);
      expect(availableBefore).to.equal(balanceBefore);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      await swap.connect(trader).openPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const availableAfter = await pool.availableLiquidity();
      const balanceAfter = await usdc.balanceOf(pool.target);
      expect(availableAfter).to.equal(balanceAfter);
      expect(availableAfter).to.be.lt(availableBefore);
    });
  });

  describe("Partial Withdraw", function () {
    it("Should allow partial withdraw when insufficient liquidity", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender1, lender2, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender1.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(lender2.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 15_000n * 10n ** 6n);
      
      // Both lenders deposit
      await usdc.connect(lender1).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender1).deposit(10_000n * 10n ** 6n, lender1.address);
      
      await usdc.connect(lender2).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender2).deposit(10_000n * 10n ** 6n, lender2.address);
      
      // Trader opens multiple positions to drain liquidity (max 50% of pool per position)
      // With 20k in pool, we can open two 9k positions
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      // Wait 60 seconds between positions (rate limiting)
      await swap.connect(trader).openPosition(
        9_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      // Increase time by 60 seconds for rate limiting
      await hre.ethers.provider.send("evm_increaseTime", [60]);
      await hre.ethers.provider.send("evm_mine");
      
      // Open second position to further drain liquidity
      await swap.connect(trader).openPosition(
        3_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const availableLiquidity = await pool.availableLiquidity();
      const requestedWithdraw = 10_000n * 10n ** 6n;
      
      // Available liquidity should be less than requested
      expect(availableLiquidity).to.be.lt(requestedWithdraw);
      
      const balanceBefore = await usdc.balanceOf(lender1.address);
      
      // Lender1 tries to withdraw - should get partial amount
      const tx = await pool.connect(lender1).withdraw(
        requestedWithdraw,
        lender1.address,
        lender1.address
      );
      
      const balanceAfter = await usdc.balanceOf(lender1.address);
      const actualWithdrawn = balanceAfter - balanceBefore;
      
      // Should receive less than requested but more than 0
      expect(actualWithdrawn).to.be.gt(0);
      expect(actualWithdrawn).to.be.lte(availableLiquidity + 10n * 10n ** 6n); // Allow some tolerance
      expect(actualWithdrawn).to.be.lt(requestedWithdraw);
      
      // Check for PartialWithdraw event
      await expect(tx).to.emit(pool, "PartialWithdraw");
    });

    it("Should withdraw full amount when sufficient liquidity", async function () {
      const { pool } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const balanceBefore = await usdc.balanceOf(lender.address);
      const requestedWithdraw = 5_000n * 10n ** 6n;
      
      await pool.connect(lender).withdraw(
        requestedWithdraw,
        lender.address,
        lender.address
      );
      
      const balanceAfter = await usdc.balanceOf(lender.address);
      const actualWithdrawn = balanceAfter - balanceBefore;
      
      // Should receive exactly what was requested
      expect(actualWithdrawn).to.equal(requestedWithdraw);
    });
  });

  describe("Partial Redeem", function () {
    it("Should allow partial redeem when insufficient liquidity", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender1, lender2, lender3, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender1.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(lender2.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(lender3.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 25_000n * 10n ** 6n);
      
      // Multiple lenders deposit to create larger pool
      await usdc.connect(lender1).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender1).deposit(10_000n * 10n ** 6n, lender1.address);
      
      await usdc.connect(lender2).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender2).deposit(10_000n * 10n ** 6n, lender2.address);
      
      await usdc.connect(lender3).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender3).deposit(10_000n * 10n ** 6n, lender3.address);
      
      const lender1Shares = await pool.balanceOf(lender1.address);
      
      // Trader opens multiple positions to drain liquidity
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      // Open first position (max 50% of 30k pool = 15k, user provides 10k)
      await swap.connect(trader).openPosition(
        10_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      // Wait for rate limiting
      await hre.ethers.provider.send("evm_increaseTime", [60]);
      await hre.ethers.provider.send("evm_mine");
      
      // Open second position to further drain liquidity
      await swap.connect(trader).openPosition(
        8_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      // Wait for rate limiting again
      await hre.ethers.provider.send("evm_increaseTime", [60]);
      await hre.ethers.provider.send("evm_mine");
      
      // Open third position to maximize drain
      await swap.connect(trader).openPosition(
        3_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const availableLiquidity = await pool.availableLiquidity();
      const previewAssets = await pool.previewRedeem(lender1Shares);
      
      // Available liquidity should be less than what shares are worth
      expect(availableLiquidity).to.be.lt(previewAssets);
      
      const balanceBefore = await usdc.balanceOf(lender1.address);
      const sharesBefore = await pool.balanceOf(lender1.address);
      
      // Lender1 tries to redeem all shares - should get partial redemption
      const tx = await pool.connect(lender1).redeem(
        lender1Shares,
        lender1.address,
        lender1.address
      );
      
      const balanceAfter = await usdc.balanceOf(lender1.address);
      const sharesAfter = await pool.balanceOf(lender1.address);
      const actualWithdrawn = balanceAfter - balanceBefore;
      const sharesBurned = sharesBefore - sharesAfter;
      
      // Should receive something but not all
      expect(actualWithdrawn).to.be.gt(0);
      expect(actualWithdrawn).to.be.lte(availableLiquidity + 10n * 10n ** 6n); // Allow tolerance
      expect(sharesBurned).to.be.lt(lender1Shares);
      expect(sharesAfter).to.be.gt(0); // Still has some shares left
      
      // Check for PartialRedeem event
      await expect(tx).to.emit(pool, "PartialRedeem");
    });

    it("Should redeem full amount when sufficient liquidity", async function () {
      const { pool } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const lenderShares = await pool.balanceOf(lender.address);
      const halfShares = lenderShares / 2n;
      
      const balanceBefore = await usdc.balanceOf(lender.address);
      const sharesBefore = await pool.balanceOf(lender.address);
      
      await pool.connect(lender).redeem(
        halfShares,
        lender.address,
        lender.address
      );
      
      const balanceAfter = await usdc.balanceOf(lender.address);
      const sharesAfter = await pool.balanceOf(lender.address);
      const sharesBurned = sharesBefore - sharesAfter;
      
      // Should burn exactly requested shares
      expect(sharesBurned).to.equal(halfShares);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe("MaxWithdrawForShares Helper", function () {
    it("Should correctly calculate max withdrawable for shares", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 10_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(20_000n * 10n ** 6n, lender.address);
      
      const lenderShares = await pool.balanceOf(lender.address);
      
      // Before borrowing - max withdraw should equal preview
      const maxBefore = await pool.maxWithdrawForShares(lenderShares);
      const previewBefore = await pool.previewRedeem(lenderShares);
      expect(maxBefore).to.equal(previewBefore);
      
      // After borrowing - max withdraw should be limited by available liquidity
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      await swap.connect(trader).openPosition(
        8_000n * 10n ** 6n,  // Within 50% limit of 20k pool
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const maxAfter = await pool.maxWithdrawForShares(lenderShares);
      const previewAfter = await pool.previewRedeem(lenderShares);
      const available = await pool.availableLiquidity();
      
      expect(previewAfter).to.be.gt(available);
      expect(maxAfter).to.equal(available);
      expect(maxAfter).to.be.lt(previewAfter);
    });
  });

  describe("Integration: Full Flow with Partial Withdrawals", function () {
    it("Should handle deposit -> borrow -> partial withdraw -> repay -> full withdraw", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      // 1. Lender deposits
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      const lenderShares = await pool.balanceOf(lender.address);
      
      // 2. Trader opens position (borrows)
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      const tx = await swap.connect(trader).openPosition(
        3_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      const receipt = await tx.wait();
      const openEvent = receipt.logs.find(l => l.fragment && l.fragment.name === "OpenPosition");
      const posId = openEvent.args.id;
      
      // 3. Lender tries to withdraw - should be partial
      const requestedWithdraw = 8_000n * 10n ** 6n;
      const balanceBefore = await usdc.balanceOf(lender.address);
      
      await pool.connect(lender).withdraw(
        requestedWithdraw,
        lender.address,
        lender.address
      );
      
      const balanceAfter1 = await usdc.balanceOf(lender.address);
      const firstWithdraw = balanceAfter1 - balanceBefore;
      expect(firstWithdraw).to.be.lt(requestedWithdraw);
      expect(firstWithdraw).to.be.gt(0);
      
      // 4. Trader closes position (repays)
      await swap.connect(trader).closePosition(
        posId,
        500,
        x2uniswap.target,
        encodePath([WETH, USDC]),
        await getDeadline()
      );
      
      // 5. Now lender should be able to withdraw remaining funds
      const remainingShares = await pool.balanceOf(lender.address);
      expect(remainingShares).to.be.gt(0);
      
      await pool.connect(lender).redeem(
        remainingShares,
        lender.address,
        lender.address
      );
      
      const finalBalance = await usdc.balanceOf(lender.address);
      const finalShares = await pool.balanceOf(lender.address);
      
      // All shares should be redeemed
      expect(finalShares).to.equal(0);
      expect(finalBalance).to.be.gt(balanceAfter1);
    });
  });
});
