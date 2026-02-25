import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.11.1/dist/ethers.min.js";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const DEFAULT_ASSET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const swapAbi = [
  "function pool() view returns (address)",
  "function feeGovernance() view returns (address)",
  "function asset() view returns (address)",
  "function targetToken() view returns (address)",
  "function positionDuration() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function feesAccrued() view returns (uint256)",
  "function withdrawFees(address to, uint256 amount) returns (uint256)",
  "function previewNewPosition(uint256 assetAmount, uint256 maxDeviationBps, address exchangeAddress, bytes path) view returns (uint256 openFee, uint256 netUserAmount, uint256 totalAmount, uint256 expectedOut, uint256 oracleMinTargetOut, uint256 profitSharing)",
  "function openPosition(uint256 assetAmount, uint256 maxDeviationBps, address exchangeAddress, bytes path, uint256 deadline) returns (uint256)",
  "function closePosition(uint256 id, uint256 maxDeviationBps, address exchangeAddress, bytes path, uint256 deadline)",
  "function getUserPositions(address) view returns (uint256[] memory)",
  "function positions(uint256) view returns (uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)"
];

const deployerAbi = ["function swaps(address) view returns (address)"];
const exchangeAbi = ["function provider() view returns (string)"];
const feeGovAbi = ["function isWithdrawer(address) view returns (bool)"];

const erc20Abi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const vaultAbi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalDebt() view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)"
];

const DEFAULT_MAX_DEVIATION_BPS = 500n;

const state = {
  provider: null,
  signer: null,
  addr: null,
  router: null,
  asset: null,
  assetAddress: DEFAULT_ASSET,
  assetDecimals: 6,
  vault: null,
  vaultAddress: null,
  shareDecimals: 18,
  poolAvailable: 0n,
  allowance: 0n,
  routerAllowance: 0n,
  feeGovernanceAddress: null,
  feeGovernance: null,
  uniswapV3Fee: 3000,
  swaps: []
};

const $ = (id) => document.getElementById(id);

function short(addr) {
  return addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "";
}

function keyFromAddress(address) {
  return `swap-${address.toLowerCase().replace(/^0x/, "")}`;
}

function symbolFromAddress(address) {
  if (!address) return "TOKEN";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function swapEl(swapState, suffix) {
  return document.getElementById(`${swapState.key}-${suffix}`);
}

function setHtml(el, msg) {
  if (el) el.innerHTML = `<span>${msg}</span>`;
}

function setText(el, msg) {
  if (el) el.textContent = msg;
}

function setLoading(msg) {
  const el = $("loading");
  if (el) el.textContent = msg;
}

function showApp() {
  const app = $("app");
  const loading = $("loading");
  if (app) app.classList.remove("hidden");
  if (loading) loading.classList.add("hidden");
}

function setConnStatus(msg) {
  setText($("connStatus"), msg);
}

function setPoolStatus(msg) {
  setHtml($("poolStatus"), msg);
}

function setStatus(msg) {
  setHtml($("status"), msg);
}

function setSwapUsdcStatus(msg) {
  setHtml($("statusUsdc"), msg);
}

function setShareLabel(txt) {
  setText($("shareLabel"), txt || "Pool Token");
}

function setApprovalText(txt) {
  setText($("approvalVal"), txt);
}

function setRouterApprovalText(txt) {
  setText($("routerApprovalVal"), txt);
}

function setSwapDisabled(disabled) {
  const btn = $("swapBtn");
  if (btn) btn.disabled = disabled;
}

function setSwapUsdcDisabled(disabled) {
  const btn = $("swapUsdcBtn");
  if (btn) btn.disabled = disabled;
}

function setRouterApproveDisabled(disabled) {
  const btn = $("routerApproveBtn");
  if (btn) btn.disabled = disabled;
}

function setPoolDisabled(depositDisabled, withdrawDisabled) {
  const d = $("depositBtn");
  const w = $("withdrawBtn");
  if (d) d.disabled = depositDisabled;
  if (w) w.disabled = withdrawDisabled;
}

function isAmountValid(id) {
  const val = $(id)?.value;
  return Boolean(val && !isNaN(val) && Number(val) > 0);
}

function getExchangeLabel(swapState, exchangeAddress) {
  if (!exchangeAddress) return "";
  return swapState.exchangeLabels?.[exchangeAddress] || "";
}

function encodeV3Path(tokenIn, tokenOut) {
  return ethers.solidityPacked(["address", "uint24", "address"], [tokenIn, state.uniswapV3Fee, tokenOut]);
}

function getOpenPath(swapState, exchangeAddress) {
  if (!state.assetAddress || !swapState.targetTokenAddress) {
    throw new Error("Swap path not configured");
  }
  const label = getExchangeLabel(swapState, exchangeAddress);
  if (label === "UniswapV3") {
    return encodeV3Path(state.assetAddress, swapState.targetTokenAddress);
  }
  return ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [[state.assetAddress, swapState.targetTokenAddress]]);
}

