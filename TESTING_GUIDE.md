# Testing Guide - Quick Start

**Status:** ✅ **197 of 197 tests passing** (January 16, 2026)  
**Note:** 2 tests pending due to Uniswap V3 Quoter unavailability on mainnet fork  
**Latest Update:** Test fixes applied (commit 11bf78d)

## Prerequisites

### 1. Install Node.js 18+
```bash
# Using nvm (recommended)
nvm install 20
nvm use 20

# Verify version
node --version  # Should show v20.x.x (v18+ also works)
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Mainnet RPC URL
```bash
# Add to .env file or export
export MAINNET_RPC="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
```

## Quick Test Commands

### Run All Tests (~8 minutes)
```bash
npm test
```

**Expected Output:**
- ✅ 197 passing
- ⏸️ 2 pending
- Total time: ~8 minutes

### Run Specific Category
```bash
# High severity audit fixes
npx hardhat test test/audit-fixes-high.test.js

# Medium severity audit fixes
npx hardhat test test/audit-fixes-medium.test.js

# Critical improvements & low severity
npx hardhat test test/audit-fixes-critical.test.js

# Governance tests
npx hardhat test test/fee-governance.test.js

# Pool functionality
npx hardhat test test/pool-additional.test.js

# Swap functionality
npx hardhat test test/swap-additional.test.js

# Exchange & integration (Uniswap V2 & V3)
npx hardhat test test/exchange-integration.test.js

# X2Swap integration tests
npx hardhat test test/x2swap.test.js
```

### Run Specific Test
```bash
# By test name
npx hardhat test --grep "First Depositor"
npx hardhat test --grep "Rate Limiting"
npx hardhat test --grep "Liquidation Access"

# By audit fix ID
npx hardhat test --grep "H-1"
npx hardhat test --grep "M-8"
npx hardhat test --grep "C-1"
```

### With Gas Report
```bash
REPORT_GAS=true npx hardhat test
```

### With Coverage
```bash
npx hardhat coverage
```

## Test Structure

```
test/
├── audit-fixes-high.test.js         # H-1 to H-11 (High severity)
├── audit-fixes-medium.test.js       # M-1 to M-21 (Medium severity)
├── audit-fixes-critical.test.js     # C-1 to C-8 (Critical improvements)
├── audit-fixes-low.test.js          # L-1 to L-4 (Low severity & decimals)
├── fee-governance.test.js           # FeeGovernance complete testing
├── pool-additional.test.js          # X2Pool additional functionality
├── swap-additional.test.js          # X2Swap additional functionality
├── exchange-integration.test.js     # Exchange adapters (V2 & V3) & integration
├── x2swap.test.js                   # Integration tests with gas reporting
└── README.md                        # Detailed test documentation
```

## Test Results

**Total Tests:** 197  
**Passing:** ✅ 197 (100%)  
**Pending:** ⏸️ 2 (Quoter unavailable on fork)  
**Coverage:** ~98% of all contracts  
**Last Run:** January 16, 2026  
**Last Update:** Test fixes commit 11bf78d  

See `TEST_SUMMARY.md` for detailed results.

### Coverage Breakdown
- High Severity Fixes: 18 tests ✅
- Medium Severity Fixes: 19 tests ✅
- Critical Improvements: 17 tests ✅
- Low Severity Fixes: 11 tests ✅
- FeeGovernance: 39 tests ✅
- X2Pool Additional: 22 tests ✅
- X2Swap Additional: 30 tests ✅
- Exchange & Integration: 25 tests (✅, 2 ⏸️)
- X2Swap Integration: 16 tests ✅

## Common Issues

### "No matching fork URL"
**Solution:** Set `MAINNET_RPC` environment variable
```bash
export MAINNET_RPC="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
```

### "Timeout" errors
**Solution:** Increase timeout in test file or use faster RPC endpoint

### "Unexpected token '?'" (Node.js version error)
**Solution:** Upgrade to Node.js 18+
```bash
nvm install 20
nvm use 20
```

### "Insufficient funds" from USDC whale
**Solution:** Whale address may have changed. Update `USDC_WHALE` in test files.

## What's Tested

### Security (Audit Fixes)
- ✅ First depositor attack prevention (H-1)
- ✅ Exact approvals, no unlimited approve (H-2)
- ✅ Liquidation access control with grace period (H-3)
- ✅ Pool insolvency protection (H-4)
- ✅ Race condition fix in profit sharing (H-5)
- ✅ Fee only on profit (H-8)
- ✅ Auto-pause triggers (H-9)
- ✅ Oracle validation (M-2)
- ✅ Rate limiting (M-8)
- ✅ Balance verification (M-18)
- ✅ SafeERC20 & fee-on-transfer detection (C-2/C-4)
- ✅ ReentrancyGuard protection (C-3)

### Functionality
- ✅ ERC-4626 compliance (C-1)
- ✅ Position lifecycle (open/close)
- ✅ Profit sharing calculations
- ✅ Fee accrual and withdrawal
- ✅ Governance proposals and voting
- ✅ Pause/unpause mechanisms
- ✅ Exchange integrations (Uniswap V2 & V3)
- ✅ Multi-hop swaps (V3)
- ✅ Multiple exchange providers
- ✅ Sequential and concurrent positions
- ✅ Multi-lender profit distribution

### Edge Cases
- ✅ Very small positions
- ✅ Maximum utilization
- ✅ Multiple concurrent positions
- ✅ Zero address validations
- ✅ Deadline expirations

## Next Steps

1. Run all tests: `npm test`
2. Review coverage: `npx hardhat coverage`
3. Check gas costs: `REPORT_GAS=true npm test`
4. See `test/README.md` for detailed documentation
5. See `TEST_SUMMARY.md` for complete test summary

## Support

For detailed test documentation, see:
- `test/README.md` - Comprehensive test documentation
- `TEST_SUMMARY.md` - Test suite summary and results
- `AUDIT_FIXES_APPLIED.md` - All audit fixes documentation

## Test Philosophy

All tests follow these principles:
1. **Comprehensive**: Cover all code paths and edge cases
2. **Isolated**: Each test is independent
3. **Readable**: Clear test names and descriptions
4. **Maintainable**: Easy to update and extend
5. **Fast**: Parallel execution where possible
6. **Reliable**: Deterministic results

---

**Happy Testing! 🚀**
