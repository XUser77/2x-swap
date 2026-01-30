# Chainlink Oracle Integration Guide

**Last Updated:** January 16, 2026  
**Version:** 1.1.0

## Overview

X2Swap is designed to work with **Chainlink Price Feeds** for secure, manipulation-resistant price validation. This document explains how to properly configure asset pairs with Chainlink oracles.

## Supported Pair Architecture

### Recommended Configuration

X2Swap works best with the following pair structure:

```
asset (stablecoin) ↔ targetToken (volatile asset)
```

- **asset** = Stablecoin or base currency (USDC, USDT, DAI)
- **targetToken** = Volatile crypto asset (WETH, WBTC, LINK, etc.)
- **priceOracle** = Chainlink price feed for `targetToken/USD`

### Why This Structure?

1. **Oracle Availability**: Chainlink provides robust USD price feeds for major crypto assets
2. **Price Stability**: Asset (stablecoin) ≈ $1, simplifies calculations
3. **Liquidity**: Most DEX liquidity is in stablecoin pairs
4. **User Experience**: Users think in USD terms

## Chainlink Price Feeds

### Mainnet Addresses (Ethereum)

| Pair | Chainlink Feed | Address | Decimals |
|------|---------------|---------|----------|
| **ETH/USD** | ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 8 |
| **BTC/USD** | BTC/USD | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | 8 |
| **LINK/USD** | LINK/USD | `0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c` | 8 |
| **UNI/USD** | UNI/USD | `0x553303d460EE0afB37EdFf9bE42922D8FF63220e` | 8 |
| **MATIC/USD** | MATIC/USD | `0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676` | 8 |
| **AAVE/USD** | AAVE/USD | `0x547a514d5e3769680Ce22B2361c10Ea13619e8a9` | 8 |

**Note:** Chainlink typically uses **8 decimals** for price feeds.

Full list: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum

### How Decimals Work

#### Example: USDC → WETH with ETH/USD Feed

```solidity
// Tokens
USDC: 6 decimals
WETH: 18 decimals

// Chainlink ETH/USD feed
Decimals: 8
Price: 3000_00000000 ($3000.00)

// X2Swap adjusts to asset decimals (USDC = 6)
Adjusted Price: 3000_00000000 / 100 = 3000_000000 (6 decimals)

// Opening position: 1000 USDC → WETH
Expected WETH: (1000e6 * 1e18) / 3000e6 = 0.333... WETH
```

## Deployment Examples

### Example 1: USDC → WETH

```solidity
// Deploy USDC/WETH pair with 2x leverage
const deployment = await X2Deployer.deploy(
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC (asset)
    ["0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"],   // Uniswap V2
    0,                                                  // feeBps (0 = no fee)
    30 * 24 * 60 * 60,                                 // 30 days
    [deployer, gov1, gov2],                            // governance
    [
        [
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH (targetToken)
            "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"  // ETH/USD Chainlink
        ]
    ]
);
```

### Example 2: USDT → WBTC

```solidity
const deployment = await X2Deployer.deploy(
    "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT (asset)
    [uniswapV2Exchange],
    0,
    30 * 24 * 60 * 60,
    [deployer, gov1, gov2],
    [
        [
            "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC (targetToken)
            "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c"  // BTC/USD Chainlink
        ]
    ]
);
```

### Example 3: DAI → LINK

```solidity
const deployment = await X2Deployer.deploy(
    "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI (asset)
    [uniswapV2Exchange],
    0,
    30 * 24 * 60 * 60,
    [deployer, gov1, gov2],
    [
        [
            "0x514910771AF9Ca656af840dff83E8264EcF986CA", // LINK (targetToken)
            "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c"  // LINK/USD Chainlink
        ]
    ]
);
```

## Oracle Validation

X2Swap performs comprehensive oracle validation:

### Constructor Validation

```solidity
// Checks performed during deployment
1. Oracle decimals are reasonable (1-18)
2. Oracle is responsive (initial price check)
3. Initial price is positive
```

### Runtime Validation

```solidity
// Checks on every position open/close
1. Price is positive
2. Data is fresh (answeredInRound >= roundId)
3. Update timestamp exists
4. Staleness < ORACLE_MAX_STALENESS (1 hour)
5. Price doesn't overflow int192
```

### Auto-Pause Triggers

```solidity
// Critical conditions trigger automatic pause
1. Oracle staleness > 2 hours (ORACLE_MAX_STALENESS * 2)
2. Extreme slippage > 30%
3. Price crash > 70%
4. Catastrophic loss > 60%
```

