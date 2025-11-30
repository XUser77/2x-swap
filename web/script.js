import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.11.1/dist/ethers.min.js";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];
const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)"
];

const state = {
  provider: null,
  signer: null,
  addr: null,
  router: null,
  usdc: null,
  usdcDecimals: 6,
  usdcAddress: USDC,
  lpAddress: null,
  lp: null,
  lpDecimals: 18,
  poolAddress: null,
  pool: null,
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
const setApprovalDisabled = (incDisabled, decDisabled) => {
  const inc = $("increaseApprovalBtn");
  const dec = $("decreaseApprovalBtn");
  if (inc) inc.disabled = incDisabled;
  if (dec) dec.disabled = decDisabled;
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
const isApprovalValid = () => {
  const val = $("approvalAmount").value;
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
  state.usdc = new ethers.Contract(state.usdcAddress, erc20Abi, state.provider);
  try {
    state.usdcDecimals = await state.usdc.decimals();
  } catch (e) {
    console.error(e);
    state.usdcDecimals = 6;
  }
  if (state.lpAddress) {
    state.lp = new ethers.Contract(state.lpAddress, erc20Abi, state.provider);
    try {
      state.lpDecimals = await state.lp.decimals();
    } catch (e) {
      console.error(e);
      state.lpDecimals = 18;
    }
  }
  if (state.poolAddress) {
    state.pool = new ethers.Contract(
      state.poolAddress,
      ["function deposit(uint256) external returns (uint256)", "function withdraw(uint256) external returns (uint256)"],
      state.signer
    );
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
  const usdcBal = await state.usdc.balanceOf(state.addr);
  const usdcDisplay = Number(ethers.formatUnits(usdcBal, state.usdcDecimals));
  $("usdcBal").textContent = `${usdcDisplay.toFixed(2)}`;
  if (state.lp) {
    try {
      const lpBal = await state.lp.balanceOf(state.addr);
      const display = Number(ethers.formatUnits(lpBal, state.lpDecimals));
      $("lpBal").textContent = `${display.toFixed(4)}`;
    } catch (e) {
      console.error(e);
      $("lpBal").textContent = "?";
    }
  } else {
    $("lpBal").textContent = "(no config)";
  }
}

async function refreshAllowance() {
  if (!state.signer) {
    setApprovalText("–");
    setRouterApprovalText("–");
    return;
  }
  try {
    if (state.poolAddress) {
      const allowance = await state.usdc.allowance(state.addr, state.poolAddress);
      state.allowance = allowance;
      const display = Number(ethers.formatUnits(allowance, state.usdcDecimals));
      setApprovalText(display.toFixed(2));
    } else {
      setApprovalText("–");
    }
    const routerAllowance = await state.usdc.allowance(state.addr, UNISWAP_V2_ROUTER);
    state.routerAllowance = routerAllowance;
    const routerDisplay = Number(ethers.formatUnits(routerAllowance, state.usdcDecimals));
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
    const amounts = await state.router.getAmountsOut(amountInWei, [WETH, USDC]);
    const out = amounts[1];
    $("quote").textContent = (Number(out) / 1e6).toFixed(4) + " USDC";
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
    const amountIn = ethers.parseUnits(val.toString(), state.usdcDecimals);
    const amounts = await state.router.getAmountsOut(amountIn, [USDC, WETH]);
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
    const amounts = await state.router.getAmountsOut(amountInWei, [WETH, USDC]);
    minOut = amounts[1] * 99n / 100n;
  } catch (err) {
    console.error(err);
    return setStatus("Quote failed");
  }
  try {
    setStatus("Sending swap…");
    const tx = await state.router.swapExactETHForTokens(
      minOut,
      [WETH, USDC],
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
    amountIn = ethers.parseUnits(val.toString(), state.usdcDecimals);
  } catch (e) {
    console.error(e);
    return setSwapUsdcStatus("Invalid amount");
  }
  let minOut;
  try {
    const amounts = await state.router.getAmountsOut(amountIn, [USDC, WETH]);
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
      [USDC, WETH],
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
  setApprovalDisabled(!(connected && isApprovalValid()), !(connected && isApprovalValid()));
}

async function loadConfig() {
  try {
    const res = await fetch("/data/deployment.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("config not found");
    const cfg = await res.json();
    if (cfg.pool) {
      state.poolAddress = cfg.pool;
    }
    if (cfg.sourceToken) {
      state.usdcAddress = cfg.sourceToken;
    }
    if (cfg.lpToken) {
      state.lpAddress = cfg.lpToken;
      if (state.signer) {
        $("lpBal").textContent = "loading...";
      } else {
        $("lpBal").textContent = "–";
      }
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
$("approvalAmount").oninput = () => {
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
  if (!state.pool) {
    return setPoolStatus("Pool not configured");
  }
  const val = $("depositAmount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setPoolStatus("Enter deposit amount");
  }
  let amount;
  try {
    amount = ethers.parseUnits(val.toString(), state.usdcDecimals);
  } catch (e) {
    console.error(e);
    return setPoolStatus("Invalid amount");
  }
  try {
    setPoolStatus("Depositing...");
    const tx = await state.pool.deposit(amount, { gasLimit: 700000n });
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
  if (!state.pool) {
    return setPoolStatus("Pool not configured");
  }
  const val = $("withdrawAmount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setPoolStatus("Enter withdraw amount");
  }
  let amount;
  try {
    amount = ethers.parseUnits(val.toString(), state.lpDecimals);
  } catch (e) {
    console.error(e);
    return setPoolStatus("Invalid amount");
  }
  try {
    setPoolStatus("Withdrawing...");
    const tx = await state.pool.withdraw(amount, { gasLimit: 700000n });
    setPoolStatus("Pending… " + tx.hash);
    await tx.wait();
    setPoolStatus("Withdrawal confirmed");
    await refreshBalances();
    await refreshAllowance();
  } catch (e) {
    console.error(e);
    setPoolStatus(e.reason || e.message || "Withdraw failed");
  }
}

$("depositBtn").onclick = depositPool;
$("withdrawBtn").onclick = withdrawPool;

async function changeApproval(direction) {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!state.poolAddress) {
    return setPoolStatus("Pool not configured");
  }
  const val = $("approvalAmount").value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    return setPoolStatus("Enter approval amount");
  }
  let delta;
  try {
    delta = ethers.parseUnits(val.toString(), state.usdcDecimals);
  } catch (e) {
    console.error(e);
    return setPoolStatus("Invalid amount");
  }
  let newAllowance;
  if (direction === "increase") {
    newAllowance = state.allowance + delta;
  } else {
    if (state.allowance < delta) {
      return setPoolStatus("Decrease exceeds current allowance");
    }
    newAllowance = state.allowance - delta;
  }
  try {
    setPoolStatus(`${direction === "increase" ? "Increasing" : "Decreasing"} approval...`);
    const tx = await state.usdc.connect(state.signer).approve(state.poolAddress, newAllowance);
    setPoolStatus("Pending… " + tx.hash);
    await tx.wait();
    setPoolStatus("Approval updated");
    await refreshAllowance();
    updatePoolState();
    updateSwapUsdcState();
  } catch (e) {
    console.error(e);
    setPoolStatus(e.reason || e.message || "Approval failed");
  }
}

$("increaseApprovalBtn").onclick = () => changeApproval("increase");
$("decreaseApprovalBtn").onclick = () => changeApproval("decrease");

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