function getClosePath(swapState, exchangeAddress) {
  if (!state.assetAddress || !swapState.targetTokenAddress) {
    throw new Error("Swap path not configured");
  }
  const label = getExchangeLabel(swapState, exchangeAddress);
  if (label === "UniswapV3") {
    return encodeV3Path(swapState.targetTokenAddress, state.assetAddress);
  }
  return ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [[swapState.targetTokenAddress, state.assetAddress]]);
}

function renderX2SwapBlocks() {
  const container = $("x2swapBlocks");
  if (!container) return;
  if (!state.swaps.length) {
    container.innerHTML = `<div class="muted">No X2Swap targets configured.</div>`;
    return;
  }

  container.innerHTML = state.swaps.map((swapState) => `
    <div class="card">
      <h2 style="margin:0 0 6px;font-size:18px;">X2Swap ${swapState.symbol}</h2>
      <p class="muted">Swap: ${short(swapState.swapAddress)} | Target: ${short(swapState.targetTokenAddress)}</p>

      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-header">Pool Availability</div>
        <div class="balance-row" style="margin-top:0;">
          <div class="balance-label">Fee</div>
          <div class="balance-value" id="${swapState.key}-feeBps">–</div>
        </div>
        <div class="balance-row" style="margin-top:0;">
          <div class="balance-label">Assets (incl. debt)</div>
          <div class="balance-value" id="${swapState.key}-poolAssets">–</div>
        </div>
        <div class="balance-row" style="margin-top:8px;">
          <div class="balance-label">Available</div>
          <div class="balance-value" id="${swapState.key}-poolAvailable">–</div>
        </div>
        <div class="balance-row" style="margin-top:8px;">
          <div class="balance-label">Borrowed</div>
          <div class="balance-value" id="${swapState.key}-poolDebt">–</div>
        </div>
      </div>

      <div style="margin-top:12px;">
        <label for="${swapState.key}-exchangeSelect">Exchange</label>
        <select id="${swapState.key}-exchangeSelect" ${swapState.exchanges.length ? "" : "disabled"}></select>
      </div>

      <div style="margin-top:12px;">
        <label for="${swapState.key}-positionAmount">Position amount (underlying)</label>
        <input id="${swapState.key}-positionAmount" type="number" step="0.0001" min="0" placeholder="100" />
      </div>

      <div style="margin-top:10px;">
        <span class="muted">Borrow from pool: <span id="${swapState.key}-positionBorrow">–</span></span><br/>
        <span class="muted">Open fee: <span id="${swapState.key}-positionFee">–</span></span><br/>
        <span class="muted">Swap input (2x): <span id="${swapState.key}-positionSwapIn">–</span></span><br/>
        <span class="muted">Expected target out: <span id="${swapState.key}-positionQuote">–</span></span><br/>
        <span class="muted">Rate: <span id="${swapState.key}-positionRate">–</span></span><br/>
        <span class="muted">Duration: <span id="${swapState.key}-positionDuration">–</span></span>
      </div>

      <div style="margin-top:16px;" class="row">
        <button id="${swapState.key}-openPositionBtn" disabled>Open Position</button>
      </div>

      <div class="status" id="${swapState.key}-positionStatus"><span>Idle</span></div>

      <div class="panel" style="margin-top:12px;margin-bottom:10px;">
        <div class="panel-header">My Positions</div>
        <div id="${swapState.key}-positionsList" class="muted" style="font-size:13px;">Connect wallet to load positions.</div>
      </div>
      <div class="status" id="${swapState.key}-positionsStatus"><span>Idle</span></div>

      <div class="panel" style="margin-top:14px;margin-bottom:14px;">
        <div class="panel-header">Fees</div>
        <div class="balance-row" style="margin-top:0;">
          <div class="balance-label">Accrued</div>
          <div class="balance-value" id="${swapState.key}-feesAccrued">–</div>
        </div>
        <div class="muted" id="${swapState.key}-feesAuth" style="font-size:12px;margin-top:6px;">–</div>
        <div style="margin-top:10px;">
          <label for="${swapState.key}-feesTo">Withdraw to</label>
          <input id="${swapState.key}-feesTo" type="text" placeholder="0x..." />
        </div>
        <div style="margin-top:10px;">
          <label for="${swapState.key}-feesAmount">Amount</label>
          <input id="${swapState.key}-feesAmount" type="number" step="0.0001" min="0" placeholder="0" />
        </div>
        <div style="margin-top:10px;" class="row">
          <button id="${swapState.key}-withdrawFeesBtn" disabled>Withdraw Fees</button>
        </div>
        <div class="status" id="${swapState.key}-feesStatus"><span>Idle</span></div>
      </div>
    </div>
  `).join("");

  state.swaps.forEach((swapState) => {
    const exchangeSelect = swapEl(swapState, "exchangeSelect");
    if (exchangeSelect) {
      exchangeSelect.onchange = () => {
        swapState.exchangeAddress = exchangeSelect.value || null;
        quotePosition(swapState);
      };
    }

    const amountInput = swapEl(swapState, "positionAmount");
    if (amountInput) {
      amountInput.oninput = () => {
        updatePositionState(swapState);
        quotePosition(swapState);
      };
    }

    const openBtn = swapEl(swapState, "openPositionBtn");
    if (openBtn) {
      openBtn.onclick = () => openPosition(swapState);
    }

    const feesTo = swapEl(swapState, "feesTo");
    if (feesTo) {
      feesTo.oninput = () => updateFeesState(swapState);
    }

    const feesAmount = swapEl(swapState, "feesAmount");
    if (feesAmount) {
      feesAmount.oninput = () => updateFeesState(swapState);
    }

    const withdrawBtn = swapEl(swapState, "withdrawFeesBtn");
    if (withdrawBtn) {
      withdrawBtn.onclick = () => withdrawFees(swapState);
    }
  });
}