## Price Deviation Limits

Users can specify maximum acceptable deviation from oracle price:

```solidity
// Opening position with 5% max deviation
await swap.openPosition(
    amount,
    500,              // maxDeviationBps (5%)
    exchange,
    path,
    deadline
);

// Protocol maximum deviation
ORACLE_MAX_DEVIATION_BPS = 500 (5%)
```

## Unsupported Configurations

### ❌ Volatile → Volatile Pairs

```solidity
// NOT RECOMMENDED: WETH → WBTC
asset = WETH
targetToken = WBTC
priceOracle = ??? (Would need BTC/ETH composite)
```

**Problem:** Chainlink provides BTC/USD and ETH/USD, not BTC/ETH directly.

**Solution:** Use composite oracle (BTC/USD ÷ ETH/USD) - requires custom implementation.

### ❌ Asset Without USD Peg

```solidity
// NOT IDEAL: WETH → USDC
asset = WETH (volatile!)
targetToken = USDC
priceOracle = ETH/USD (correct, but asset volatility is problematic)
```

**Problem:** Pool denominated in volatile asset creates complexity for LPs.

## Testing

### Local Development

For local testing, use `FakeOracle`:

```solidity
// FakeOracle derives price from Uniswap V2 pool
const oracle = await FakeOracle.deploy(
    UNISWAP_V2_ROUTER,
    USDC,  // asset
    WETH   // targetToken
);
```

**⚠️ Warning:** FakeOracle is vulnerable to flash loan attacks. **NEVER use in production!**

### Testnet

Use Chainlink testnet feeds:
- Sepolia: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1#sepolia-testnet
- Goerli: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1#goerli-testnet

## Best Practices

### 1. Always Use Stablecoin as Asset

✅ **Good:**
- USDC → WETH
- USDT → WBTC
- DAI → LINK

❌ **Avoid:**
- WETH → USDC (volatile asset)
- WBTC → WETH (needs composite oracle)

### 2. Verify Chainlink Feed Exists

Before deployment, confirm:
- Feed address is correct for your network
- Feed is actively maintained
- Feed has recent updates

### 3. Monitor Oracle Health

Set up monitoring for:
- Staleness (updates should be < 1 hour)
- Price deviation alerts
- Auto-pause events

### 4. Test Thoroughly

Before mainnet deployment:
1. Deploy to testnet with real Chainlink feeds
2. Test open/close with various market conditions
3. Verify decimal conversions
4. Test oracle staleness scenarios
5. Test auto-pause triggers

## Security Considerations

### Oracle Manipulation Resistance

Chainlink oracles are resistant to:
- ✅ Flash loan attacks
- ✅ Single DEX manipulation
- ✅ Sandwich attacks
- ✅ MEV exploitation

### Staleness Protection

X2Swap protects against stale prices:
- Normal limit: 1 hour (`ORACLE_MAX_STALENESS`)
- Critical limit: 2 hours (auto-pause trigger)
- After 2 hours: Protocol pauses automatically

### Price Deviation Protection

Every swap checks:
1. DEX price vs Oracle price (within 5% by default)
2. Prevents manipulation when DEX price diverges
3. User-configurable up to 5% max

## Troubleshooting

### "Oracle not working" Error

**Cause:** Oracle failed initial health check during deployment.

**Solutions:**
1. Verify oracle address is correct
2. Check network (mainnet vs testnet)
3. Ensure oracle is actively maintained
4. Test oracle directly: `oracle.latestRoundData()`

### "Oracle data too old" Error

**Cause:** Oracle hasn't updated in > 1 hour.

**Solutions:**
1. Wait for Chainlink update
2. Check Chainlink status page
3. If persistent, protocol will auto-pause after 2 hours

### "Oracle deviation" Error

**Cause:** DEX price differs from oracle price by > 5%.

**Solutions:**
1. Check for market manipulation
2. Wait for prices to converge
3. Adjust `maxDeviationBps` if appropriate
4. Investigate DEX liquidity issues

## Additional Resources

- [Chainlink Documentation](https://docs.chain.link/)
- [Price Feed Addresses](https://docs.chain.link/data-feeds/price-feeds/addresses)
- [X2Swap Security Audit](./SECURITY_AUDIT_REPORT.md)
- [Emergency Pause Documentation](./EMERGENCY_PAUSE_IMPLEMENTATION.md)

## Support

For questions or issues:
1. Check this documentation
2. Review test files for examples
3. Consult security audit report
4. Open GitHub issue

---

**Last Updated:** January 16, 2026  
**Maintainer:** X2Swap Core Team
