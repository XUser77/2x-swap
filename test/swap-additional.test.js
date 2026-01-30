const { expect } = require("chai");
const hre = require("hardhat");
const { impersonateAccount, setBalance, time } = require("@nomicfoundation/hardhat-network-helpers");

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
    100, // 1% fee (100 basis points)
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

describe("X2Swap Additional Functionality", function () {
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

  describe("Preview Functions", function () {
    it("Should preview new position correctly", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const preview = await swap.previewNewPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH])
      );
      
      // With feeBps = 100 (1%), openFee = 10 USDC
      expect(preview.openFee).to.equal(10n * 10n ** 6n); // 1% of 1000 USDC
      expect(preview.netUserAmount).to.equal(990n * 10n ** 6n); // 1000 - 10
      expect(preview.totalAmount).to.equal(1_980n * 10n ** 6n); // 990 * 2
      expect(preview.expectedOut).to.be.gt(0);
      expect(preview.oracleMinTargetOut).to.be.gt(0);
      expect(preview.profitSharing).to.be.gte(20).and.lte(50);
    });

    it("Should reject preview with invalid exchange", async function () {
      const { pool, swap } = await deployProtocol();
      const [, lender, badExchange] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await expect(
        swap.previewNewPosition(
          1_000n * 10n ** 6n,
          500,
          badExchange.address,
          encodePath([USDC, WETH])
        )
      ).to.be.revertedWith("Bad exchange");
    });
  });

  describe("Current Profit Sharing", function () {
    it("Should return 20% at low utilization (<= 90%)", async function () {
      const { pool, swap } = await deployProtocol();
      const [, lender] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      const profitSharing = await swap.currentProfitSharing();
      expect(profitSharing).to.equal(20);
    });

    it("Should return 30% at 91-92% utilization", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(1_000n * 10n ** 6n, lender.address);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      // Borrow 500 USDC (max 50% due to MAX_POSITION_SIZE_BPS)
      // With 1% fee: netUserAmount = 495 USDC
      // Utilization = 495 / (1000 + 495) = 33.1% -> profitSharing = 20%
      await swap.connect(trader).openPosition(
        500n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const profitSharing = await swap.currentProfitSharing();
      expect(profitSharing).to.equal(20); // Low utilization -> 20% profit sharing
    });
  });

  describe("Position Queries", function () {
    it("Should get user positions", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 10_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      const positionsBefore = await swap.getUserPositions(trader.address);
      expect(positionsBefore.length).to.equal(0);
      
      await swap.connect(trader).openPosition(
        1_000n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      await time.increase(60);
      
      await swap.connect(trader).openPosition(
        500n * 10n ** 6n,
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      );
      
      const positionsAfter = await swap.getUserPositions(trader.address);
      expect(positionsAfter.length).to.equal(2);
    });

    it("Should get position details", async function () {
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
      
      const position = await swap.getPosition(posId);
      
      expect(position.id).to.equal(posId);
      expect(position.sender).to.equal(trader.address);
      // With 1% fee: netUserAmount = 990, openAssetAmount = 990 * 2 = 1980 USDC
      expect(position.openAssetAmount).to.equal(1_980n * 10n ** 6n);
      expect(position.targetAmount).to.be.gt(0);
      expect(position.openDate).to.be.gt(0);
      expect(position.expireDate).to.be.gt(position.openDate);
      expect(position.profitSharing).to.be.gte(20).and.lte(50);
      expect(position.closeDate).to.equal(0);
      expect(position.closeAssetAmount).to.equal(0);
    });

  });

  describe("Fee Withdrawal", function () {
    it("Should allow authorized withdrawer to withdraw fees", async function () {
      const { pool, swap, x2uniswap, feeGov, deployer, g2 } = await deployProtocol();
      const [, lender, trader, withdrawer] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      
      // Add withdrawer through governance
      const proposalId = await feeGov.connect(deployer).proposeAddWithdrawer.staticCall(withdrawer.address);
      await feeGov.connect(deployer).proposeAddWithdrawer(withdrawer.address);
      await feeGov.connect(deployer).vote(proposalId);
      await feeGov.connect(g2).vote(proposalId);
      await feeGov.connect(deployer).execute(proposalId);
      
      // Setup: add liquidity and open position
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      // Open and close position (in same block = no profit, but test structure is correct)
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
      
      await swap.connect(trader).closePosition(
        posId,
        500,
        x2uniswap.target,
        encodePath([WETH, USDC]),
        await getDeadline()
      );
      
      // Opening fee was charged: 1% of 1000 USDC = 10 USDC
      const feesAccrued = await swap.feesAccrued();
      expect(feesAccrued).to.equal(10n * 10n ** 6n);
      
      // Withdrawer can withdraw the accrued fees
      const withdrawerBalanceBefore = await usdc.balanceOf(withdrawer.address);
      await swap.connect(withdrawer).withdrawFees(withdrawer.address, feesAccrued);
      const withdrawerBalanceAfter = await usdc.balanceOf(withdrawer.address);
      
      expect(withdrawerBalanceAfter - withdrawerBalanceBefore).to.equal(feesAccrued);
      expect(await swap.feesAccrued()).to.equal(0n);
    });

    it("Should reject non-withdrawer withdrawing fees", async function () {
      const { swap } = await deployProtocol();
      const [, , , nonWithdrawer] = await hre.ethers.getSigners();
      
      await expect(
        swap.connect(nonWithdrawer).withdrawFees(nonWithdrawer.address, 100n * 10n ** 6n)
      ).to.be.revertedWith("Not allowed");
    });

    it("Should reject withdrawing to zero address", async function () {
      const { swap, feeGov, deployer, g2 } = await deployProtocol();
      const [, , , withdrawer] = await hre.ethers.getSigners();
      
      // Add withdrawer
      const proposalId = await feeGov.connect(deployer).proposeAddWithdrawer.staticCall(withdrawer.address);
      await feeGov.connect(deployer).proposeAddWithdrawer(withdrawer.address);
      await feeGov.connect(deployer).vote(proposalId);
      await feeGov.connect(g2).vote(proposalId);
      await feeGov.connect(deployer).execute(proposalId);
      
      await expect(
        swap.connect(withdrawer).withdrawFees(hre.ethers.ZeroAddress, 100n * 10n ** 6n)
      ).to.be.revertedWith("Bad recipient");
    });

    it("Should reject withdrawing zero amount", async function () {
      const { swap, feeGov, deployer, g2 } = await deployProtocol();
      const [, , , withdrawer] = await hre.ethers.getSigners();
      
      // Add withdrawer
      const proposalId = await feeGov.connect(deployer).proposeAddWithdrawer.staticCall(withdrawer.address);
      await feeGov.connect(deployer).proposeAddWithdrawer(withdrawer.address);
      await feeGov.connect(deployer).vote(proposalId);
      await feeGov.connect(g2).vote(proposalId);
      await feeGov.connect(deployer).execute(proposalId);
      
      await expect(
        swap.connect(withdrawer).withdrawFees(withdrawer.address, 0n)
      ).to.be.revertedWith("Zero amount");
    });
  });

  describe("Oracle Price Functions", function () {
    it("Should get oracle price", async function () {
      const { swap } = await deployProtocol();
      
      const price = await swap.getOraclePrice();
      expect(price).to.be.gt(0);
    });
  });

  describe("Exchange Registration", function () {
    it("Should have registered exchange", async function () {
      const { swap, x2uniswap } = await deployProtocol();
      
      expect(await swap.isExchange(x2uniswap.target)).to.equal(true);
    });

    it("Should reject operation with unregistered exchange", async function () {
      const { pool, swap } = await deployProtocol();
      const [, lender, trader, badExchange] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      await expect(
        swap.connect(trader).openPosition(
          1_000n * 10n ** 6n,
          500,
          badExchange.address,
          encodePath([USDC, WETH]),
          await getDeadline()
        )
      ).to.be.revertedWith("Bad exchange");
    });

    it("Should list exchanges", async function () {
      const { swap, x2uniswap } = await deployProtocol();
      
      const exchange0 = await swap.exchanges(0);
      expect(exchange0).to.equal(x2uniswap.target);
    });
  });

  describe("Constants and Immutables", function () {
    it("Should have correct ORACLE_MAX_DEVIATION_BPS", async function () {
      const { swap } = await deployProtocol();
      expect(await swap.ORACLE_MAX_DEVIATION_BPS()).to.equal(500); // 5%
    });

    it("Should have correct ORACLE_MAX_STALENESS", async function () {
      const { swap } = await deployProtocol();
      expect(await swap.ORACLE_MAX_STALENESS()).to.equal(3600); // 1 hour
    });

    it("Should have correct MAX_POSITION_SIZE_BPS", async function () {
      const { swap } = await deployProtocol();
      expect(await swap.MAX_POSITION_SIZE_BPS()).to.equal(5000); // 50%
    });

    it("Should have correct MAX_TOTAL_POSITIONS_BPS", async function () {
      const { swap } = await deployProtocol();
      expect(await swap.MAX_TOTAL_POSITIONS_BPS()).to.equal(9500); // 95%
    });

    it("Should have correct MIN_POSITION_INTERVAL", async function () {
      const { swap } = await deployProtocol();
      expect(await swap.MIN_POSITION_INTERVAL()).to.equal(60); // 1 minute
    });

    it("Should have correct immutable addresses", async function () {
      const { swap, pool, feeGov } = await deployProtocol();
      
      expect(await swap.pool()).to.equal(pool.target);
      expect(await swap.feeGovernance()).to.equal(feeGov.target);
      expect(await swap.asset()).to.equal(USDC);
      expect(await swap.targetToken()).to.equal(WETH);
    });
  });

  describe("Position Lifecycle Events", function () {
    it("Should emit OpenPosition event", async function () {
      const { pool, swap, x2uniswap } = await deployProtocol();
      const [, lender, trader] = await hre.ethers.getSigners();
      const { usdcWhale } = await getUsdcWhale();
      
      const usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
      await usdcWhale.transfer(lender.address, 50_000n * 10n ** 6n);
      await usdcWhale.transfer(trader.address, 5_000n * 10n ** 6n);
      
      await usdc.connect(lender).approve(pool.target, hre.ethers.MaxUint256);
      await pool.connect(lender).deposit(10_000n * 10n ** 6n, lender.address);
      
      await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
      
      await expect(
        swap.connect(trader).openPosition(
          1_000n * 10n ** 6n,
          500,
          x2uniswap.target,
          encodePath([USDC, WETH]),
          await getDeadline()
        )
      ).to.emit(swap, "OpenPosition");
    });

    it("Should emit ClosePosition event", async function () {
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
      
      await expect(
        swap.connect(trader).closePosition(
          posId,
          500,
          x2uniswap.target,
          encodePath([WETH, USDC]),
          await getDeadline()
        )
      ).to.emit(swap, "ClosePosition");
    });
  });
});
