import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.11.1/dist/ethers.min.js";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const DEFAULT_ASSET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC mainnet addr for fork fallback

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const swapAbi = [
  "function pool() view returns (address)",
  "function asset() view returns (address)",
  "function targetToken() view returns (address)",
  "function positionDuration() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function feesAccrued() view returns (uint256)",
  "function feeWithdrawers(uint256) view returns (address)",
  "function feeWithdrawersCount() view returns (uint256)",
  "function isFeeWithdrawer(address) view returns (bool)",
  "function withdrawFees(address to, uint256 amount) returns (uint256)",
  "function openPosition(uint256 assetAmount) returns (uint256)",
  "function closePosition(uint256 id)",
  "function getPositionsOf(address) view returns (uint256[] memory)",
  "function positions(uint256) view returns (uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
  "function checkPosition(uint256) view returns (int256 profit, uint256 borrowerAmount, uint256 poolAmount, uint256 feeAmount, uint256 assetAmountOut)",
  "function targetRate() view returns (uint256)"
];

const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)"
];

const vaultAbi = [
  // ERC20
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  // ERC4626
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalDebt() view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function mint(uint256 shares, address receiver) returns (uint256 assets)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)"
];

const state = {
  provider: null,
  signer: null,
  addr: null,
  router: null,
  swap: null,
  swapAddress: null,
  asset: null,
  assetDecimals: 6,
  assetAddress: DEFAULT_ASSET,
  targetToken: null,
  targetTokenAddress: null,
  targetDecimals: 18,
  positionDuration: 0n,
  vaultAddress: null,
  vault: null,
  shareDecimals: 18,
  allowance: 0n,
  routerAllowance: 0n,
  swapAllowance: 0n,
  poolAvailable: 0n,
  positions: [],
  feeBps: 0n,
  feesAccrued: 0n,
  canWithdrawFees: false
};

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => $("status").innerHTML = `<span>${msg}</span>`;
const setConnStatus = (msg) => {
  const el = $("connStatus");
  if (el) el.textContent = msg;
};
const setPoolStatus = (msg) => {
  const el = $("poolStatus");
  if (el) el.innerHTML = `<span>${msg}</span>`;
};
const setSwapUsdcStatus = (msg) => {
  const el = $("statusUsdc");
  if (el) el.innerHTML = `<span>${msg}</span>`;
};
const setApprovalText = (txt) => {
  const el = $("approvalVal");
  if (el) el.textContent = txt;
};
const setRouterApprovalText = (txt) => {
  const el = $("routerApprovalVal");
  if (el) el.textContent = txt;
};
const setPositionStatus = (msg) => {
  const el = $("positionStatus");
  if (el) el.innerHTML = `<span>${msg}</span>`;
};
const setPositionQuote = (msg) => {
  const el = $("positionQuote");
  if (el) el.textContent = msg;
};
const setPositionRate = (msg) => {
  const el = $("positionRate");
  if (el) el.textContent = msg;
};
const setPositionFee = (msg) => {
  const el = $("positionFee");
  if (el) el.textContent = msg;
};
const setPositionSwapIn = (msg) => {
  const el = $("positionSwapIn");
  if (el) el.textContent = msg;
};
const setPositionsStatus = (msg) => {
  const el = $("positionsStatus");
  if (el) el.innerHTML = `<span>${msg}</span>`;
};
const setShareLabel = (txt) => {
  const el = $("shareLabel");
  if (el) el.textContent = txt || "Pool Token";
};
const setPoolAvailable = (txt) => {
  const el = $("poolAvailable");
  if (el) el.textContent = txt;
};
const setPoolAssets = (txt) => {
  const el = $("poolAssets");
  if (el) el.textContent = txt;
};
const setPoolDebt = (txt) => {
  const el = $("poolDebt");
  if (el) el.textContent = txt;
};
const setFeeBps = (txt) => {
  const el = $("feeBps");
  if (el) el.textContent = txt;
};
const setFeesAccrued = (txt) => {
  const el = $("feesAccrued");
  if (el) el.textContent = txt;
};
const setFeesAuth = (txt) => {
  const el = $("feesAuth");
  if (el) el.textContent = txt;
};
const setFeesStatus = (msg) => {
  const el = $("feesStatus");
  if (el) el.innerHTML = `<span>${msg}</span>`;
};
const setWithdrawFeesDisabled = (disabled) => {
  const btn = $("withdrawFeesBtn");
  if (btn) btn.disabled = disabled;
};
const renderPositions = () => {
  const el = $("positionsList");
  if (!el) return;
  if (!state.positions.length) {
    el.innerHTML = "No positions";
    return;
  }
  const rows = state.positions
    .map((p) => {
      const openAmt = ethers.formatUnits(p.openAssetAmount, state.assetDecimals);
      const targetAmt = ethers.formatUnits(p.targetAmount, state.targetDecimals);
      const status = p.closeDate > 0 ? "Closed" : "Open";
      const openDate = p.openDate ? new Date(Number(p.openDate) * 1000).toLocaleString() : "-";
      let body = `<div class="balance-row" style="margin-bottom:6px;">
        <div class="balance-label">#${p.id} ${status}</div>
        <div class="balance-value">${openAmt} asset → ${targetAmt} target</div>
      </div>
      <div class="muted" style="font-size:12px;margin:4px 0;">Opened: ${openDate}</div>`;

      if (p.closeDate > 0) {
        const closeAmt = ethers.formatUnits(p.closeAssetAmount, state.assetDecimals);
        body += `<div class="muted" style="font-size:12px;margin:0 0 10px;">Closed for ${closeAmt} asset</div>`;
      } else {
        if (typeof p.assetAmountOut !== "undefined") {
          const assetOut = ethers.formatUnits(p.assetAmountOut, state.assetDecimals);
          const borrowerAmt = ethers.formatUnits(p.borrowerAmount || 0n, state.assetDecimals);
          const poolAmt = ethers.formatUnits(p.poolAmount || 0n, state.assetDecimals);
          const feeAmt = ethers.formatUnits(p.feeAmount || 0n, state.assetDecimals);
          const profitNum = Number(ethers.formatUnits(p.profit || 0n, state.assetDecimals));
          const profitLabel = profitNum >= 0 ? `+${profitNum.toFixed(4)}` : profitNum.toFixed(4);
          body += `<div class="muted" style="font-size:12px;">Est. swap out: ${assetOut} asset</div>
          <div class="muted" style="font-size:12px;">Pool: ${poolAmt} • You: ${borrowerAmt} • Fee: ${feeAmt}</div>
          <div class="muted" style="font-size:12px;margin-bottom:8px;">P/L: ${profitLabel}</div>`;
        }
        body += `<button class="close-btn" data-pos="${p.id}">Close</button>`;
      }
      return `<div class="panel" style="margin-bottom:10px;padding:10px;">${body}</div>`;
    })
    .join("");
  el.innerHTML = rows;
  document.querySelectorAll(".close-btn").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.pos);
      await handleClosePosition(id);
    };
  });
};
const setPositionDuration = (txt) => {
  const el = $("positionDuration");
  if (el) el.textContent = txt;
};
const setLoading = (msg) => {
  const el = $("loading");
  if (el) el.textContent = msg;
};
const showApp = () => {
  const app = $("app");
  const loading = $("loading");
  if (app) app.classList.remove("hidden");
  if (loading) loading.classList.add("hidden");
};

