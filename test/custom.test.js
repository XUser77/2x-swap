const hre = require("hardhat");
const {impersonateAccount, setBalance, time} = require("@nomicfoundation/hardhat-network-helpers");
const {expect} = require("chai");
const {ethers} = require("hardhat");

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNISWAP_V3_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const UNISWAP_V3_QUOTER = "0x5e55c9e631fae526cd4b0526c4818d6e0a9ef0e3";
const ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const USDC_WHALE = "0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341";
const WETH_WHALE = "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8";

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)"
];

const oracleAbi = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)"
];

const wethAbi = [
  "function deposit() public payable",
  "function withdraw(uint256 wad) public",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)"
];

const encodePath = (path) => hre.ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [path]);
function encodeV3Path(tokens, fees) {
  let path = "0x";
  for (let i = 0; i < tokens.length; i++) {
    path += tokens[i].slice(2);
    if (i < fees.length) {
      path += fees[i].toString(16).padStart(6, "0");
    }
  }
  return path;
}

async function getDeadline() {
  const latestBlock = await hre.ethers.provider.getBlock('latest');
  return latestBlock.timestamp + 600;
}

describe("Custom tests", function() {

  let oracle;
  let fakeOracle;

  let deployer, gov1, gov2, gov3, gov4, gov5, investor1, investor2, richInvestor, wethInvestor, borrower1, borrower2, borrower3, borrower4, borrower5;

  let usdc, usdcDecimals;

  let weth;

  let x2UniswapV2Exchange, x2UniswapV3Exchange, x2Pool, x2Swap, feeGovernance, router;

  function getUsdc(value) {
    return value * 10n ** usdcDecimals;
  }

  before(async function () {
    this.timeout(240_000);
    if (hre.network.name !== "hardhat") {
      return; // assume an external node (e.g. localhost) is already forked
    }

    const configuredUrl = hre.network.config.forking && hre.network.config.forking.url;
    const forkUrl = configuredUrl || process.env.MAINNET_RPC || process.env.FORK_URL;
    if (!forkUrl) this();

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: forkUrl } }]
    });

    [
      deployer,
      gov1, gov2, gov3, gov4, gov5,
      investor1, investor2, richInvestor, wethInvestor,
      borrower1, borrower2, borrower3, borrower4, borrower5] = await hre.ethers.getSigners();

    usdc = await hre.ethers.getContractAt(erc20Abi, USDC);
    usdcDecimals = await usdc.decimals();

    weth = await hre.ethers.getContractAt(wethAbi, WETH);

    oracle = await hre.ethers.getContractAt(oracleAbi, ORACLE);

    const FakeOracle = await hre.ethers.getContractFactory("FakeOracle", deployer);
    fakeOracle = await FakeOracle.deploy(UNISWAP_V2_ROUTER, USDC, WETH);

    const X2UniswapV2Exchange = await hre.ethers.getContractFactory("X2UniswapV2Exchange", deployer);
    x2UniswapV2Exchange = await X2UniswapV2Exchange.deploy(USDC, WETH, UNISWAP_V2_ROUTER);
    x2UniswapV2Exchange.address = await x2UniswapV2Exchange.getAddress();

    const X2UniswapV3Exchange = await hre.ethers.getContractFactory("X2UniswapV3Exchange", deployer);
    x2UniswapV3Exchange = await X2UniswapV3Exchange.deploy(USDC, WETH, UNISWAP_V3_ROUTER, UNISWAP_V3_QUOTER, 3000n);
    x2UniswapV3Exchange.address = await x2UniswapV3Exchange.getAddress();

    await (async () => {
      const oracleData = await oracle.latestRoundData();
      const rawPrice = parseInt(oracleData[1]);
      const updateDate = new Date(parseInt(oracleData[3]) * 1000);
      const decimals = parseInt(await oracle.decimals());

      const price = rawPrice / (10 ** decimals);
      let updateDateString = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(updateDate);

      console.debug(`\tOracle address: ${await oracle.getAddress()})`);
      console.debug(`\tOracle price: ${price} (${updateDateString})`);
      console.debug("\t--------------------------------------------")
    })();
  });

  beforeEach(async function () {
    this.timeout(240_000);

    // Clean USDC balance
    await usdc.connect(investor1).transfer(USDC_WHALE, await(usdc.balanceOf(investor1)));
    await usdc.connect(investor2).transfer(USDC_WHALE, await(usdc.balanceOf(investor2)));
    await usdc.connect(richInvestor).transfer(USDC_WHALE, await(usdc.balanceOf(richInvestor)));
    await usdc.connect(borrower1).transfer(USDC_WHALE, await(usdc.balanceOf(borrower1)));
    await usdc.connect(borrower2).transfer(USDC_WHALE, await(usdc.balanceOf(borrower2)));
    await usdc.connect(borrower3).transfer(USDC_WHALE, await(usdc.balanceOf(borrower3)));
    await usdc.connect(borrower4).transfer(USDC_WHALE, await(usdc.balanceOf(borrower4)));
    await usdc.connect(borrower5).transfer(USDC_WHALE, await(usdc.balanceOf(borrower5)));

    // Update USDC balance
    await impersonateAccount(USDC_WHALE);
    await setBalance(USDC_WHALE, hre.ethers.parseEther("10"));
    const usdcWhale = await hre.ethers.getSigner(USDC_WHALE);
    await Promise.all([
      usdc.connect(usdcWhale).transfer(investor1.address, getUsdc(1_000_000n)),
      usdc.connect(usdcWhale).transfer(investor2.address, getUsdc(1_000_000n)),
      usdc.connect(usdcWhale).transfer(richInvestor.address, getUsdc(20_000_000n)),
      usdc.connect(usdcWhale).transfer(borrower1.address, getUsdc(1_000_000n)),
      usdc.connect(usdcWhale).transfer(borrower2.address, getUsdc(1_000_000n)),
      usdc.connect(usdcWhale).transfer(borrower3.address, getUsdc(1_000_000n)),
      usdc.connect(usdcWhale).transfer(borrower4.address, getUsdc(1_000_000n)),
      usdc.connect(usdcWhale).transfer(borrower5.address, getUsdc(1_000_000n))
    ]);

    // Update WETH balance
    await impersonateAccount(WETH_WHALE);
    await setBalance(WETH_WHALE, hre.ethers.parseEther("10"));
    const wethWhale = await hre.ethers.getSigner(WETH_WHALE);
    await weth.connect(wethInvestor).transfer(wethWhale, await weth.balanceOf(wethInvestor));
    await weth.connect(wethWhale).transfer(wethInvestor, hre.ethers.parseEther("100000"));

    // Reset ETH balance
    await Promise.all(
      [
        await setBalance(investor1.address, hre.ethers.parseEther("10")),
        await setBalance(investor2.address, hre.ethers.parseEther("10")),
        await setBalance(richInvestor.address, hre.ethers.parseEther("20000")),
        await setBalance(borrower1.address, hre.ethers.parseEther("10")),
        await setBalance(borrower2.address, hre.ethers.parseEther("10")),
        await setBalance(borrower3.address, hre.ethers.parseEther("10")),
        await setBalance(borrower4.address, hre.ethers.parseEther("10")),
        await setBalance(borrower5.address, hre.ethers.parseEther("10"))
      ]
    );

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    router = await X2Deployer.deploy(
      USDC,
      [x2UniswapV2Exchange.address],
      0n,
      365n * 24n * 60n * 60n,
      [gov1.address, gov2.address, gov3.address, gov4.getAddress(), gov5.address],
      [[WETH, await fakeOracle.getAddress()]]
    );

    x2Swap = await hre.ethers.getContractAt("X2Swap", await router.swaps(WETH));
    x2Pool = await hre.ethers.getContractAt("X2Pool", await router.pool());
    feeGovernance = await hre.ethers.getContractAt("FeeGovernance", await router.feeGovernance());

    x2Swap.address = await x2Swap.getAddress();
    x2Pool.address = await x2Pool.getAddress();

    // console.debug("\tX2Uniswap address: "  + await x2UniswapV2Exchange.getAddress());
    // console.info(`\tX2Deployer: ${await router.getAddress()}`);
    // console.info(`\tX2Swap: ${await x2Swap.getAddress()}`);
    // console.info(`\tX2Pool: ${await x2Pool.getAddress()}`);

  });

  it("Initial balance", async function() {
    expect(await ethers.provider.getBalance(investor1.address)).to.equal(hre.ethers.parseEther("10"));
    expect(await ethers.provider.getBalance(investor2.address)).to.equal(hre.ethers.parseEther("10"));
    expect(await ethers.provider.getBalance(borrower1.address)).to.equal(hre.ethers.parseEther("10"));
    expect(await ethers.provider.getBalance(borrower2.address)).to.equal(hre.ethers.parseEther("10"));

    expect(await usdc.balanceOf(investor1)).to.equal(getUsdc(1_000_000n));
    expect(await usdc.balanceOf(investor2)).to.equal(getUsdc(1_000_000n));
    expect(await usdc.balanceOf(borrower1)).to.equal(getUsdc(1_000_000n));
    expect(await usdc.balanceOf(borrower2)).to.equal(getUsdc(1_000_000n));
  });

  it("X2Pool deposit / withdraw", async function() {
    await usdc.connect(investor1).approve(x2Pool.address, getUsdc(1_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(1_000n), investor1.address);
    expect(await x2Pool.balanceOf(investor1.address)).to.equal(getUsdc(1_000n));
    expect(await x2Pool.totalSupply()).to.equal(getUsdc(1_000n));
    expect(await usdc.balanceOf(x2Pool.address)).to.equal(getUsdc(1_000n));

    await usdc.connect(investor2).approve(x2Pool.address, getUsdc(2_000n));
    await x2Pool.connect(investor2).deposit(getUsdc(2_000n), investor2.address);
    expect(await x2Pool.balanceOf(investor2.address)).to.equal(getUsdc(2_000n));
    expect(await x2Pool.totalSupply()).to.equal(getUsdc(3_000n));
    expect(await usdc.balanceOf(x2Pool.address)).to.equal(getUsdc(3_000n));

    await x2Pool.connect(investor1).withdraw(getUsdc(500n), investor1.address, investor1.address);
    expect(await usdc.balanceOf(investor1)).to.equal(getUsdc(1_000_000n - 500n));
    expect(await usdc.balanceOf(x2Pool.address)).to.equal(getUsdc(2_500n));
    expect(await x2Pool.balanceOf(investor1.address)).to.equal(getUsdc(500n));
    expect(await x2Pool.balanceOf(investor2.address)).to.equal(getUsdc(2_000n));

    await expect(x2Pool.connect(investor1).withdraw(getUsdc(500n), investor1.address, investor2.address))
      .to.be.reverted;

    await x2Pool.connect(investor2).withdraw(getUsdc(2_000n), investor2.address, investor2.address);
    expect(await usdc.balanceOf(x2Pool.address)).to.equal(getUsdc(500n));
    await x2Pool.connect(investor1).withdraw(getUsdc(500n), investor1.address, investor1.address);
    expect(await usdc.balanceOf(x2Pool.address)).to.equal(getUsdc(0n));
    expect(await x2Pool.totalSupply()).to.equal(0n);

    await usdc.connect(richInvestor).approve(x2Pool.address, getUsdc(20_000_000n));

    await expect(x2Pool.connect(richInvestor).deposit(getUsdc(1n) / 10n, richInvestor.address))
      .to.be.revertedWith("Deposit amount too small");

    x2Pool.connect(richInvestor).deposit(getUsdc(10_000_000n), richInvestor.address);
    await expect(x2Pool.connect(richInvestor).deposit(getUsdc(1n), richInvestor.address))
      .to.be.revertedWith("Pool size limit exceeded");
  });

  it("X2Swap borrow 1 / 2", async function() {
    await usdc.connect(investor1).approve(x2Pool.address, getUsdc(1_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(1_000n), investor1.address);

    await usdc.connect(borrower1).approve(x2Swap.address, getUsdc(1_000n));
    await expect(x2Swap.connect(borrower1).openPosition(
      getUsdc(1_000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Position too large");

    await expect(x2Swap.connect(borrower1).openPosition(
      getUsdc(500n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.emit(x2Swap, 'OpenPosition');
    let position = await x2Swap.positions(1n);
    expect(position[0]).to.equal(1n);
    expect(position[1]).to.equal(borrower1.address);
    expect(position[2]).to.equal(getUsdc(1_000n));
    expect(position[4] + 365n * 24n * 60n * 60n).to.equal(position[5]);
    expect(position[6]).to.equal(20n);

    expect(await x2Pool.totalSupply()).to.equal(getUsdc(1_000n));
    expect(await usdc.balanceOf(x2Pool.address)).to.equal(getUsdc(500n));
    expect(await usdc.balanceOf(borrower1.address)).to.equal(getUsdc(1_000_000n - 500n));
    expect(await x2Pool.totalDebt()).to.equal(getUsdc(500n));
    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(500n));

    await expect(x2Swap.connect(borrower1).openPosition(
      getUsdc(500n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Too frequent");

    await usdc.connect(borrower2).approve(x2Swap.address, getUsdc(250n));
    await expect(x2Swap.connect(borrower2).openPosition(
      getUsdc(500n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Position too large");

    await x2Swap.connect(borrower2).openPosition(
      getUsdc(250n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    position = await x2Swap.positions(2n);
    expect(position[0]).to.equal(2n);
    expect(position[1]).to.equal(borrower2.address);
    expect(position[2]).to.equal(getUsdc(500n));
    expect(position[4] + 365n * 24n * 60n * 60n).to.equal(position[5]);
    expect(position[6]).to.equal(20n);


    await usdc.connect(borrower3).approve(x2Swap.address, getUsdc(125n));
    await x2Swap.connect(borrower3).openPosition(
      getUsdc(125n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(125n));
    expect(await x2Pool.totalDebt()).to.equal(getUsdc(875n));

    await usdc.connect(borrower4).approve(x2Swap.address, getUsdc(60n));
    await x2Swap.connect(borrower4).openPosition(
      getUsdc(60n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(65n));
    expect(await x2Pool.totalDebt()).to.equal(getUsdc(935n));

    await usdc.connect(borrower5).approve(x2Swap.address, getUsdc(30n));
    await expect(x2Swap.connect(borrower5).openPosition(
      getUsdc(30n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Max positions exceeded");

    await expect(x2Swap.connect(borrower5).openPosition(
      getUsdc(1n) / 10_000n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Amount too small");

  });

  it("X2Swap borrow 2 / 2", async function() {

    await usdc.connect(investor1).approve(x2Pool.address, getUsdc(10n));
    await x2Pool.connect(investor1).deposit(getUsdc(10n), investor1.address);

    await usdc.connect(borrower1).approve(x2Swap.address, getUsdc(1n));

    await expect(x2Swap.connect(borrower1).openPosition(
      getUsdc(1n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Below min liquidity");

  });

  it("X2Swap profit sharing", async function() {
    await usdc.connect(investor1).approve(x2Pool, getUsdc(2000n));
    await x2Pool.connect(investor1).deposit(getUsdc(2000n), investor1.address);

    await usdc.connect(borrower1).approve(x2Swap, getUsdc(890n));
    await x2Swap.connect(borrower1).openPosition(
      getUsdc(890n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    await x2Pool.connect(investor1).withdraw(getUsdc(1000n), investor1.address, investor1.address);

    await usdc.connect(borrower2).approve(x2Swap, getUsdc(10n));
    await x2Swap.connect(borrower2).openPosition(
      getUsdc(10n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    let position = await x2Swap.positions(2n);
    expect(position[6]).to.be.equal(20n);

    await usdc.connect(borrower3).approve(x2Swap, getUsdc(1n));
    await x2Swap.connect(borrower3).openPosition(
      getUsdc(1n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    position = await x2Swap.positions(3n);
    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(99n));
    expect(await x2Pool.totalDebt()).to.equal(getUsdc(901n));
    expect(position[6]).to.be.equal(30n);

    await usdc.connect(borrower4).approve(x2Swap, getUsdc(20n));
    await x2Swap.connect(borrower4).openPosition(
      getUsdc(20n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    position = await x2Swap.positions(4n);
    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(79n));
    expect(await x2Pool.totalDebt()).to.equal(getUsdc(921n));
    expect(position[6]).to.be.equal(40n);

    await usdc.connect(borrower5).approve(x2Swap, getUsdc(20n));
    await x2Swap.connect(borrower5).openPosition(
      getUsdc(20n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    position = await x2Swap.positions(5n);
    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(59n));
    expect(await x2Pool.totalDebt()).to.equal(getUsdc(941n));
    expect(position[6]).to.be.equal(50n);

  });

  it("Open oracle", async function() {
    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2UniswapV2Exchange.address],
      0n,
      365n * 24n * 60n * 60n,
      [gov1.address, gov2.address, gov3.address, gov4.getAddress(), gov5.address],
      [[WETH, await oracle.getAddress()]]
    );

    const x2Swap = await hre.ethers.getContractAt("X2Swap", await router.swaps(WETH));
    const x2Pool = await hre.ethers.getContractAt("X2Pool", await router.pool());

    await usdc.connect(investor1).approve(x2Pool, getUsdc(10_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(10_000n), investor1.address);

    // const currentSwap = await x2UniswapV2Exchange.getAmountOut(
    //   WETH,
    //   hre.ethers.parseEther("1"),
    //   encodePath([WETH, USDC]),
    // );
    // console.info(`\tCurrent swap price: ${parseInt(currentSwap) / (10 ** parseInt(usdcDecimals))}`);

    await usdc.connect(richInvestor).approve(x2UniswapV2Exchange.address, getUsdc(10_000_000n));
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      USDC,
      getUsdc(10_000_000n),
      1n,
      encodePath([USDC, WETH]),
      getDeadline()
    );


    const wethAmount = await weth.balanceOf(richInvestor.address);
    // console.info(`\tSwapped for ${ethers.formatEther(wethAmount)} ETH`);

    // const attackSwap = await x2UniswapV2Exchange.getAmountOut(
    //   WETH,
    //   hre.ethers.parseEther("1"),
    //   encodePath([WETH, USDC]),
    // );
    // console.info(`\tAttack swap price: ${parseInt(attackSwap) / (10 ** parseInt(usdcDecimals))}`);

    await usdc.connect(borrower1).approve(x2Swap, getUsdc(10_000n));
    await expect(x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Oracle deviation");

    // console.info(`\tAmount out: ${parseInt(amountOut) / (10 ** parseInt(usdcDecimals))}`);
    await weth.connect(richInvestor).approve(x2UniswapV2Exchange.address, 2n * wethAmount);
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      WETH,
      wethAmount,
      1n,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    // const correctedPrice = await x2UniswapV2Exchange.getAmountOut(
    //   WETH,
    //   hre.ethers.parseEther("1"),
    //   encodePath([WETH, USDC]),
    // );
    // console.info(`\tCorrected swap price: ${parseInt(correctedPrice) / (10 ** parseInt(usdcDecimals))}`);

    await x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    await weth.connect(richInvestor).deposit({value: wethAmount});
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      WETH,
      wethAmount,
      1n,
      encodePath([WETH, USDC]),
      getDeadline()
    );


    // const lowPrice = await x2UniswapV2Exchange.getAmountOut(
    //   WETH,
    //   hre.ethers.parseEther("1"),
    //   encodePath([WETH, USDC]),
    // );
    // console.info(`\tLow swap price: ${parseInt(lowPrice) / (10 ** parseInt(usdcDecimals))}`);

    await usdc.connect(borrower2).approve(x2Swap, getUsdc(10_000n));
    await x2Swap.connect(borrower2).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    const snapshot = await network.provider.send("evm_snapshot");
    time.increase(3600);

    await expect(x2Swap.connect(borrower1).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    )).to.be.revertedWith("Oracle data too old");

    await network.provider.send("evm_revert", [snapshot]);

  });

  it("Close: profit sharing", async function() {
    await usdc.connect(investor1).approve(x2Pool, getUsdc(10_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(10_000n), investor1.address);

    // Profit
    const borrower1InitialBalance = await usdc.balanceOf(borrower1.address);
    await usdc.connect(borrower1).approve(x2Swap, getUsdc(1000n));
    await x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    await usdc.connect(richInvestor).approve(x2UniswapV2Exchange.address, getUsdc(10_000_000n));
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      USDC,
      getUsdc(10_000_000n),
      1n,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    await x2Swap.connect(borrower1).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    const profitPosition = await x2Swap.positions(1n);

    expect(profitPosition[8]).to.be.gt(getUsdc(1000n));
    const profit = profitPosition[8] - getUsdc(2n * 1000n);
    const profitSharing = profitPosition[6];
    const borrower1FinalBalance = await usdc.balanceOf(borrower1.address);
    const pool1Balance = await x2Pool.totalAssets();
    expect(borrower1FinalBalance).to.equal((borrower1InitialBalance + profit - profit * (profitSharing) / 100n));
    expect(pool1Balance).to.equal(getUsdc(10_000n) + profit * (profitSharing) / 100n);

    // less than half loss
    const borrower2InitialBalance = await usdc.balanceOf(borrower2.address);
    await usdc.connect(borrower2).approve(x2Swap, getUsdc(1000n));
    await x2Swap.connect(borrower2).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    await weth.connect(richInvestor).approve(x2UniswapV2Exchange.address, ethers.parseEther("10000"));
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      WETH,
      ethers.parseEther("10"),
      1n,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    await x2Swap.connect(borrower2).closePosition(
      2n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    const littleLossPosition = await x2Swap.positions(2n);
    expect(littleLossPosition[8]).to.be.lt(getUsdc(2n * 1000n));
    const littleLoss = getUsdc(2n * 1000n) - littleLossPosition[8];
    const borrower2FinalBalance = await usdc.balanceOf(borrower2.address);
    expect(borrower2FinalBalance).to.equal(borrower2InitialBalance - littleLoss);
    expect(await x2Pool.totalAssets()).to.equal(pool1Balance);

    // more than half loss
    const borrower3InitialBalance = await usdc.balanceOf(borrower3.address);
    await usdc.connect(borrower3).approve(x2Swap, getUsdc(1000n));
    await x2Swap.connect(borrower3).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    await x2UniswapV2Exchange.connect(richInvestor).swap(
      WETH,
      await weth.balanceOf(richInvestor.address),
      1n,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    await x2Swap.connect(borrower3).closePosition(
      3n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    const bigLossPosition = await x2Swap.positions(3n);

    expect(bigLossPosition[8]).to.be.lt(getUsdc(2n * 1000n));
    const bigLoss = getUsdc(2n * 1000n) - bigLossPosition[8];
    const poolLoss = bigLoss - bigLossPosition[2] / 2n;
    const borrower3FinalBalance = await usdc.balanceOf(borrower3.address);
    expect(borrower3FinalBalance).to.equal(borrower3InitialBalance - bigLossPosition[2] / 2n);
    expect(await x2Pool.totalAssets()).to.equal(pool1Balance - poolLoss);

  });

  it("Close: oracle", async function() {

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2UniswapV2Exchange.address],
      0n,
      365n * 24n * 60n * 60n,
      [gov1.address, gov2.address, gov3.address, gov4.getAddress(), gov5.address],
      [[WETH, await oracle.getAddress()]]
    );

    const x2Swap = await hre.ethers.getContractAt("X2Swap", await router.swaps(WETH));
    const x2Pool = await hre.ethers.getContractAt("X2Pool", await router.pool());

    // Filling pool
    await usdc.connect(investor1).approve(x2Pool, getUsdc(10_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(10_000n), investor1.address);

    // Opening good position
    await usdc.connect(borrower1).approve(x2Swap, getUsdc(1000n));
    await x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    // Increasing WETH price
    await usdc.connect(richInvestor).approve(x2UniswapV2Exchange, getUsdc(10_000_000n));
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      USDC,
      getUsdc(10_000_000n),
      1n,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    // Closing good position
    await x2Swap.connect(borrower1).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );
    const goodPosition = await x2Swap.positions(1n);
    expect(goodPosition[8]).to.be.gt(getUsdc(2n * 1000n));

    // Restoring WETH price
    const wethAmount = await weth.balanceOf(richInvestor.address);
    await weth.connect(richInvestor).approve(x2UniswapV2Exchange, wethAmount);
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      WETH,
      wethAmount,
      1n,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    // Opening bad position
    await usdc.connect(borrower2).approve(x2Swap, getUsdc(1000n));
    await x2Swap.connect(borrower2).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    // Lowering WETH price
    await weth.connect(wethInvestor).approve(x2UniswapV2Exchange, ethers.parseEther("10000"));
    await x2UniswapV2Exchange.connect(wethInvestor).swap(
      WETH,
      ethers.parseEther("1000"),
      1n,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    // Closing bad position
    await expect(
      x2Swap.connect(borrower2).closePosition(
        2n,
        500n,
        x2UniswapV2Exchange.address,
        encodePath([WETH, USDC]),
        getDeadline()
      )
    ).to.be.revertedWith("Oracle deviation");

  });

  it("Close: expired position", async function() {
    await usdc.connect(investor1).approve(x2Pool, getUsdc(10_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(10_000n), investor1.address);

    await usdc.connect(borrower1).approve(x2Swap, getUsdc(1000n));
    await x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    const snapshot = await network.provider.send("evm_snapshot");

    await time.increase(365 * 24 * 60 * 60 - 60);
    await expect(x2Swap.connect(borrower2).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    )).to.be.revertedWith("Only owner before expiration");

    await time.increase(60);
    await x2Swap.connect(borrower2).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    await network.provider.send("evm_revert", [snapshot]);

  });

  it("Governance pause / shutdown", async function() {
    await usdc.connect(investor1).approve(x2Pool, getUsdc(10_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(10_000n), investor1.address);

    await usdc.connect(borrower1).approve(x2Swap, getUsdc(1000n));
    await usdc.connect(borrower2).approve(x2Swap, getUsdc(1000n));
    await usdc.connect(borrower3).approve(x2Swap, getUsdc(1000n));

    await x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    await feeGovernance.connect(gov1).proposePause();
    await expect(feeGovernance.connect(gov1).execute(1n)).to.be.revertedWith("Not enough votes");
    await feeGovernance.connect(gov1).vote(1n);
    await expect(feeGovernance.connect(gov1).vote(1n)).to.be.revertedWith("Already voted");
    await feeGovernance.connect(gov2).vote(1n);
    await expect(feeGovernance.connect(gov1).execute(1n)).to.be.revertedWith("Not enough votes");
    await feeGovernance.connect(gov3).vote(1n);
    await feeGovernance.connect(gov1).execute(1n);

    await x2Swap.connect(borrower1).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    await expect(x2Swap.connect(borrower2).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Protocol emergency paused");

    await feeGovernance.connect(gov3).proposeUnpause();
    await feeGovernance.connect(gov3).vote(2n);
    await feeGovernance.connect(gov4).vote(2n);
    await feeGovernance.connect(gov5).vote(2n);
    await feeGovernance.connect(gov1).execute(2n);

    await x2Swap.connect(borrower2).openPosition(
      getUsdc(100n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    await feeGovernance.connect(gov1).proposeEmergencyPause();
    await feeGovernance.connect(gov1).vote(3n);
    await feeGovernance.connect(gov2).vote(3n);
    await feeGovernance.connect(gov3).vote(3n);
    await feeGovernance.connect(gov1).execute(3n);

    await expect(feeGovernance.connect(gov1).proposeUnpause()).to.be.revertedWith("Emergency pause cannot be reversed");

    await expect(x2Swap.connect(borrower3).openPosition(
      getUsdc(100n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    )).to.be.revertedWith("Protocol emergency paused");
  });

  it("Governance add / remove governor", async function() {
    await expect(feeGovernance.connect(gov1).proposeRemoveGovernor(investor1.address))
      .to.be.revertedWith("Not governor");

    await feeGovernance.connect(gov1).proposeAddGovernor(investor1.address);
    await feeGovernance.connect(gov1).vote(1n);
    await feeGovernance.connect(gov2).vote(1n);
    await feeGovernance.connect(gov3).vote(1n);
    await feeGovernance.connect(gov1).execute(1n);
    await expect(feeGovernance.connect(gov1).execute(1n)).to.be.revertedWith("Executed");

    expect(await feeGovernance.governors(5n)).to.equal(investor1.address);

    await feeGovernance.connect(gov1).proposeRemoveGovernor(investor1.address);
    await feeGovernance.connect(gov1).vote(2n);
    await feeGovernance.connect(gov2).vote(2n);
    await feeGovernance.connect(gov3).vote(2n);
    await expect(feeGovernance.connect(gov1).execute(2n)).to.be.revertedWith("Not enough votes");
    await feeGovernance.connect(investor1).vote(2n);
    await feeGovernance.connect(gov1).execute(2n);

    await expect(feeGovernance.governors(5n)).to.be.revertedWithoutReason();

    await feeGovernance.connect(gov1).proposeRemoveGovernor(gov5);
    await feeGovernance.connect(gov1).vote(3n);
    await feeGovernance.connect(gov2).vote(3n);
    await feeGovernance.connect(gov3).vote(3n);
    await feeGovernance.connect(gov1).execute(3n);

    await feeGovernance.governors(3n);
    await expect(feeGovernance.governors(4n)).to.be.revertedWithoutReason();

    await feeGovernance.connect(gov1).proposeRemoveGovernor(gov4);
    await feeGovernance.connect(gov1).proposeRemoveGovernor(gov3);

    await feeGovernance.connect(gov1).vote(4n);
    await feeGovernance.connect(gov2).vote(4n);
    await feeGovernance.connect(gov3).vote(4n);
    await feeGovernance.connect(gov1).execute(4n);

    await feeGovernance.governors(2n);
    await expect(feeGovernance.governors(3n)).to.be.revertedWithoutReason();

    await feeGovernance.connect(gov1).vote(5n);
    await feeGovernance.connect(gov2).vote(5n);
    await feeGovernance.connect(gov3).vote(5n);
    await expect(feeGovernance.connect(gov1).execute(5n)).to.be.revertedWith("Min 3 governors");

    await expect(feeGovernance.connect(gov1).proposeRemoveGovernor(gov3)).to.be.revertedWith("Min 3 governors");
  });

  it("Open / Close fee + fee withdrawal", async function() {
    const feeBps = 50n;
    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2UniswapV2Exchange.address],
      feeBps, // 0.5%
      365n * 24n * 60n * 60n,
      [gov1.address, gov2.address, gov3.address, gov4.getAddress(), gov5.address],
      [[WETH, await fakeOracle.getAddress()]]
    );

    const x2Swap = await hre.ethers.getContractAt("X2Swap", await router.swaps(WETH));
    const x2Pool = await hre.ethers.getContractAt("X2Pool", await router.pool());
    const feeGovernance = await hre.ethers.getContractAt("FeeGovernance", await router.feeGovernance());

    // Filling pool
    await usdc.connect(investor1).approve(x2Pool, getUsdc(10_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(10_000n), investor1.address);

    // Open position
    await usdc.connect(borrower1).approve(x2Swap, getUsdc(3000n));
    await x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );

    let position1 = await x2Swap.positions(1n);
    expect(position1[2]).to.equal(getUsdc(1000n - 5n) * 2n);
    expect(await x2Swap.feesAccrued()).to.equal(getUsdc(5n));

    // Close with loss
    const snapshot = await network.provider.send("evm_snapshot");

    await weth.connect(wethInvestor).approve(x2UniswapV2Exchange, ethers.parseEther("100"));
    await x2UniswapV2Exchange.connect(wethInvestor).swap(
      WETH,
      ethers.parseEther("100"),
      1n,
      encodePath([WETH, USDC]),
      getDeadline()
    );
    await x2Swap.connect(borrower1).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    position1 = await x2Swap.positions(1n);
    expect(position1[8]).to.lt(position1[2]);
    expect(await x2Swap.feesAccrued()).to.equal(getUsdc(5n));

    await network.provider.send("evm_revert", [snapshot]);

    // Close with profit
    await usdc.connect(richInvestor).approve(x2UniswapV2Exchange, getUsdc(10_000_000n));
    await x2UniswapV2Exchange.connect(richInvestor).swap(
      USDC,
      getUsdc(10_000_000n),
      1n,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    await x2Swap.connect(borrower1).closePosition(
      1n,
      500n,
      x2UniswapV2Exchange.address,
      encodePath([WETH, USDC]),
      getDeadline()
    );

    position1 = await x2Swap.positions(1n);
    expect(position1[8]).to.gt(position1[2]);

    const profit = position1[8] - position1[2];
    const fee = getUsdc(5n) + profit * feeBps / 10_000n;
    expect(await x2Swap.feesAccrued()).to.equal(fee);

    expect(await feeGovernance.isWithdrawer(gov1.address)).to.equal(false);
    await expect(x2Swap.connect(gov1).withdrawFees(gov1.address, fee - getUsdc(1n))).to.be.revertedWith("Not allowed");

    await feeGovernance.connect(gov1).proposeAddWithdrawer(gov1.address);
    await feeGovernance.connect(gov1).vote(1n);
    await feeGovernance.connect(gov2).vote(1n);
    await feeGovernance.connect(gov3).vote(1n);
    await feeGovernance.connect(gov1).execute(1n);

    const balanceBefore = await usdc.balanceOf(gov1.address);
    await x2Swap.connect(gov1).withdrawFees(gov1.address, fee - getUsdc(1n));
    expect(await usdc.balanceOf(gov1)).to.equal(balanceBefore + fee - getUsdc(1n));

    await feeGovernance.connect(gov1).proposeRemoveWithdrawer(gov1.address);
    await feeGovernance.connect(gov1).vote(2n);
    await feeGovernance.connect(gov2).vote(2n);
    await feeGovernance.connect(gov3).vote(2n);
    await feeGovernance.connect(gov1).execute(2n);
    await expect(x2Swap.connect(gov1).withdrawFees(gov1.address, getUsdc(1n))).to.be.revertedWith("Not allowed");

  });


  it("Uniswap V3", async function() {

    const X2Deployer = await hre.ethers.getContractFactory("X2Deployer", deployer);
    const router = await X2Deployer.deploy(
      USDC,
      [x2UniswapV3Exchange.address],
      0n,
      365n * 24n * 60n * 60n,
      [gov1.address, gov2.address, gov3.address, gov4.getAddress(), gov5.address],
      [[WETH, await oracle.getAddress()]]
    );

    const x2Swap = await hre.ethers.getContractAt("X2Swap", await router.swaps(WETH));
    const x2Pool = await hre.ethers.getContractAt("X2Pool", await router.pool());

    await usdc.connect(investor1).approve(x2Pool, getUsdc(10_000n));
    await x2Pool.connect(investor1).deposit(getUsdc(10_000n), investor1.address);

    const amount = await x2UniswapV3Exchange.connect(richInvestor).getAmountOut(
      WETH,
      ethers.parseEther("1"),
      encodeV3Path([WETH, USDC], [3000n])
    );

    usdc.connect(richInvestor).approve(x2UniswapV3Exchange, getUsdc(1000n));
    await x2UniswapV3Exchange.connect(richInvestor).swap(
      USDC,
      getUsdc(1000n),
      1n,
      encodeV3Path([USDC, WETH], [3000n]),
      getDeadline()
    );

    usdc.connect(borrower1).approve(x2Swap, getUsdc(1000n));
    await x2Swap.connect(borrower1).openPosition(
      getUsdc(1000n),
      500n,
      x2UniswapV3Exchange.address,
      encodeV3Path([USDC, WETH], [3000n]),
      getDeadline()
    );
    await x2Swap.connect(borrower1).closePosition(
      1n,
      500n,
      x2UniswapV3Exchange.address,
      encodeV3Path([WETH, USDC], [3000n]),
      getDeadline()
    );

  });

  it("Pool assets", async function() {
    await usdc.connect(investor1).approve(x2Pool, getUsdc(50000n));
    await usdc.connect(investor2).approve(x2Pool, getUsdc(50000n));
    await usdc.connect(borrower1).approve(x2Swap, getUsdc(50000n));

    await x2Pool.connect(investor1).deposit(getUsdc(1000n), investor1.address);
    expect(await x2Pool.balanceOf(investor1)).to.equal(getUsdc(1000n));
    expect(await x2Pool.totalAssets(), getUsdc(1000n));

    await x2Swap.connect(borrower1).openPosition(
      getUsdc(500n),
      500,
      x2UniswapV2Exchange.address,
      encodePath([USDC, WETH]),
      getDeadline()
    );
    expect(await x2Pool.totalAssets(), getUsdc(1000n));

    await x2Pool.connect(investor2).deposit(getUsdc(500n), investor2.address);

    expect(await x2Pool.balanceOf(investor1)).to.equal(getUsdc(1000n));
    expect(await x2Pool.balanceOf(investor2)).to.equal(getUsdc(500n));
    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(1000n));

    await x2Pool.connect(investor1).withdraw(getUsdc(1000n), investor1.address, investor1.address);
    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(0n));

    let balance = await usdc.balanceOf(investor2);
    await x2Pool.connect(investor2).withdraw(getUsdc(500n), investor2.address, investor2.address);
    expect(await x2Pool.balanceOf(investor2)).to.equal(getUsdc(500n));
    expect(await usdc.balanceOf(x2Pool)).to.equal(getUsdc(0n));
    expect(await usdc.balanceOf(investor2)).to.equal(balance);

    await x2Pool.connect(investor1).deposit(getUsdc(250n), investor1.address);
    balance = await usdc.balanceOf(investor2);
    await x2Pool.connect(investor2).withdraw(getUsdc(500n), investor2.address, investor2.address);
    expect(await usdc.connect(investor2).balanceOf(investor2)).to.equal(balance + getUsdc(250n));
  });

});