function renderExchangeSelect(swapState) {
  const select = swapEl(swapState, "exchangeSelect");
  if (!select) return;
  select.innerHTML = "";
  if (!swapState.exchanges.length) {
    select.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No exchanges";
    select.appendChild(opt);
    return;
  }
  swapState.exchanges.forEach((addr, idx) => {
    const opt = document.createElement("option");
    opt.value = addr;
    const label = swapState.exchangeLabels?.[addr];
    const base = label && label.trim() ? label : `Exchange ${idx + 1}`;
    opt.textContent = `${base} (${short(addr)})`;
    select.appendChild(opt);
  });
  select.disabled = false;
  if (swapState.exchangeAddress && swapState.exchanges.includes(swapState.exchangeAddress)) {
    select.value = swapState.exchangeAddress;
  } else {
    swapState.exchangeAddress = swapState.exchanges[0];
    select.value = swapState.exchangeAddress;
  }
}

async function loadExchangeProviders(swapState) {
  if (!state.provider || !swapState.exchanges.length) return;
  const labels = { ...(swapState.exchangeLabels || {}) };
  await Promise.all(
    swapState.exchanges.map(async (addr) => {
      if (labels[addr]) return;
      try {
        const ex = new ethers.Contract(addr, exchangeAbi, state.provider);
        const name = await ex.provider();
        labels[addr] = name || "";
      } catch (e) {
        console.error("Exchange provider fetch failed", addr, e);
      }
    })
  );
  swapState.exchangeLabels = labels;
  renderExchangeSelect(swapState);
}

function renderPositions(swapState) {
  const list = swapEl(swapState, "positionsList");
  if (!list) return;
  if (!swapState.positions.length) {
    list.innerHTML = "No positions";
    return;
  }
  const rows = swapState.positions.map((p) => {
    const openAmt = ethers.formatUnits(p.openAssetAmount, state.assetDecimals);
    const targetAmt = ethers.formatUnits(p.targetAmount, swapState.targetDecimals || 18);
    const status = p.closeDate > 0 ? "Closed" : "Open";
    const openDate = p.openDate ? new Date(Number(p.openDate) * 1000).toLocaleString() : "-";
    let body = `<div class="balance-row" style="margin-bottom:6px;">
      <div class="balance-label">#${p.id} ${status}</div>
      <div class="balance-value">${openAmt} asset → ${targetAmt} ${swapState.symbol}</div>
    </div>
    <div class="muted" style="font-size:12px;margin:4px 0;">Opened: ${openDate}</div>`;

    if (p.closeDate > 0) {
      const closeAmt = ethers.formatUnits(p.closeAssetAmount, state.assetDecimals);
      body += `<div class="muted" style="font-size:12px;margin:0 0 10px;">Closed for ${closeAmt} asset</div>`;
    } else {
      body += `<button class="close-btn" data-swap="${swapState.key}" data-pos="${p.id}">Close</button>`;
    }
    return `<div class="panel" style="margin-bottom:10px;padding:10px;">${body}</div>`;
  }).join("");

  list.innerHTML = rows;
  list.querySelectorAll(".close-btn").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.pos);
      await handleClosePosition(swapState, id);
    };
  });
}

function updateSwapState() {
  const connected = Boolean(state.signer);
  setSwapDisabled(!(connected && isAmountValid("amount")));
}

function updateSwapUsdcState() {
  const connected = Boolean(state.signer);
  setSwapUsdcDisabled(!(connected && isAmountValid("amountUsdc")));
  setRouterApproveDisabled(!(connected && state.routerAllowance === 0n));
}

function updatePoolState() {
  const connected = Boolean(state.signer);
  setPoolDisabled(!(connected && isAmountValid("depositAmount")), !(connected && isAmountValid("withdrawAmount")));
}

function updatePositionState(swapState) {
  const connected = Boolean(state.signer);
  const amountValid = isAmountValid(`${swapState.key}-positionAmount`);
  const btn = swapEl(swapState, "openPositionBtn");
  if (btn) btn.disabled = !(connected && amountValid);
  setText(swapEl(swapState, "positionQuote"), "–");
}

function updateFeesState(swapState) {
  const connected = Boolean(state.signer);
  const to = swapEl(swapState, "feesTo")?.value?.trim();
  const can = connected && swapState.canWithdrawFees && to && ethers.isAddress(to);
  const btn = swapEl(swapState, "withdrawFeesBtn");
  if (btn) btn.disabled = !can;
}