const setSwapDisabled = (disabled) => {
  const btn = $("swapBtn");
  if (btn) btn.disabled = disabled;
};
const setSwapUsdcDisabled = (disabled) => {
  const btn = $("swapUsdcBtn");
  if (btn) btn.disabled = disabled;
};
const setRouterApproveDisabled = (disabled) => {
  const btn = $("routerApproveBtn");
  if (btn) btn.disabled = disabled;
};
const setPoolDisabled = (depositDisabled, withdrawDisabled) => {
  const d = $("depositBtn");
  const w = $("withdrawBtn");
  if (d) d.disabled = depositDisabled;
  if (w) w.disabled = withdrawDisabled;
};
const setOpenPositionDisabled = (disabled) => {
  const btn = $("openPositionBtn");
  if (btn) btn.disabled = disabled;
};
const isAmountValid = () => {
  const val = $("amount").value;
  return val && !isNaN(val) && Number(val) > 0;
};
const isAmountUsdcValid = () => {
  const val = $("amountUsdc").value;
  return val && !isNaN(val) && Number(val) > 0;
};
const isDepositValid = () => {
  const val = $("depositAmount").value;
  return val && !isNaN(val) && Number(val) > 0;
};
const isWithdrawValid = () => {
  const val = $("withdrawAmount").value;
  return val && !isNaN(val) && Number(val) > 0;
};
const isPositionValid = () => {
  const val = $("positionAmount").value;
  return val && !isNaN(val) && Number(val) > 0;
};

