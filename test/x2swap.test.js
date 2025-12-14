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

    const X2UniswapExchange = await hre.ethers.getContractFactory("X2UniswapExchange", deployer);
    const x2uniswap = await X2UniswapExchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      x2uniswap.target,
      oracle.target,
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, g2.address, g3.address],
      [deployer.address],
      [WETH]
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

    const X2UniswapExchange = await hre.ethers.getContractFactory("X2UniswapExchange", deployer);
    const x2uniswap = await X2UniswapExchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      x2uniswap.target,
      oracle.target,
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [deployer.address],
      [WETH]
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
      swap.connect(trader).openPosition(1_000n * 10n ** BigInt(usdcDecimals), 500)
    );
    const openEvent = openReceipt.logs.find((l) => l.fragment && l.fragment.name === "OpenPosition");
    const posId = openEvent.args.id;
    expect(await pool.totalDebt()).to.equal(1_000n * 10n ** BigInt(usdcDecimals));

    await logTx("swap.closePosition", swap.connect(trader).closePosition(posId, 500));
    expect(await pool.totalDebt()).to.equal(0n);
    const traderEnd = await usdc.balanceOf(trader.address);
    expect(traderEnd).to.be.lte(traderStart); // round-trip on Uniswap typically loses to fees
  });

  it("openPosition snapshots utilization-based profit sharing", async function () {
    const [deployer, lender, trader] = await hre.ethers.getSigners();

    const X2UniswapExchange = await hre.ethers.getContractFactory("X2UniswapExchange", deployer);
    const x2uniswap = await X2UniswapExchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    const oracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      x2uniswap.target,
      oracle.target,
      0,
      30n * 24n * 60n * 60n,
      [deployer.address, lender.address, trader.address],
      [deployer.address],
      [WETH]
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

    // trader borrows 910 => utilization 91% -> pool share 30%
    await usdc.connect(trader).approve(swap.target, hre.ethers.MaxUint256);
    await logTx("swap.openPosition (high util)", swap.connect(trader).openPosition(910n * 10n ** BigInt(usdcDecimals), 500));
    const pos = await swap.positions(0);
    expect(pos[6]).to.equal(30n);
  });
});