async function loadConfig() {
  const res = await fetch("data/deployment.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("config not found");
  const cfg = await res.json();

  if (cfg.uniswapV3Fee && Number.isFinite(Number(cfg.uniswapV3Fee))) {
    state.uniswapV3Fee = Number(cfg.uniswapV3Fee);
  }

  const swaps = [];
  if (Array.isArray(cfg.targets) && cfg.targets.length) {
    for (const target of cfg.targets) {
      const targetToken = target?.targetToken;
      const swapAddress = target?.swap;
      if (!ethers.isAddress(targetToken) || !ethers.isAddress(swapAddress)) continue;
      const exchanges = Array.isArray(target.exchanges)
        ? target.exchanges.filter((addr) => ethers.isAddress(addr))
        : [];
      swaps.push({
        key: keyFromAddress(targetToken),
        symbol: target.symbol || symbolFromAddress(targetToken),
        targetTokenAddress: targetToken,
        swapAddress,
        exchanges,
        exchangeAddress: exchanges[0] || null,
        exchangeLabels: {},
        swap: null,
        targetToken: null,
        targetDecimals: 18,
        positionDuration: 0n,
        feeBps: 0n,
        feesAccrued: 0n,
        canWithdrawFees: false,
        positions: []
      });
    }
  }

  if (!swaps.length && cfg.x2swap) {
    const targetToken = cfg.targetToken;
    if (!ethers.isAddress(targetToken) || !ethers.isAddress(cfg.x2swap)) {
      throw new Error("legacy config missing target token or swap address");
    }
    const exchanges = Array.isArray(cfg.exchanges)
      ? cfg.exchanges.filter((addr) => ethers.isAddress(addr))
      : cfg.exchange && ethers.isAddress(cfg.exchange)
        ? [cfg.exchange]
        : [];
    swaps.push({
      key: keyFromAddress(targetToken),
      symbol: symbolFromAddress(targetToken),
      targetTokenAddress: targetToken,
      swapAddress: cfg.x2swap,
      exchanges,
      exchangeAddress: exchanges[0] || null,
      exchangeLabels: {},
      swap: null,
      targetToken: null,
      targetDecimals: 18,
      positionDuration: 0n,
      feeBps: 0n,
      feesAccrued: 0n,
      canWithdrawFees: false,
      positions: []
    });
  }

  if (!swaps.length && cfg.x2deployer && cfg.targetToken) {
    const provider = cfg.rpcUrl
      ? new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId ?? undefined)
      : window.ethereum
        ? new ethers.BrowserProvider(window.ethereum)
        : null;
    if (!provider) throw new Error("No provider: set rpcUrl in deployment.json or install MetaMask");
    const deployer = new ethers.Contract(cfg.x2deployer, deployerAbi, provider);
    const swapAddress = await deployer.swaps(cfg.targetToken);
    if (!swapAddress || swapAddress === ethers.ZeroAddress) throw new Error("x2swap missing");
    const exchanges = Array.isArray(cfg.exchanges)
      ? cfg.exchanges.filter((addr) => ethers.isAddress(addr))
      : cfg.exchange && ethers.isAddress(cfg.exchange)
        ? [cfg.exchange]
        : [];
    swaps.push({
      key: keyFromAddress(cfg.targetToken),
      symbol: symbolFromAddress(cfg.targetToken),
      targetTokenAddress: cfg.targetToken,
      swapAddress,
      exchanges,
      exchangeAddress: exchanges[0] || null,
      exchangeLabels: {},
      swap: null,
      targetToken: null,
      targetDecimals: 18,
      positionDuration: 0n,
      feeBps: 0n,
      feesAccrued: 0n,
      canWithdrawFees: false,
      positions: []
    });
  }

  if (!swaps.length) throw new Error("x2swap targets missing");
  state.swaps = swaps;

  if (cfg.asset && ethers.isAddress(cfg.asset)) {
    state.assetAddress = cfg.asset;
  }

  renderX2SwapBlocks();
  showApp();
}

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

  let poolAddr = null;
  for (const swapState of state.swaps) {
    swapState.swap = new ethers.Contract(swapState.swapAddress, swapAbi, state.signer);
    try {
      const currentPool = await swapState.swap.pool();
      const feeGovAddr = await swapState.swap.feeGovernance();
      const assetAddr = await swapState.swap.asset();
      const targetAddr = await swapState.swap.targetToken();
      const duration = await swapState.swap.positionDuration();
      const feeBps = await swapState.swap.feeBps();

      if (!poolAddr) poolAddr = currentPool;
      state.assetAddress = assetAddr;

      swapState.targetTokenAddress = targetAddr;
      swapState.positionDuration = duration;
      swapState.feeBps = feeBps;

      if (!state.feeGovernanceAddress) {
        state.feeGovernanceAddress = feeGovAddr;
        state.feeGovernance = feeGovAddr && feeGovAddr !== ethers.ZeroAddress
          ? new ethers.Contract(feeGovAddr, feeGovAbi, state.provider)
          : null;
      }

      swapState.targetToken = new ethers.Contract(targetAddr, erc20Abi, state.provider);
      swapState.targetDecimals = await swapState.targetToken.decimals();
      setText(swapEl(swapState, "positionDuration"), `${Number(duration) / 86400} days`);
      setText(swapEl(swapState, "feeBps"), `${(Number(feeBps) / 100).toFixed(2)}%`);
    } catch (e) {
      console.error("Swap fetch failed", swapState.swapAddress, e);
    }

    await loadExchangeProviders(swapState);
    renderExchangeSelect(swapState);
    updatePositionState(swapState);
  }

  if (poolAddr) {
    state.vaultAddress = poolAddr;
    state.vault = new ethers.Contract(poolAddr, vaultAbi, state.signer);
    state.assetAddress = await state.vault.asset();
    state.shareDecimals = await state.vault.decimals();
    try {
      const shareSymbol = await state.vault.symbol();
      setShareLabel(shareSymbol || "Pool Token");
    } catch (e) {
      console.error("Pool symbol fetch failed", e);
      setShareLabel("Pool Token");
    }
  }

  state.asset = new ethers.Contract(state.assetAddress, erc20Abi, state.provider);
  try {
    state.assetDecimals = await state.asset.decimals();
  } catch (e) {
    console.error(e);
    state.assetDecimals = 6;
  }

  $("addr").textContent = short(state.addr);
  await refreshBalances();
  await refreshAllowance();
  await refreshPoolInfo();
  await refreshAllPositions();

  setStatus("Connected");
  setConnStatus("Connected to Hardhat fork (chainId 31337)");
  setPoolStatus("Connected");
  updateSwapState();
  updateSwapUsdcState();
  updatePoolState();
  state.swaps.forEach((s) => {
    updatePositionState(s);
    updateFeesState(s);
  });
}