async function connect() {
  if (!window.ethereum) {
    alert("Metamask not detected");
    return;
  }
  await window.ethereum.request({ method: "eth_requestAccounts" });
  state.provider = new ethers.BrowserProvider(window.ethereum);
  state.signer = await state.provider.getSigner();
  state.addr = await state.signer.getAddress();
  state.router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, state.signer);
  if (state.swapAddress) {
    state.swap = new ethers.Contract(state.swapAddress, swapAbi, state.signer);
    try {
      const poolAddr = await state.swap.pool();
      const assetAddr = await state.swap.asset();
      const targetAddr = await state.swap.targetToken();
      const duration = await state.swap.positionDuration();
      const feeBps = await state.swap.feeBps();
      state.vaultAddress = poolAddr;
      state.assetAddress = assetAddr;
      state.targetTokenAddress = targetAddr;
      state.positionDuration = duration;
      state.feeBps = feeBps;
      setPositionDuration(`${Number(duration) / 86400} days`);
      setFeeBps(`${(Number(feeBps) / 100).toFixed(2)}%`);
      // Fetch pool token symbol directly
      try {
        const poolContract = new ethers.Contract(poolAddr, vaultAbi, state.provider);
        const shareSymbol = await poolContract.symbol();
        setShareLabel(shareSymbol || "Pool Token");
      } catch (e) {
        console.error("Pool symbol fetch failed", e);
        setShareLabel("Pool Token");
      }
    } catch (e) {
      console.error("Swap fetch failed", e);
    }
  }
  if (state.vaultAddress) {
    state.vault = new ethers.Contract(state.vaultAddress, vaultAbi, state.signer);
    state.assetAddress = await state.vault.asset();
    state.shareDecimals = await state.vault.decimals();
    // share label already set above
  }
  if (state.targetTokenAddress && !state.targetToken) {
    try {
      state.targetToken = new ethers.Contract(state.targetTokenAddress, erc20Abi, state.provider);
      state.targetDecimals = await state.targetToken.decimals();
    } catch (e) {
      console.error("Target token load failed", e);
      state.targetDecimals = 18;
    }
  }
  state.asset = new ethers.Contract(state.assetAddress, erc20Abi, state.provider);
  try {
    state.assetDecimals = await state.asset.decimals();
  } catch (e) {
    console.error(e);
    state.assetDecimals = 6;
  }
  // swapAllowance check
  try {
    const swapAllowance = await state.asset.allowance(state.addr, state.swapAddress || state.vaultAddress);
    state.swapAllowance = swapAllowance;
  } catch (e) {
    console.error(e);
  }
  await refreshPoolInfo();
  $("addr").textContent = `${short(state.addr)}`;
  await refreshBalances();
  await refreshAllowance();
  await refreshPositions();
  setStatus("Connected");
  setConnStatus("Connected to Hardhat fork (chainId 31337)");
  setPoolStatus("Connected");
  updateSwapState();
  updateSwapUsdcState();
  updatePoolState();
  updatePositionState();
  updateFeesState();
}

