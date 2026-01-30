# X2Swap Protocol

![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Hardhat](https://img.shields.io/badge/Hardhat-2.22.4-yellow)

**X2Swap** is a liquidation-free leveraged swap protocol that enables users to take 2x leveraged positions on cryptocurrency pairs without the risk of liquidation. The protocol uses a dynamic profit-sharing model based on pool utilization and integrates with major DEXes like Uniswap V2 and V3.

## 🚀 Key Features

- **2x Leverage Without Liquidation**: Open leveraged positions with time-based expiration
- **Dynamic Profit Sharing**: Utilization-based profit distribution between users and liquidity providers
- **ERC-4626 Compliant Pool**: Standard-compliant liquidity pool implementation
- **Multi-DEX Integration**: Support for Uniswap V2 and V3 exchanges
- **Oracle-Based Validation**: Chainlink-style price oracle integration with staleness checks
- **Emergency Pause System**: Governance-controlled emergency pause mechanism
- **Multi-Sig Governance**: 3-of-5 multi-signature governance for critical operations
- **Fee on Close**: Protocol fees charged only when closing positions (from borrower's share)

## 📋 Table of Contents

- [Architecture](#architecture)
- [Smart Contracts](#smart-contracts)
- [Installation](#installation)
- [Usage](#usage)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Documentation](#documentation)
- [License](#license)

## 🏗 Architecture

The protocol consists of several interconnected smart contracts:

```
┌─────────────┐
│   X2Swap    │  Main position management
│             │  - Open/close positions
│             │  - Oracle validation
│             │  - Emergency pause
└──────┬──────┘
       │
       ├──────────────┬──────────────┬──────────────┐
       │              │              │              │
┌──────▼──────┐ ┌────▼─────┐  ┌─────▼──────┐ ┌────▼────────┐
│   X2Pool    │ │   Fee    │  │  Price     │ │  Exchange   │
│  (ERC-4626) │ │Governance│  │  Oracle    │ │  Adapters   │
│             │ │          │  │            │ │             │
│ - Deposits  │ │ - Multi- │  │ - Price    │ │ - UniswapV2 │
│ - Withdraws │ │   sig    │  │   feeds    │ │ - UniswapV3 │
│ - Borrows   │ │ - 3-of-5 │  │ - Staleness│ │             │
└─────────────┘ └──────────┘  └────────────┘ └─────────────┘
```

## 📜 Smart Contracts

### Core Contracts

| Contract | Description | Key Functions |
|----------|-------------|---------------|
| **X2Swap.sol** | Main position management contract | `openPosition()`, `closePosition()`, `liquidate()` |
| **X2Pool.sol** | ERC-4626 liquidity pool | `deposit()`, `withdraw()`, `borrow()`, `repay()` |
| **FeeGovernance.sol** | Multi-sig governance for fee management | `proposeFeeChange()`, `approveFeeChange()` |
| **X2Deployer.sol** | Factory contract for deploying new pairs | `deployPair()` |

### Exchange Adapters

| Contract | Description |
|----------|-------------|
| **X2UniswapV2Exchange.sol** | Adapter for Uniswap V2-style DEXes |
| **X2UniswapV3Exchange.sol** | Adapter for Uniswap V3 with concentrated liquidity |

### Interfaces & Utilities

- **IExchange.sol** - Interface for exchange adapters
- **IPriceOracle.sol** - Oracle interface (Chainlink-compatible)
- **IERC20Extended.sol** - Extended ERC20 interface with decimals
- **Position.sol** - Position struct definition

## 🎯 Supported Asset Pairs

### Recommended Configuration

X2Swap is optimized for pairs with the following structure:

```
asset (stablecoin) ↔ targetToken (volatile asset) + Chainlink Oracle
```

**Example Pairs:**
- USDC → WETH (using ETH/USD Chainlink feed)
- USDT → WBTC (using BTC/USD Chainlink feed)
- DAI → LINK (using LINK/USD Chainlink feed)

### Requirements

| Component | Requirement | Example |
|-----------|-------------|---------|
| **asset** | Stablecoin or base currency | USDC, USDT, DAI |
| **targetToken** | Volatile crypto asset | WETH, WBTC, LINK |
| **priceOracle** | Chainlink price feed (targetToken/USD) | ETH/USD feed |

**📖 For detailed integration guide, see [CHAINLINK_INTEGRATION.md](./CHAINLINK_INTEGRATION.md)**

## 🛠 Installation

### Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- Git

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/yourusername/x2swap.git
cd x2swap/2x-swap

# Install dependencies
npm install
# or
yarn install
```

### Environment Setup

Create a `.env` file in the root directory:

```env
# Network RPC URLs
MAINNET_RPC_URL=your_mainnet_rpc_url
TESTNET_RPC_URL=your_testnet_rpc_url

# Private keys (for deployment)
DEPLOYER_PRIVATE_KEY=your_private_key

# Etherscan API key (for verification)
ETHERSCAN_API_KEY=your_etherscan_api_key
```

## 💻 Usage

### Compile Contracts

```bash
npm run compile
# or
npx hardhat compile
```

### Run Local Node

```bash
npm run node
# or
npx hardhat node
```

### Deploy Contracts

```bash
# Deploy to local network
npm run deploy

# Deploy to specific network
npx hardhat run scripts/deploy.js --network <network-name>
```

## 🧪 Testing

The protocol includes comprehensive test coverage across multiple test suites:

### Run All Tests

```bash
npm test
# or
npx hardhat test
```

### Test Suites

| Test Suite | Description | Coverage |
|------------|-------------|----------|
| **x2swap.test.js** | Core functionality tests | Position management, fees, profit sharing |
| **exchange-integration.test.js** | DEX integration tests | Uniswap V2/V3 swaps |
| **pool-additional.test.js** | Pool functionality tests | Deposits, withdrawals, borrows |
| **fee-governance.test.js** | Governance tests | Multi-sig operations |
| **audit-fixes-critical.test.js** | Critical security fixes | Reentrancy, oracle manipulation |
| **audit-fixes-high.test.js** | High severity fixes | Price validation, slippage |
| **audit-fixes-medium.test.js** | Medium severity fixes | Edge cases, limits |
| **audit-fixes-low.test.js** | Low severity fixes | Gas optimizations |

### Run Specific Test

```bash
npx hardhat test test/x2swap.test.js
```

### Coverage Report

```bash
npx hardhat coverage
```

## 🚀 Deployment

### Deployment Script

The deployment script (`scripts/deploy.js`) deploys all contracts in the correct order:

1. Mock tokens (for testing)
2. Price oracle
3. Fee governance (with governors)
4. Liquidity pool
5. Exchange adapters
6. X2Swap main contract

### Deploy to Testnet

```bash
npx hardhat run scripts/deploy.js --network goerli
# or
npx hardhat run scripts/deploy.js --network sepolia
```

### Verify Contracts

```bash
npx hardhat verify --network <network> <contract-address> <constructor-args>
```

## 🔒 Security

### Audit Status

The protocol has undergone a comprehensive security audit. See [SECURITY_AUDIT_REPORT.md](../SECURITY_AUDIT_REPORT.md) for details.

**Findings:**
- ✅ All critical issues resolved
- ✅ All high severity issues resolved
- ✅ All medium severity issues resolved
- ✅ All low severity issues resolved

### Security Features

1. **Reentrancy Protection**: All external calls protected with `ReentrancyGuard`
2. **Oracle Validation**: Price staleness checks (max 1 hour)
3. **Rate Limiting**: Minimum time between positions per user (60 seconds)
4. **Emergency Pause**: Governance-controlled emergency pause
5. **Position Limits**: Maximum position sizes and total exposure limits
6. **Multi-Sig Governance**: 3-of-5 signature requirement for critical operations

### Fee Structure

- **Opening Fee**: None - users pay exactly the collateral amount
- **Closing Fee**: Charged from borrower's gross share (not just profit)
- **Fee Rate**: Configurable via governance (default 1%)
- **Pool Protection**: Pool's share is never subject to fees

### Known Limitations

- Position duration is fixed at deployment
- Only 2x leverage is supported
- Limited to two-token pairs (asset ↔ target)

## 📚 Documentation

### Additional Documentation

- **CHAINLINK_INTEGRATION.md** - Chainlink oracle integration guide ⭐ **NEW**

- [CHANGELOG.md](CHANGELOG.md) - Version history and changes
- [TESTING_GUIDE.md](TESTING_GUIDE.md) - Detailed testing instructions
- [TEST_SUMMARY.md](TEST_SUMMARY.md) - Test results and coverage
- [AUDIT_FIXES_APPLIED.md](AUDIT_FIXES_APPLIED.md) - Applied security fixes

### Key Concepts

#### Position Lifecycle

1. **Open Position**: User deposits collateral (no fee), protocol borrows from pool, executes 2x swap
2. **Active Period**: Position remains open until expiration date
3. **Close Position**: User closes position before expiration, swap reversed, fee charged from borrower's share
4. **Close by Anyone**: After expiration, anyone can close the position

#### Profit Sharing Model

Profit sharing is dynamic based on pool utilization:

```
Utilization < 50%: 20% to pool, 80% to user
Utilization 50-80%: Linear scaling 20% → 70%
Utilization > 80%: 70% to pool, 30% to user
```

#### Oracle Integration

The protocol uses Chainlink-style oracles with:
- Price deviation limits (±5%)
- Staleness checks (max 1 hour for normal operations)
- Multiple price validation points

## 🌐 Web Interface

A simple web interface is included in the `web/` directory:

```bash
# Serve locally
cd web
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000` in your browser.

## 🔧 Configuration

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ORACLE_MAX_STALENESS` | 3600s | Maximum oracle age for operations |
| `MAX_POSITION_SIZE_BPS` | 10000 (100%) | Maximum single position size |
| `MAX_TOTAL_POSITIONS_BPS` | 9500 (95%) | Maximum total exposure |
| `MIN_POSITION_INTERVAL` | 60s | Minimum time between positions |
| `feeBps` | 100 (1%) | Closing fee rate (governance-controlled) |

### Hardhat Configuration

Edit `hardhat.config.js` to customize:
- Network configurations
- Compiler settings
- Gas reporter options
- Solidity coverage settings