async function refreshBalances() {
  if (!state.signer) return;
  const ethBal = await state.provider.getBalance(state.addr);
  setText($("ethBal"), ethers.formatEther(ethBal));

  if (state.asset) {
    const assetBal = await state.asset.balanceOf(state.addr);
    const display = Number(ethers.formatUnits(assetBal, state.assetDecimals));
    setText($("usdcBal"), display.toFixed(2));
  }

  if (state.vault) {
    try {
      const shareBal = await state.vault.balanceOf(state.addr);
      const display = Number(ethers.formatUnits(shareBal, state.shareDecimals));
      setText($("lpBal"), display.toFixed(4));
    } catch (e) {
      console.error(e);
      setText($("lpBal"), "?");
    }
  } else {
    setText($("lpBal"), "(no vault)");
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
      setApprovalText(Number(ethers.formatUnits(allowance, state.assetDecimals)).toFixed(2));
    } else {
      setApprovalText("–");
    }

    const routerAllowance = await state.asset.allowance(state.addr, UNISWAP_V2_ROUTER);
    state.routerAllowance = routerAllowance;
    setRouterApprovalText(Number(ethers.formatUnits(routerAllowance, state.assetDecimals)).toFixed(2));
  } catch (e) {
    console.error(e);
    setApprovalText("?");
    setRouterApprovalText("?");
  }
}

async function refreshPoolInfo() {
  if (!state.vault) {
    state.swaps.forEach((swapState) => {
      setText(swapEl(swapState, "poolAvailable"), "–");
      setText(swapEl(swapState, "poolAssets"), "–");
      setText(swapEl(swapState, "poolDebt"), "–");
      setText(swapEl(swapState, "feeBps"), "–");
      setText(swapEl(swapState, "feesAccrued"), "–");
      setText(swapEl(swapState, "feesAuth"), "–");
    });
    return;
  }

  try {
    const assets = await state.asset.balanceOf(state.vaultAddress);
    const debt = await state.vault.totalDebt();
    state.poolAvailable = assets;
    const totalWithDebt = assets + debt;

    for (const swapState of state.swaps) {
      setText(swapEl(swapState, "poolAssets"), ethers.formatUnits(totalWithDebt, state.assetDecimals));
      setText(swapEl(swapState, "poolAvailable"), ethers.formatUnits(assets, state.assetDecimals));
      setText(swapEl(swapState, "poolDebt"), ethers.formatUnits(debt, state.assetDecimals));

      if (swapState.swap) {
        const feeBps = await swapState.swap.feeBps();
        const feesAccrued = await swapState.swap.feesAccrued();
        swapState.feeBps = feeBps;
        swapState.feesAccrued = feesAccrued;
        setText(swapEl(swapState, "feeBps"), `${(Number(feeBps) / 100).toFixed(2)}%`);
        setText(swapEl(swapState, "feesAccrued"), ethers.formatUnits(feesAccrued, state.assetDecimals));

        let canWithdraw = false;
        if (state.addr && state.feeGovernance) {
          canWithdraw = await state.feeGovernance.isWithdrawer(state.addr);
        }
        swapState.canWithdrawFees = canWithdraw;
        setText(swapEl(swapState, "feesAuth"), canWithdraw ? "You can withdraw fees." : "You are not authorized to withdraw fees.");

        const feesTo = swapEl(swapState, "feesTo");
        if (feesTo && !feesTo.value && state.addr) feesTo.value = state.addr;
        updateFeesState(swapState);
      }
    }
  } catch (e) {
    console.error(e);
    state.swaps.forEach((swapState) => {
      setText(swapEl(swapState, "poolAvailable"), "?");
      setText(swapEl(swapState, "poolAssets"), "?");
      setText(swapEl(swapState, "poolDebt"), "?");
      setText(swapEl(swapState, "feeBps"), "?");
      setText(swapEl(swapState, "feesAccrued"), "?");
      setText(swapEl(swapState, "feesAuth"), "?");
    });
  }
}