async function refreshBalances() {
  if (!state.signer) return;
  const ethBal = await state.provider.getBalance(state.addr);
  $("ethBal").textContent = `${ethers.formatEther(ethBal)}`;
  if (state.asset) {
    const assetBal = await state.asset.balanceOf(state.addr);
    const assetDisplay = Number(ethers.formatUnits(assetBal, state.assetDecimals));
    $("usdcBal").textContent = `${assetDisplay.toFixed(2)}`;
  }
  if (state.vault) {
    try {
      const shareBal = await state.vault.balanceOf(state.addr);
      const display = Number(ethers.formatUnits(shareBal, state.shareDecimals));
      $("lpBal").textContent = `${display.toFixed(4)}`;
    } catch (e) {
      console.error(e);
      $("lpBal").textContent = "?";
    }
  } else {
    $("lpBal").textContent = "(no vault)";
  }
}

async function refreshPoolInfo() {
  if (!state.vault) {
    setPoolAvailable("–");
    setPoolAssets("–");
    setPoolDebt("–");
    setFeeBps("–");
    setFeesAccrued("–");
    setFeesAuth("–");
    return;
  }
  try {
    const assets = await state.vault.totalAssets();
    const debt = await state.vault.totalDebt();
    const totalWithDebt = assets + debt;
    state.poolAvailable = assets;
    setPoolAssets(ethers.formatUnits(totalWithDebt, state.assetDecimals));
    setPoolAvailable(ethers.formatUnits(assets, state.assetDecimals));
    setPoolDebt(ethers.formatUnits(debt, state.assetDecimals));
    if (state.swap) {
      const feeBps = await state.swap.feeBps();
      state.feeBps = feeBps;
      setFeeBps(`${(Number(feeBps) / 100).toFixed(2)}%`);

      const feesAccrued = await state.swap.feesAccrued();
      state.feesAccrued = feesAccrued;
      setFeesAccrued(ethers.formatUnits(feesAccrued, state.assetDecimals));

      if (state.addr) {
        const canWithdraw = await state.swap.isFeeWithdrawer(state.addr);
        state.canWithdrawFees = canWithdraw;
        setFeesAuth(canWithdraw ? "You can withdraw fees." : "You are not authorized to withdraw fees.");
        const feesTo = $("feesTo");
        if (feesTo && !feesTo.value) feesTo.value = state.addr;
        updateFeesState();
      }
    }
  } catch (e) {
    console.error(e);
    setPoolAvailable("?");
    setPoolAssets("?");
    setPoolDebt("?");
    setFeeBps("?");
    setFeesAccrued("?");
    setFeesAuth("?");
  }
}

async function refreshPositions() {
  if (!state.swap || !state.addr) {
    state.positions = [];
    renderPositions();
    return;
  }
  try {
    const ids = await state.swap.getPositionsOf(state.addr);
    const fetched = [];
    for (const id of ids) {
      try {
        const pos = await state.swap.positions(id);
        const position = {
          id: Number(pos[0]),
          sender: pos[1],
          openAssetAmount: pos[2],
          targetAmount: pos[3],
          openDate: pos[4],
          expireDate: pos[5],
          profitSharing: pos[6],
          closeDate: pos[7],
          closeAssetAmount: pos[8]
        };
        if (position.closeDate === 0n) {
          try {
            const [profit, borrowerAmount, poolAmount, feeAmount, assetAmountOut] = await state.swap.checkPosition(id);
            position.profit = profit;
            position.borrowerAmount = borrowerAmount;
            position.poolAmount = poolAmount;
            position.feeAmount = feeAmount;
            position.assetAmountOut = assetAmountOut;
          } catch (e) {
            console.error("checkPosition failed", e);
          }
        }
        fetched.push(position);
      } catch (e) {
        console.error("Position fetch failed", e);
      }
    }
    state.positions = fetched;
    renderPositions();
  } catch (e) {
    console.error("Positions fetch failed", e);
    state.positions = [];
    renderPositions();
  }
}

