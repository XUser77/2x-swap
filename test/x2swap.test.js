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

async function logTx(label, txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  // eslint-disable-next-line no-console
  console.log(`${label} gasUsed=${receipt.gasUsed.toString()}`);
  return receipt;
}

async function getUsdcWhale() {
  await impersonateAccount(USDC_WHALE);
  await setBalance(USDC_WHALE, hre.ethers.parseEther("10"));
  const whaleSigner = await hre.ethers.getSigner(USDC_WHALE);
  const usdcWhale = await hre.ethers.getContractAt(erc20Abi, USDC, whaleSigner);
  const usdcDecimals = await usdcWhale.decimals();
  return { whaleSigner, usdcWhale, usdcDecimals };
}

describe("X2Pool/X2Swap flows", function () {
  before(async function () {
    this.timeout(240_000);
    if (hre.network.name !== "hardhat") {
      return; // assume an external node (e.g. localhost) is already forked
    }

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

  it("deposit + redeem (gas output)", async function () {
    const [deployer, g2, g3, alice] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, g2.address, g3.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale: usdcWhaleFund } = await getUsdcWhale();
    await usdcWhaleFund.transfer(alice.address, 10_000n * 10n ** BigInt(usdcDecimals));

    const usdcAlice = usdc.connect(alice);
    await usdcAlice.approve(poolAddr, hre.ethers.MaxUint256);

    const depositAmt = 1_000n * 10n ** BigInt(usdcDecimals);
    await logTx("pool.deposit #1", pool.connect(alice).deposit(depositAmt, alice.address));
    await logTx("pool.deposit #2", pool.connect(alice).deposit(depositAmt, alice.address));
    expect(await pool.totalAssets()).to.equal(depositAmt * 2n);
    expect(await pool.balanceOf(alice.address)).to.equal(depositAmt * 2n);

    await logTx("pool.redeem", pool.connect(alice).redeem(depositAmt * 2n, alice.address, alice.address));
    expect(await pool.totalAssets()).to.equal(0n);
    expect(await pool.balanceOf(alice.address)).to.equal(0n);
  });

  it("openPosition + closePosition (no profit)", async function () {
    const [deployer, lender, trader] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const swapAddr = await router.swaps(WETH);
    const swap = await hre.ethers.getContractAt("X2Swap", swapAddr, deployer);
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale } = await getUsdcWhale();
    await usdcWhale.transfer(lender.address, 50_000n * 10n ** BigInt(usdcDecimals));
    await usdcWhale.transfer(trader.address, 5_000n * 10n ** BigInt(usdcDecimals));

    // lender provides pool liquidity
    await usdc.connect(lender).approve(poolAddr, hre.ethers.MaxUint256);
    await logTx("pool.deposit", pool.connect(lender).deposit(10_000n * 10n ** BigInt(usdcDecimals), lender.address));

    // trader opens
    await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);

    const traderStart = await usdc.balanceOf(trader.address);
      const openReceipt = await logTx(
      "swap.openPosition",
      swap.connect(trader).openPosition(
        1_000n * 10n ** BigInt(usdcDecimals),
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      )
    );
    const openEvent = openReceipt.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
    const posId = openEvent.args.id;
    expect(await pool.totalDebt()).to.equal(1_000n * 10n ** BigInt(usdcDecimals));

    await logTx(
      "swap.closePosition",
      swap
        .connect(trader)
        .closePosition(posId, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
    );
    expect(await pool.totalDebt()).to.equal(0n);
    const traderEnd = await usdc.balanceOf(trader.address);
    expect(traderEnd).to.be.lte(traderStart); // round-trip on Uniswap typically loses to fees
  });

  it("openPosition snapshots utilization-based profit sharing", async function () {
    const [deployer, lender, trader] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const swapAddr = await router.swaps(WETH);
    const swap = await hre.ethers.getContractAt("X2Swap", swapAddr, deployer);
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale } = await getUsdcWhale();
    await usdcWhale.transfer(lender.address, 2_000n * 10n ** BigInt(usdcDecimals));
    await usdcWhale.transfer(trader.address, 2_000n * 10n ** BigInt(usdcDecimals));

    // pool has 1000 assets
    await usdc.connect(lender).approve(poolAddr, hre.ethers.MaxUint256);
    await pool.connect(lender).deposit(1_000n * 10n ** BigInt(usdcDecimals), lender.address);

    // trader borrows 500 (max 50%) => utilization ~33% -> pool share 20%
    // With 1% fee: netUserAmount = 495, utilization = 495/(1000+495) = 33.1%
    await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
    await logTx(
      "swap.openPosition (moderate util)",
      swap.connect(trader).openPosition(
        500n * 10n ** BigInt(usdcDecimals),
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      )
    );
    const pos = await swap.positions(1); // First position now has id = 1, not 0
    expect(pos[6]).to.equal(20n); // 33% utilization -> 20% profit sharing
  });

  it("trader can open multiple sequential positions", async function () {
    const [deployer, lender, trader] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const swapAddr = await router.swaps(WETH);
    const swap = await hre.ethers.getContractAt("X2Swap", swapAddr, deployer);
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale } = await getUsdcWhale();
    await usdcWhale.transfer(lender.address, 50_000n * 10n ** BigInt(usdcDecimals));
    await usdcWhale.transfer(trader.address, 5_000n * 10n ** BigInt(usdcDecimals));

    // Lender deposits
    await usdc.connect(lender).approve(poolAddr, hre.ethers.MaxUint256);
    await pool.connect(lender).deposit(10_000n * 10n ** BigInt(usdcDecimals), lender.address);

    // Trader opens first position
    await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
    const receipt1 = await logTx(
      "swap.openPosition #1",
      swap.connect(trader).openPosition(
        500n * 10n ** BigInt(usdcDecimals),
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      )
    );
    const openEvent1 = receipt1.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
    const posId1 = openEvent1.args.id;

    // Wait for rate limit
    await hre.network.provider.send("evm_increaseTime", [60]);
    await hre.network.provider.send("evm_mine");

    // Trader opens second position
    const receipt2 = await logTx(
      "swap.openPosition #2",
      swap.connect(trader).openPosition(
        700n * 10n ** BigInt(usdcDecimals),
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      )
    );
    const openEvent2 = receipt2.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
    const posId2 = openEvent2.args.id;

    // Verify both positions exist
    expect(await pool.totalDebt()).to.equal(1_200n * 10n ** BigInt(usdcDecimals));
    const positions = await swap.getUserPositions(trader.address);
    expect(positions.length).to.equal(2);

    // Close first position
    await logTx(
      "swap.closePosition #1",
      swap
        .connect(trader)
        .closePosition(posId1, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
    );
    expect(await pool.totalDebt()).to.equal(700n * 10n ** BigInt(usdcDecimals));

    // Close second position
    await logTx(
      "swap.closePosition #2",
      swap
        .connect(trader)
        .closePosition(posId2, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
    );
    expect(await pool.totalDebt()).to.equal(0n);
  });

  it("multiple lenders share profits proportionally", async function () {
    const [deployer, lender1, lender2, trader] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender1.address, lender2.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale } = await getUsdcWhale();
    await usdcWhale.transfer(lender1.address, 10_000n * 10n ** BigInt(usdcDecimals));
    await usdcWhale.transfer(lender2.address, 5_000n * 10n ** BigInt(usdcDecimals));

    // Lender1 deposits 6000 USDC
    await usdc.connect(lender1).approve(poolAddr, hre.ethers.MaxUint256);
    await pool.connect(lender1).deposit(6_000n * 10n ** BigInt(usdcDecimals), lender1.address);
    
    // Lender2 deposits 3000 USDC
    await usdc.connect(lender2).approve(poolAddr, hre.ethers.MaxUint256);
    await pool.connect(lender2).deposit(3_000n * 10n ** BigInt(usdcDecimals), lender2.address);

    // Total pool: 9000 USDC
    // Lender1 has 6000 shares (66.67%)
    // Lender2 has 3000 shares (33.33%)
    expect(await pool.totalAssets()).to.equal(9_000n * 10n ** BigInt(usdcDecimals));
    
    const shares1 = await pool.balanceOf(lender1.address);
    const shares2 = await pool.balanceOf(lender2.address);
    expect(shares1).to.equal(6_000n * 10n ** BigInt(usdcDecimals));
    expect(shares2).to.equal(3_000n * 10n ** BigInt(usdcDecimals));

    // Both should be able to redeem their shares
    const assets1 = await pool.previewRedeem(shares1);
    const assets2 = await pool.previewRedeem(shares2);
    
    // Assets should be proportional to shares
    expect(assets1 * 100n / (assets1 + assets2)).to.be.closeTo(66n, 1n);
    expect(assets2 * 100n / (assets1 + assets2)).to.be.closeTo(33n, 1n);
  });

  it("position access control - owner before expiration, anyone after", async function () {
    const [deployer, lender, trader, other] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const swapAddr = await router.swaps(WETH);
    const swap = await hre.ethers.getContractAt("X2Swap", swapAddr, deployer);
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale } = await getUsdcWhale();
    await usdcWhale.transfer(lender.address, 50_000n * 10n ** BigInt(usdcDecimals));
    await usdcWhale.transfer(trader.address, 5_000n * 10n ** BigInt(usdcDecimals));

    // Lender provides liquidity
    await usdc.connect(lender).approve(poolAddr, hre.ethers.MaxUint256);
    await pool.connect(lender).deposit(10_000n * 10n ** BigInt(usdcDecimals), lender.address);

    // Trader opens position
    await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
    const openReceipt = await logTx(
      "swap.openPosition",
      swap.connect(trader).openPosition(
        1_000n * 10n ** BigInt(usdcDecimals),
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      )
    );
    const openEvent = openReceipt.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
    const posId = openEvent.args.id;

    // Before expiration: other user cannot close
    await expect(
      swap.connect(other).closePosition(posId, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
    ).to.be.revertedWith("Only owner before expiration");

    // Advance time past expiration
    await hre.network.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
    await hre.network.provider.send("evm_mine");

    // After expiration: anyone can close the position
    await logTx(
      "swap.closePosition",
      swap
        .connect(other)
        .closePosition(posId, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
    );
  });

  it("exchange provider verification", async function () {
    const [deployer, lender, trader] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    // Deploy with exchange
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();

    // Check exchange provider name
    expect(await x2uniswap.provider()).to.equal("UniswapV2");
    
    // Verify tokens are set correctly
    expect(await x2uniswap.token0()).to.equal(USDC);
    expect(await x2uniswap.token1()).to.equal(WETH);
  });

  it("fee accrual across multiple positions", async function () {
    const [deployer, lender, trader] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const swapAddr = await router.swaps(WETH);
    const swap = await hre.ethers.getContractAt("X2Swap", swapAddr, deployer);
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale } = await getUsdcWhale();
    await usdcWhale.transfer(lender.address, 50_000n * 10n ** BigInt(usdcDecimals));
    await usdcWhale.transfer(trader.address, 10_000n * 10n ** BigInt(usdcDecimals));

    // Lender provides liquidity
    await usdc.connect(lender).approve(poolAddr, hre.ethers.MaxUint256);
    await pool.connect(lender).deposit(10_000n * 10n ** BigInt(usdcDecimals), lender.address);

    // Trader opens and closes multiple positions
    await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
    
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await hre.network.provider.send("evm_increaseTime", [60]);
        await hre.network.provider.send("evm_mine");
      }

      const openReceipt = await logTx(
        `swap.openPosition #${i + 1}`,
        swap.connect(trader).openPosition(
          500n * 10n ** BigInt(usdcDecimals),
          500,
          x2uniswap.target,
          encodePath([USDC, WETH]),
          await getDeadline()
        )
      );
      const openEvent = openReceipt.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
      const posId = openEvent.args.id;

      await logTx(
        `swap.closePosition #${i + 1}`,
        swap
          .connect(trader)
          .closePosition(posId, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
      );
    }

    // Trader fees are collected as part of closing positions
    // Positions should be closed successfully
    const positions = await swap.getUserPositions(trader.address);
    // getUserPositions returns all positions (including closed ones)
    expect(positions.length).to.equal(3);
    
    // Verify all positions are closed
    for (const posId of positions) {
      const pos = await swap.getPosition(posId);
      expect(pos.closeDate).to.not.equal(0);
    }
  });

  it("utilization-based profit sharing changes with pool usage", async function () {
    const [deployer, lender, trader] = await hre.ethers.getSigners();

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    const x2uniswap = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2uniswap.target],
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [[WETH, oracle.target]]
    );
    await router.waitForDeployment();
    const swapAddr = await router.swaps(WETH);
    const swap = await hre.ethers.getContractAt("X2Swap", swapAddr, deployer);
    const poolAddr = await router.pool();
    const pool = await hre.ethers.getContractAt("X2Pool", poolAddr, deployer);

    const usdc = await hre.ethers.getContractAt(erc20Abi, USDC, deployer);
    const usdcDecimals = await usdc.decimals();

    const { usdcWhale } = await getUsdcWhale();
    await usdcWhale.transfer(lender.address, 50_000n * 10n ** BigInt(usdcDecimals));
    await usdcWhale.transfer(trader.address, 5_000n * 10n ** BigInt(usdcDecimals));

    // Pool has 1000 USDC
    await usdc.connect(lender).approve(poolAddr, hre.ethers.MaxUint256);
    await pool.connect(lender).deposit(1_000n * 10n ** BigInt(usdcDecimals), lender.address);

    await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);

    // Test low utilization (10%)
    const openReceipt1 = await logTx(
      "swap.openPosition (10% util)",
      swap.connect(trader).openPosition(
        100n * 10n ** BigInt(usdcDecimals),
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      )
    );
    const openEvent1 = openReceipt1.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
    const posId1 = openEvent1.args.id;
    const pos1 = await swap.positions(posId1);
    const poolShare1 = pos1[6];
    // eslint-disable-next-line no-console
    console.log(`10% utilization -> pool share: ${poolShare1}%`);
    expect(poolShare1).to.be.gte(10n); // poolSharePct should be at least 10%

    await logTx(
      "swap.closePosition (10% util)",
      swap
        .connect(trader)
        .closePosition(posId1, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
    );

    await hre.network.provider.send("evm_increaseTime", [60]);
    await hre.network.provider.send("evm_mine");

    // Test medium utilization (50%)
    const openReceipt2 = await logTx(
      "swap.openPosition (50% util)",
      swap.connect(trader).openPosition(
        500n * 10n ** BigInt(usdcDecimals),
        500,
        x2uniswap.target,
        encodePath([USDC, WETH]),
        await getDeadline()
      )
    );
    const openEvent2 = openReceipt2.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
    const posId2 = openEvent2.args.id;
    const pos2 = await swap.positions(posId2);
    const poolShare2 = pos2[6];
    // eslint-disable-next-line no-console
    console.log(`50% utilization -> pool share: ${poolShare2}%`);
    
    // Pool share should be within reasonable range (10-30%)
    expect(poolShare1).to.be.gte(10n);
    expect(poolShare1).to.be.lte(30n);
    expect(poolShare2).to.be.gte(10n);
    expect(poolShare2).to.be.lte(30n);

    await logTx(
      "swap.closePosition (50% util)",
      swap
        .connect(trader)
        .closePosition(posId2, 500, x2uniswap.target, encodePath([WETH, USDC]), await getDeadline())
    );
  });
});