async function refreshPositions(swapState) {
  if (!swapState.swap || !state.addr) {
    swapState.positions = [];
    renderPositions(swapState);
    return;
  }
  try {
    const ids = await swapState.swap.getUserPositions(state.addr);
    const fetched = [];
    for (const id of ids) {
      try {
        const pos = await swapState.swap.positions(id);
        fetched.push({
          id: Number(pos[0]),
          sender: pos[1],
          openAssetAmount: pos[2],
          targetAmount: pos[3],
          openDate: pos[4],
          expireDate: pos[5],
          profitSharing: pos[6],
          closeDate: pos[7],
          closeAssetAmount: pos[8]
        });
      } catch (e) {
        console.error("Position fetch failed", e);
      }
    }
    swapState.positions = fetched;
    renderPositions(swapState);
  } catch (e) {
    console.error("Positions fetch failed", e);
    swapState.positions = [];
    renderPositions(swapState);
  }
}

async function refreshAllPositions() {
  await Promise.all(state.swaps.map((swapState) => refreshPositions(swapState)));
}

async function quote() {
  const val = $("amount")?.value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    setText($("quote"), "–");
    updateSwapState();
    return;
  }
  if (!state.router) return;
  try {
    const amountInWei = ethers.parseEther(val.toString());
    const amounts = await state.router.getAmountsOut(amountInWei, [WETH, state.assetAddress]);
    setText($("quote"), `${ethers.formatUnits(amounts[1], state.assetDecimals)} asset`);
  } catch (err) {
    console.error(err);
    setText($("quote"), "Error");
  }
  updateSwapState();
}

async function quoteUsdc() {
  const val = $("amountUsdc")?.value;
  if (!val || isNaN(val) || Number(val) <= 0) {
    setText($("quoteUsdc"), "–");
    updateSwapUsdcState();
    return;
  }
  if (!state.router) return;
  try {
    const amountIn = ethers.parseUnits(val.toString(), state.assetDecimals);
    const amounts = await state.router.getAmountsOut(amountIn, [state.assetAddress, WETH]);
    setText($("quoteUsdc"), `${ethers.formatEther(amounts[1])} ETH`);
  } catch (err) {
    console.error(err);
    setText($("quoteUsdc"), "Error");
  }
  updateSwapUsdcState();
}

async function quotePosition(swapState) {
  const val = swapEl(swapState, "positionAmount")?.value;
  if (!val || isNaN(val) || Number(val) <= 0 || !swapState.swap || !swapState.exchangeAddress) {
    setText(swapEl(swapState, "positionQuote"), "–");
    setText(swapEl(swapState, "positionBorrow"), "–");
    setText(swapEl(swapState, "positionFee"), "–");
    setText(swapEl(swapState, "positionSwapIn"), "–");
    setText(swapEl(swapState, "positionRate"), "–");
    return;
  }

  try {
    const amountIn = ethers.parseUnits(val.toString(), state.assetDecimals);
    const preview = await swapState.swap.previewNewPosition(
      amountIn,
      DEFAULT_MAX_DEVIATION_BPS,
      swapState.exchangeAddress,
      getOpenPath(swapState, swapState.exchangeAddress)
    );
    const openFee = preview[0];
    const net = preview[1];
    const totalSwapIn = preview[2];
    const out = preview[3];
    const outFormatted = ethers.formatUnits(out, swapState.targetDecimals || 18);

    setText(swapEl(swapState, "positionQuote"), outFormatted);
    setText(swapEl(swapState, "positionBorrow"), ethers.formatUnits(net, state.assetDecimals));
    setText(swapEl(swapState, "positionFee"), ethers.formatUnits(openFee, state.assetDecimals));
    setText(swapEl(swapState, "positionSwapIn"), ethers.formatUnits(totalSwapIn, state.assetDecimals));

    const rate = Number(ethers.formatUnits(totalSwapIn, state.assetDecimals)) / Math.max(Number(outFormatted || "0"), 1e-12);
    setText(swapEl(swapState, "positionRate"), `${rate.toFixed(6)} asset/target`);
  } catch (e) {
    console.error(e);
    setText(swapEl(swapState, "positionQuote"), "Error");
    setText(swapEl(swapState, "positionBorrow"), "Error");
    setText(swapEl(swapState, "positionFee"), "Error");
    setText(swapEl(swapState, "positionSwapIn"), "Error");
    setText(swapEl(swapState, "positionRate"), "Error");
  }
}