async function refreshAllowance() {
  if (!state.signer) {
    setApprovalText("–");
    setRouterApprovalText("–");
    return;
  }
  try {
    if (state.vaultAddress) {
      const allowance = await state.asset.allowance(state.addr, state.vaultAddress);
      state.allowance = allowance;
      const display = Number(ethers.formatUnits(allowance, state.assetDecimals));
      setApprovalText(display.toFixed(2));
    } else {
      setApprovalText("–");
    }
    const routerAllowance = await state.asset.allowance(state.addr, UNISWAP_V2_ROUTER);
    state.routerAllowance = routerAllowance;
    const routerDisplay = Number(ethers.formatUnits(routerAllowance, state.assetDecimals));
    setRouterApprovalText(routerDisplay.toFixed(2));
    const swapAllowance = await state.asset.allowance(state.addr, state.swapAddress || state.vaultAddress);
    state.swapAllowance = swapAllowance;
  } catch (e) {
    console.error(e);
    setApprovalText("?");
    setRouterApprovalText("?");
  }
}

function short(addr) {
  return addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "";
}

async function quote() {
  const val = $("amount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    $("quote").textContent = "–";
    updateSwapState();
    return;
  }
  if (!state.router) return;
  try {
    const amountInWei = ethers.parseEther(val.toString());
    const amounts = await state.router.getAmountsOut(amountInWei, [WETH, state.assetAddress]);
    const out = amounts[1];
    $("quote").textContent = ethers.formatUnits(out, state.assetDecimals) + " asset";
  } catch (err) {
    console.error(err);
    $("quote").textContent = "Error";
  }
  updateSwapState();
}

async function quoteUsdc() {
  const val = $("amountUsdc").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    $("quoteUsdc").textContent = "–";
    updateSwapUsdcState();
    return;
  }
  if (!state.router) return;
  try {
    const amountIn = ethers.parseUnits(val.toString(), state.assetDecimals);
    const amounts = await state.router.getAmountsOut(amountIn, [state.assetAddress, WETH]);
    const out = amounts[1];
    $("quoteUsdc").textContent = ethers.formatEther(out) + " ETH";
  } catch (err) {
    console.error(err);
    $("quoteUsdc").textContent = "Error";
  }
  updateSwapUsdcState();
}

async function swap() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  const val = $("amount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setStatus("Enter an amount");
  }
  const amountInWei = ethers.parseEther(val.toString());
  let minOut;
  try {
    const amounts = await state.router.getAmountsOut(amountInWei, [WETH, state.assetAddress]);
    minOut = amounts[1] * 99n / 100n;
  } catch (err) {
    console.error(err);
    return setStatus("Quote failed");
  }
  try {
    setStatus("Sending swap…");
    const tx = await state.router.swapExactETHForTokens(
      minOut,
      [WETH, state.assetAddress],
      state.addr,
      Math.floor(Date.now() / 1000) + 60 * 10,
      { value: amountInWei, gasLimit: 700000n }
    );
    setStatus("Pending… " + tx.hash);
    await tx.wait();
    setStatus("Swap confirmed");
    await refreshBalances();
    await quote();
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Swap failed");
  }
}

async function swapUsdc() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  const val = $("amountUsdc").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setSwapUsdcStatus("Enter an amount");
  }
  let amountIn;
  try {
    amountIn = ethers.parseUnits(val.toString(), state.assetDecimals);
  } catch (e) {
    console.error(e);
    return setSwapUsdcStatus("Invalid amount");
  }
  let minOut;
  try {
    const amounts = await state.router.getAmountsOut(amountIn, [state.assetAddress, WETH]);
    minOut = amounts[1] * 99n / 100n;
  } catch (err) {
    console.error(err);
    return setSwapUsdcStatus("Quote failed");
  }
  if (state.routerAllowance < amountIn) {
    return setSwapUsdcStatus("Allowance too low. Approve router first.");
  }
  try {
    setSwapUsdcStatus("Sending swap…");
    const tx = await state.router.swapExactTokensForETH(
      amountIn,
      minOut,
      [state.assetAddress, WETH],
      state.addr,
      Math.floor(Date.now() / 1000) + 60 * 10,
      { gasLimit: 700000n }
    );
    setSwapUsdcStatus("Pending… " + tx.hash);
    await tx.wait();
    setSwapUsdcStatus("Swap confirmed");
    await refreshBalances();
    await quoteUsdc();
    await refreshAllowance();
    updateSwapUsdcState();
  } catch (err) {
    console.error(err);
    setSwapUsdcStatus(err.message || "Swap failed");
  }
}

