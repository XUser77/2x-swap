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
  "function targetToken() view returns (address)"
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
  vaultAddress: null,
  vault: null,
  shareDecimals: 18,
  allowance: 0n,
  routerAllowance: 0n
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
const setShareLabel = (txt) => {
  const el = $("shareLabel");
  if (el) el.textContent = txt || "Pool Token";
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
      state.vaultAddress = poolAddr;
      state.assetAddress = assetAddr;
      state.targetTokenAddress = targetAddr;
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
  state.asset = new ethers.Contract(state.assetAddress, erc20Abi, state.provider);
  try {
    state.assetDecimals = await state.asset.decimals();
  } catch (e) {
    console.error(e);
    state.assetDecimals = 6;
  }
  $("addr").textContent = `${short(state.addr)}`;
  await refreshBalances();
  await refreshAllowance();
  setStatus("Connected");
  setConnStatus("Connected to Hardhat fork (chainId 31337)");
  setPoolStatus("Connected");
  updateSwapState();
  updateSwapUsdcState();
  updatePoolState();
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

async function loadConfig() {
  try {
    const res = await fetch("/data/deployment.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("config not found");
    const cfg = await res.json();
    if (cfg.x2swap) {
      state.swapAddress = cfg.x2swap;
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
    const tx = await state.usdc.connect(state.signer).approve(UNISWAP_V2_ROUTER, ethers.MaxUint256);
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