async function ensureVaultApproval(amount) {
  try {
    const current = await state.asset.allowance(state.addr, state.vaultAddress);
    if (current >= amount) return true;
    setPoolStatus("Approving vault...");
    const tx = await state.asset.connect(state.signer).approve(state.vaultAddress, ethers.MaxUint256);
    setPoolStatus(`Pending… ${tx.hash}`);
    await tx.wait();
    await refreshAllowance();
    return true;
  } catch (e) {
    console.error(e);
    setPoolStatus(e.reason || e.message || "Pool approve failed");
    return false;
  }
}

async function ensureSwapApproval(swapState, amount) {
  try {
    const current = await state.asset.allowance(state.addr, swapState.swapAddress);
    if (current >= amount) return true;
    setHtml(swapEl(swapState, "positionStatus"), "Approving X2Swap...");
    const tx = await state.asset.connect(state.signer).approve(swapState.swapAddress, ethers.MaxUint256);
    setHtml(swapEl(swapState, "positionStatus"), `Pending… ${tx.hash}`);
    await tx.wait();
    await refreshAllowance();
    return true;
  } catch (e) {
    console.error(e);
    setHtml(swapEl(swapState, "positionStatus"), e.reason || e.message || "Swap approve failed");
    return false;
  }
}

async function swap() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  const val = $("amount")?.value;
  if (!val || isNaN(val) || Number(val) <= 0) return setStatus("Enter an amount");

  const amountInWei = ethers.parseEther(val.toString());
  let minOut;
  try {
    const amounts = await state.router.getAmountsOut(amountInWei, [WETH, state.assetAddress]);
    minOut = (amounts[1] * 99n) / 100n;
  } catch (e) {
    console.error(e);
    return setStatus("Quote failed");
  }

  try {
    setStatus("Sending swap…");
    const tx = await state.router.swapExactETHForTokens(
      minOut,
      [WETH, state.assetAddress],
      state.addr,
      Math.floor(Date.now() / 1000) + 600,
      { value: amountInWei, gasLimit: 700000n }
    );
    setStatus(`Pending… ${tx.hash}`);
    await tx.wait();
    setStatus("Swap confirmed");
    await refreshBalances();
    await quote();
  } catch (e) {
    console.error(e);
    setStatus(e.message || "Swap failed");
  }
}

async function swapUsdc() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  const val = $("amountUsdc")?.value;
  if (!val || isNaN(val) || Number(val) <= 0) return setSwapUsdcStatus("Enter an amount");

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
    minOut = (amounts[1] * 99n) / 100n;
  } catch (e) {
    console.error(e);
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
      Math.floor(Date.now() / 1000) + 600,
      { gasLimit: 700000n }
    );
    setSwapUsdcStatus(`Pending… ${tx.hash}`);
    await tx.wait();
    setSwapUsdcStatus("Swap confirmed");
    await refreshBalances();
    await quoteUsdc();
    await refreshAllowance();
    updateSwapUsdcState();
  } catch (e) {
    console.error(e);
    setSwapUsdcStatus(e.message || "Swap failed");
  }
}

async function approveRouter() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }

  try {
    setSwapUsdcStatus("Approving router...");
    const tx = await state.asset.connect(state.signer).approve(UNISWAP_V2_ROUTER, ethers.MaxUint256);
    setSwapUsdcStatus(`Pending… ${tx.hash}`);
    await tx.wait();
    setSwapUsdcStatus("Router approved");
    await refreshAllowance();
    updateSwapUsdcState();
  } catch (e) {
    console.error(e);
    setSwapUsdcStatus(e.reason || e.message || "Router approve failed");
  }
}