$("connectBtn").onclick = connect;
$("swapBtn").onclick = swap;
$("amount").oninput = quote;
$("amountUsdc").oninput = quoteUsdc;
$("swapUsdcBtn").onclick = swapUsdc;
$("openPositionBtn").onclick = openPosition;

function updateSwapState() {
  const connected = Boolean(state.signer);
  setSwapDisabled(!(connected && isAmountValid()));
}

function updateSwapUsdcState() {
  const connected = Boolean(state.signer);
  setSwapUsdcDisabled(!(connected && isAmountUsdcValid()));
  setRouterApproveDisabled(!(connected && state.routerAllowance === 0n));
}

function updatePoolState() {
  const connected = Boolean(state.signer);
  setPoolDisabled(!(connected && isDepositValid()), !(connected && isWithdrawValid()));
}

function updatePositionState() {
  const connected = Boolean(state.signer);
  setOpenPositionDisabled(!(connected && isPositionValid()));
  setPositionQuote("–");
}

function updateFeesState() {
  const connected = Boolean(state.signer);
  const to = $("feesTo")?.value?.trim();
  const can = connected && state.canWithdrawFees && to && ethers.isAddress(to);
  setWithdrawFeesDisabled(!can);
}

async function quotePosition() {
  const val = $("positionAmount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    setPositionQuote("–");
    $("positionBorrow").textContent = "–";
    setPositionFee("–");
    setPositionSwapIn("–");
    setPositionRate("–");
    return;
  }
  if (!state.router || !state.assetAddress || !state.targetTokenAddress) {
    setPositionQuote("–");
    $("positionBorrow").textContent = "–";
    setPositionFee("–");
    setPositionSwapIn("–");
    setPositionRate("–");
    return;
  }
  try {
    const amountIn = ethers.parseUnits(val.toString(), state.assetDecimals);
    const fee = (amountIn * (state.feeBps || 0n)) / 10_000n;
    const net = amountIn - fee;
    const totalSwapIn = net * 2n;

    const amounts = await state.router.getAmountsOut(totalSwapIn, [state.assetAddress, state.targetTokenAddress]);
    const out = amounts[1];
    const outFormatted = ethers.formatUnits(out, state.targetDecimals);
    setPositionQuote(outFormatted);
    $("positionBorrow").textContent = ethers.formatUnits(net, state.assetDecimals);
    setPositionFee(ethers.formatUnits(fee, state.assetDecimals));
    setPositionSwapIn(ethers.formatUnits(totalSwapIn, state.assetDecimals));
    // rate: asset per target
    const totalAssetFormatted = ethers.formatUnits(totalSwapIn, state.assetDecimals);
    const rate = Number(totalAssetFormatted) / Number(outFormatted || 1);
    setPositionRate(`${rate.toFixed(6)} asset/target`);
  } catch (e) {
    console.error(e);
    setPositionQuote("Error");
    $("positionBorrow").textContent = "Error";
    setPositionFee("Error");
    setPositionSwapIn("Error");
    setPositionRate("Error");
  }
}

async function loadConfig() {
  try {
    const res = await fetch("/data/deployment.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("config not found");
    const cfg = await res.json();
    if (cfg.x2swap) {
      state.swapAddress = cfg.x2swap;
    } else if (cfg.x2deployer && cfg.targetToken) {
      if (!window.ethereum) throw new Error("Metamask not detected");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const deployer = new ethers.Contract(cfg.x2deployer, ["function swaps(address) view returns (address)"], provider);
      const swapAddr = await deployer.swaps(cfg.targetToken);
      if (!swapAddr || swapAddr === ethers.ZeroAddress) throw new Error("x2swap missing");
      state.swapAddress = swapAddr;
    } else {
      throw new Error("x2swap missing");
    }
    showApp();
  } catch (err) {
    console.warn("Config load failed:", err.message);
    setLoading("Config not found. Ensure /data/deployment.json exists.");
  }
}

setLoading("Loading config…");
loadConfig();

$("depositAmount").oninput = () => {
  updatePoolState();
};
$("withdrawAmount").oninput = () => {
  updatePoolState();
};
$("amountUsdc").oninput = () => {
  updateSwapUsdcState();
};
$("positionAmount").oninput = () => {
  updatePositionState();
  quotePosition();
};
if ($("feesTo")) {
  $("feesTo").oninput = updateFeesState;
}
if ($("feesAmount")) {
  $("feesAmount").oninput = updateFeesState;
}

async function depositPool() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!state.vault) {
    return setPoolStatus("Pool not configured");
  }
  const val = $("depositAmount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setPoolStatus("Enter deposit amount");
  }
  let amount;
  try {
    amount = ethers.parseUnits(val.toString(), state.assetDecimals);
  } catch (e) {
    console.error(e);
    return setPoolStatus("Invalid amount");
  }
  try {
    const ok = await ensureVaultApproval(amount);
    if (!ok) return;
    setPoolStatus("Depositing...");
    const tx = await state.vault.deposit(amount, state.addr, { gasLimit: 700000n });
    setPoolStatus("Pending… " + tx.hash);
    await tx.wait();
    setPoolStatus("Deposit confirmed");
    await refreshBalances();
    await refreshAllowance();
    await refreshPoolInfo();
  } catch (e) {
    console.error(e);
    setPoolStatus(e.reason || e.message || "Deposit failed");
  }
}

async function withdrawPool() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!state.vault) {
    return setPoolStatus("Pool not configured");
  }
  const val = $("withdrawAmount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setPoolStatus("Enter withdraw amount");
  }
  let amount;
  try {
    amount = ethers.parseUnits(val.toString(), state.shareDecimals);
  } catch (e) {
    console.error(e);
    return setPoolStatus("Invalid amount");
  }
  try {
    setPoolStatus("Redeeming...");
    const tx = await state.vault.redeem(amount, state.addr, state.addr, { gasLimit: 700000n });
    setPoolStatus("Pending… " + tx.hash);
    await tx.wait();
    setPoolStatus("Redemption confirmed");
    await refreshBalances();
    await refreshAllowance();
    await refreshPoolInfo();
  } catch (e) {
    console.error(e);
    setPoolStatus(e.reason || e.message || "Withdraw failed");
  }
}

$("depositBtn").onclick = depositPool;
$("withdrawBtn").onclick = withdrawPool;

async function approveRouter() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  try {
    setSwapUsdcStatus("Approving router...");
    const tx = await state.asset.connect(state.signer).approve(UNISWAP_V2_ROUTER, ethers.MaxUint256);
    setSwapUsdcStatus("Pending… " + tx.hash);
    await tx.wait();
    setSwapUsdcStatus("Router approved");
    await refreshAllowance();
    updateSwapUsdcState();
  } catch (e) {
    console.error(e);
    setSwapUsdcStatus(e.reason || e.message || "Router approve failed");
  }
}

$("routerApproveBtn").onclick = approveRouter;

async function ensureVaultApproval(amount) {
  try {
    const current = await state.asset.allowance(state.addr, state.vaultAddress);
    if (current >= amount) return true;
    setPoolStatus("Approving vault...");
    const tx = await state.asset.connect(state.signer).approve(state.vaultAddress, ethers.MaxUint256);
    setPoolStatus("Pending… " + tx.hash);
    await tx.wait();
    await refreshAllowance();
    return true;
  } catch (e) {
    console.error(e);
    setPoolStatus(e.reason || e.message || "Pool approve failed");
    return false;
  }
}