async function depositPool() {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!state.vault) return setPoolStatus("Pool not configured");

  const val = $("depositAmount")?.value;
  if (!val || isNaN(val) || Number(val) <= 0) return setPoolStatus("Enter deposit amount");

  let amount;
  try {
    amount = ethers.parseUnits(val.toString(), state.assetDecimals);
  } catch (e) {
    console.error(e);
    return setPoolStatus("Invalid amount");
  }

  const ok = await ensureVaultApproval(amount);
  if (!ok) return;

  try {
    setPoolStatus("Depositing...");
    const tx = await state.vault.deposit(amount, state.addr, { gasLimit: 700000n });
    setPoolStatus(`Pending… ${tx.hash}`);
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
  if (!state.vault) return setPoolStatus("Pool not configured");

  const val = $("withdrawAmount")?.value;
  if (!val || isNaN(val) || Number(val) <= 0) return setPoolStatus("Enter withdraw amount");

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
    setPoolStatus(`Pending… ${tx.hash}`);
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

async function openPosition(swapState) {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!swapState.swap) return setHtml(swapEl(swapState, "positionStatus"), "Swap not configured");
  if (!swapState.exchangeAddress) return setHtml(swapEl(swapState, "positionStatus"), "Exchange not configured");

  const val = swapEl(swapState, "positionAmount")?.value;
  if (!val || isNaN(val) || Number(val) <= 0) return setHtml(swapEl(swapState, "positionStatus"), "Enter position amount");

  let amount;
  try {
    amount = ethers.parseUnits(val.toString(), state.assetDecimals);
  } catch (e) {
    console.error(e);
    return setHtml(swapEl(swapState, "positionStatus"), "Invalid amount");
  }

  const openFee = (amount * (swapState.feeBps || 0n)) / 10_000n;
  const net = amount - openFee;
  if (state.poolAvailable && net > state.poolAvailable) {
    return setHtml(swapEl(swapState, "positionStatus"), "Insufficient pool liquidity");
  }

  const ok = await ensureSwapApproval(swapState, amount);
  if (!ok) return;

  const path = getOpenPath(swapState, swapState.exchangeAddress);

  try {
    setHtml(swapEl(swapState, "positionStatus"), "Opening position...");
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const tx = await swapState.swap.openPosition(
      amount,
      DEFAULT_MAX_DEVIATION_BPS,
      swapState.exchangeAddress,
      path,
      deadline,
      { gasLimit: 900000n }
    );
    setHtml(swapEl(swapState, "positionStatus"), `Pending… ${tx.hash}`);
    await tx.wait();
    setHtml(swapEl(swapState, "positionStatus"), "Position opened");
    await refreshBalances();
    await refreshAllowance();
    await refreshPoolInfo();
    await refreshPositions(swapState);
  } catch (e) {
    console.error(e);
    setHtml(swapEl(swapState, "positionStatus"), e.reason || e.message || "Open position failed");
  }
}

async function handleClosePosition(swapState, id) {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!swapState.swap) return setHtml(swapEl(swapState, "positionsStatus"), "Swap not loaded");
  if (!swapState.exchangeAddress) return setHtml(swapEl(swapState, "positionsStatus"), "Exchange not configured");

  try {
    setHtml(swapEl(swapState, "positionsStatus"), `Closing #${id}...`);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const tx = await swapState.swap.closePosition(
      id,
      DEFAULT_MAX_DEVIATION_BPS,
      swapState.exchangeAddress,
      getClosePath(swapState, swapState.exchangeAddress),
      deadline,
      { gasLimit: 900000n }
    );
    setHtml(swapEl(swapState, "positionsStatus"), `Pending… ${tx.hash}`);
    await tx.wait();
    setHtml(swapEl(swapState, "positionsStatus"), "Closed");
    await refreshBalances();
    await refreshPoolInfo();
    await refreshPositions(swapState);
  } catch (e) {
    console.error(e);
    setHtml(swapEl(swapState, "positionsStatus"), e.reason || e.message || "Close failed");
  }
}

async function withdrawFees(swapState) {
  if (!state.signer) {
    await connect();
    if (!state.signer) return;
  }
  if (!swapState.swap) return setHtml(swapEl(swapState, "feesStatus"), "Swap not loaded");
  if (!swapState.canWithdrawFees) return setHtml(swapEl(swapState, "feesStatus"), "Not authorized");

  const to = swapEl(swapState, "feesTo")?.value?.trim();
  if (!to || !ethers.isAddress(to)) return setHtml(swapEl(swapState, "feesStatus"), "Enter valid recipient");

  const amountVal = swapEl(swapState, "feesAmount")?.value?.trim();
  if (!amountVal || Number(amountVal) <= 0) return setHtml(swapEl(swapState, "feesStatus"), "Enter amount");

  let amount;
  try {
    amount = ethers.parseUnits(amountVal.toString(), state.assetDecimals);
  } catch (e) {
    console.error(e);
    return setHtml(swapEl(swapState, "feesStatus"), "Invalid amount");
  }

  try {
    setHtml(swapEl(swapState, "feesStatus"), "Withdrawing...");
    const tx = await swapState.swap.withdrawFees(to, amount, { gasLimit: 500000n });
    setHtml(swapEl(swapState, "feesStatus"), `Pending… ${tx.hash}`);
    await tx.wait();
    setHtml(swapEl(swapState, "feesStatus"), "Withdrawn");
    await refreshBalances();
    await refreshPoolInfo();
  } catch (e) {
    console.error(e);
    setHtml(swapEl(swapState, "feesStatus"), e.reason || e.message || "Withdraw failed");
  }
}

$("connectBtn").onclick = connect;
$("swapBtn").onclick = swap;
$("amount").oninput = quote;
$("amountUsdc").oninput = () => {
  quoteUsdc();
  updateSwapUsdcState();
};
$("swapUsdcBtn").onclick = swapUsdc;
$("routerApproveBtn").onclick = approveRouter;
$("depositBtn").onclick = depositPool;
$("withdrawBtn").onclick = withdrawPool;
$("depositAmount").oninput = updatePoolState;
$("withdrawAmount").oninput = updatePoolState;

setLoading("Loading config…");
loadConfig().catch((err) => {
  console.warn("Config load failed:", err.message);
  if (err?.message === "config not found") {
    setLoading("Config not found. Ensure /data/deployment.json exists.");
  } else {
    setLoading(`Config error: ${err?.message || "load failed"}`);
  }
});