async function ensureSwapApproval(amount) {
  try {
    const current = await state.asset.allowance(state.addr, state.swapAddress || state.vaultAddress);
    if (current >= amount) return true;
    setPositionStatus("Approving X2Swap...");
    const tx = await state.asset.connect(state.signer).approve(state.swapAddress || state.vaultAddress, ethers.MaxUint256);
    setPositionStatus("Pending… " + tx.hash);
    await tx.wait();
    await refreshAllowance();
    return true;
  } catch (e) {
    console.error(e);
    setPositionStatus(e.reason || e.message || "Swap approve failed");
    return false;
  }
}

async function openPosition() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!state.swapAddress) {
    return setPositionStatus("Swap not configured");
  }
  const val = $("positionAmount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setPositionStatus("Enter position amount");
  }
  let amount;
  try {
    amount = ethers.parseUnits(val.toString(), state.assetDecimals);
  } catch (e) {
    console.error(e);
    return setPositionStatus("Invalid amount");
  }
  const openFee = (amount * (state.feeBps || 0n)) / 10_000n;
  const net = amount - openFee;
  if (state.poolAvailable && net > state.poolAvailable) {
    return setPositionStatus("Insufficient pool liquidity");
  }
  const ok = await ensureSwapApproval(amount);
  if (!ok) return;
  try {
    setPositionStatus("Opening position...");
    const tx = await state.swap.openPosition(amount, { gasLimit: 900000n });
    setPositionStatus("Pending… " + tx.hash);
    await tx.wait();
    setPositionStatus("Position opened");
    await refreshBalances();
    await refreshAllowance();
    await refreshPoolInfo();
    await refreshPositions();
  } catch (e) {
    console.error(e);
    console.log(e.errorName, e.errorArgs);
    console.log(e.shortMessage || e.reason || e.message);
    setPositionStatus(e.reason || e.message || "Open position failed");
  }
}

$("openPositionBtn").onclick = openPosition;

async function handleClosePosition(id) {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!state.swap) {
    return setPositionsStatus("Swap not loaded");
  }
  try {
    setPositionsStatus(`Closing #${id}...`);
    const tx = await state.swap.closePosition(id, { gasLimit: 900000n });
    setPositionsStatus("Pending… " + tx.hash);
    await tx.wait();
    setPositionsStatus("Closed");
    await refreshBalances();
    await refreshPoolInfo();
    await refreshPositions();
  } catch (e) {
    console.error(e);
    setPositionsStatus(e.reason || e.message || "Close failed");
  }
}

async function withdrawFees() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!state.swap) return setFeesStatus("Swap not loaded");
  if (!state.canWithdrawFees) return setFeesStatus("Not authorized");

  const to = $("feesTo")?.value?.trim();
  if (!to || !ethers.isAddress(to)) return setFeesStatus("Enter valid recipient");

  const amountVal = $("feesAmount")?.value?.trim();
  let amount = 0n;
  if (amountVal) {
    try {
      amount = ethers.parseUnits(amountVal.toString(), state.assetDecimals);
    } catch (e) {
      console.error(e);
      return setFeesStatus("Invalid amount");
    }
  }
  try {
    setFeesStatus("Withdrawing...");
    const tx = await state.swap.withdrawFees(to, amount, { gasLimit: 500000n });
    setFeesStatus("Pending… " + tx.hash);
    await tx.wait();
    setFeesStatus("Withdrawn");
    await refreshBalances();
    await refreshPoolInfo();
  } catch (e) {
    console.error(e);
    setFeesStatus(e.reason || e.message || "Withdraw failed");
  }
}

if ($("withdrawFeesBtn")) {
  $("withdrawFeesBtn").onclick = withdrawFees;
}
