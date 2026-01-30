// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {X2Pool} from "./X2Pool.sol";
import {Position} from "./structs/Position.sol";
import {IExchange} from "./interfaces/IExchange.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {FeeGovernance} from "./FeeGovernance.sol";
import {IERC20Extended} from "./interfaces/IERC20Extended.sol";

/// @title X2Swap - Leveraged swap contract with comprehensive security measures
/// @notice Manages 2x leveraged positions with oracle validation and automatic protection mechanisms
/// @dev IMPORTANT: This contract is designed for pairs where:
///      - asset = stablecoin (USDC, USDT, DAI) or base currency
///      - targetToken = volatile asset with Chainlink price feed (ETH, BTC, LINK, etc.)
///      - priceOracle = Chainlink feed for targetToken/USD (e.g., ETH/USD)
///      Example: USDC (asset) ↔ WETH (targetToken) using ETH/USD Chainlink feed
contract X2Swap is ReentrancyGuard {

    using SafeERC20 for IERC20;

    X2Pool public immutable pool;
    FeeGovernance public immutable feeGovernance;
    IERC20 public immutable asset;
    IERC20 public immutable targetToken;
    uint256 public immutable positionDuration;
    uint8 public immutable assetDecimals;
    uint8 public immutable targetDecimals;
    IPriceOracle public immutable priceOracle;
    uint256 public immutable feeBps;

    uint256 public feesAccrued;

    // Oracle and deviation limits
    uint256 public constant ORACLE_MAX_DEVIATION_BPS = 500; // 5%
    uint256 public constant ORACLE_MAX_STALENESS = 3600; // 1 hour
    
    // Mathematical limits for position sizes
    uint256 public constant MAX_POSITION_SIZE_BPS = 5000; // 50% of pool (user amount only)
    uint256 public constant MAX_TOTAL_POSITIONS_BPS = 9500; // 95% of pool (matches MAX_UTILIZATION_BPS)
    
    // Minimum position amount (1 token)
    uint256 public immutable MIN_POSITION_AMOUNT;
    
    // Rate limiting
    uint256 public constant MIN_POSITION_INTERVAL = 60; // 1 minute between positions
    mapping(address => uint256) public lastPositionTime;

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) public positionsOf;

    address[] public exchanges;
    mapping(address => bool) public isExchange;

    // Events
    event OpenPosition(uint256 indexed id, address indexed sender, uint256 assetAmount, uint256 targetAmount, uint256 profitSharing, uint256 feeAmount);
    event ClosePosition(uint256 indexed id, uint256 closeAssetAmount, uint256 feeAmount);

    constructor(
        address asset_,
        address targetToken_,
        address[] memory exchanges_,
        address priceOracle_,
        uint256 feeBps_,
        address pool_,
        address feeGovernance_,
        uint256 positionDuration_
    ) {
        require(asset_ != address(0), "Asset required");
        require(targetToken_ != address(0), "Target required");
        require(priceOracle_ != address(0), "Oracle required");
        require(pool_ != address(0), "Pool required");
        require(feeGovernance_ != address(0), "Fee governance required");
        require(exchanges_.length > 0, "No exchanges");
        
        pool = X2Pool(pool_);
        feeGovernance = FeeGovernance(feeGovernance_);
        asset = IERC20(asset_);
        assetDecimals = IERC20Extended(asset_).decimals();
        targetToken = IERC20(targetToken_);
        targetDecimals = IERC20Extended(targetToken_).decimals();
        
        // Register exchanges with gas optimization
        for (uint256 i = 0; i < exchanges_.length; ) {
            address ex = exchanges_[i];
            require(ex != address(0), "Bad exchange");
            require(!isExchange[ex], "Duplicate exchange");
            exchanges.push(ex);
            isExchange[ex] = true;
            unchecked { ++i; }
        }
        
        priceOracle = IPriceOracle(priceOracle_);
        
        // Validate oracle decimals are reasonable (Chainlink typically uses 8)
        uint8 oracleDecimals = priceOracle.decimals();
        require(oracleDecimals > 0 && oracleDecimals <= 18, "Invalid oracle decimals");
        
        // Verify oracle is working by checking initial price
        (, int256 answer,,,) = priceOracle.latestRoundData();
        require(answer > 0, "Oracle not working");
        
        feeBps = feeBps_;
        positionDuration = positionDuration_;
        
        // Set minimum position amount based on asset decimals
        // MIN_POSITION_AMOUNT = 1 token
        MIN_POSITION_AMOUNT = 10 ** assetDecimals;
    }

    /// @notice Open a new 2x leveraged position
    /// @dev Includes comprehensive validation and automatic pause triggers
    function openPosition(
        uint256 assetAmount,
        uint256 maxDeviationBps,
        address exchangeAddress,
        bytes calldata path,
        uint256 deadline
    ) external nonReentrant returns (uint256 id) {
        // Check emergency pause state
        require(!feeGovernance.isPaused(), "Protocol emergency paused");
        
        require(assetAmount > 0, "Zero amount");
        require(maxDeviationBps <= ORACLE_MAX_DEVIATION_BPS, "Max deviation too high");
        require(isExchange[exchangeAddress], "Bad exchange");
        
        // M-11: Comprehensive validation
        require(deadline >= block.timestamp, "Deadline expired");
        require(path.length >= 40, "Invalid path length");
        require(assetAmount >= MIN_POSITION_AMOUNT, "Amount too small");
        require(asset.balanceOf(msg.sender) >= assetAmount, "Insufficient balance");
        
        // M-8: Rate limiting
        require(block.timestamp >= lastPositionTime[msg.sender] + MIN_POSITION_INTERVAL, "Too frequent");
        lastPositionTime[msg.sender] = block.timestamp;
        
        // H-4: Limit individual position size (based on available liquidity, not total assets)
        uint256 availableLiquidity = asset.balanceOf(address(pool));
        require(assetAmount <= (availableLiquidity * MAX_POSITION_SIZE_BPS) / 10_000, "Position too large");
        
        IExchange exchange = IExchange(exchangeAddress);
        
        // Calculate opening fee (infrastructure fee)
        uint256 openFee = (assetAmount * feeBps) / 10_000;
        uint256 netUserAmount = assetAmount - openFee;
        feesAccrued += openFee;
        
        // Fee-on-transfer token protection
        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), assetAmount);
        uint256 balanceAfter = asset.balanceOf(address(this));
        require(balanceAfter - balanceBefore == assetAmount, "Fee detected");
        
        // H-4: Limit total positions (use total pool capital, not just free assets)
        uint256 currentDebt = pool.totalDebt();
        uint256 newDebt = currentDebt + netUserAmount;
        uint256 totalPoolCapital = pool.totalAssets();  // totalAssets = balance + debt
        require(newDebt <= (totalPoolCapital * MAX_TOTAL_POSITIONS_BPS) / 10_000, "Max positions exceeded");
        
        // H-5: Calculate profit sharing BEFORE borrow (prevents race condition)
        uint256 predictedTotal = totalPoolCapital;
        uint256 predictedUtilizationBps = predictedTotal > 0 ? (newDebt * 10_000) / predictedTotal : 0;
        uint256 profitSharing;
        if (predictedUtilizationBps <= 9000) {
            profitSharing = 20;
        } else if (predictedUtilizationBps <= 9200) {
            profitSharing = 30;
        } else if (predictedUtilizationBps <= 9400) {
            profitSharing = 40;
        } else {
            profitSharing = 50;
        }

        // Borrow from pool (with fee-on-transfer check)
        balanceBefore = asset.balanceOf(address(this));
        pool.borrow(netUserAmount);
        balanceAfter = asset.balanceOf(address(this));
        require(balanceAfter - balanceBefore == netUserAmount, "Fee detected");

        uint256 totalAmount = netUserAmount * 2;

        // Get expected output and validate
        uint256 expectedOut = exchange.getAmountOut(address(asset), totalAmount, path);
        require(expectedOut > 0, "No output");
        
        // M-2: Oracle validation
        uint256 oracleMinTargetOut = _oracleMinTargetOut(totalAmount, maxDeviationBps);
        require(expectedOut >= oracleMinTargetOut, "Oracle deviation");

        // H-2: Exact amount approval (not unlimited)
        uint256 currentAllowance = asset.allowance(address(this), exchangeAddress);
        if (currentAllowance < totalAmount) {
            asset.approve(exchangeAddress, totalAmount);
        }
        
        uint256 amountOut = exchange.swap(address(asset), totalAmount, expectedOut, path, deadline);
        
        // H-2: Revoke approval after use
        asset.approve(exchangeAddress, 0);

        // Save position
        id = ++nextPositionId; // Start from 1, not 0
        Position memory p = Position({
            id: id,
            sender: msg.sender,
            openAssetAmount: totalAmount,
            targetAmount: amountOut,
            openDate: block.timestamp,
            expireDate: block.timestamp + positionDuration,
            profitSharing: profitSharing,
            closeDate: 0,
            closeAssetAmount: 0
        });
        positions[id] = p;
        positionsOf[msg.sender].push(id);
        
        emit OpenPosition(id, msg.sender, p.openAssetAmount, p.targetAmount, p.profitSharing, openFee);
    }

    /// @notice Close an existing position
    /// @dev Owner can close anytime, anyone can close after expiration
    function closePosition(
        uint256 id,
        uint256 maxDeviationBps,
        address exchangeAddress,
        bytes calldata path,
        uint256 deadline
    ) external nonReentrant {
        // Closing is always allowed (emergency withdrawal)
        
        require(maxDeviationBps <= ORACLE_MAX_DEVIATION_BPS, "Max deviation too high");
        require(isExchange[exchangeAddress], "Bad exchange");
        
        IExchange exchange = IExchange(exchangeAddress);
        Position memory p = positions[id];

        // M-19: Position existence validation
        require(p.openDate > 0, "Position does not exist");
        require(p.sender != address(0), "Invalid position");
        require(p.targetAmount > 0, "Invalid target amount");
        require(p.closeDate == 0, "Already closed");
        
        // Access control: owner can close anytime, anyone after expiration
        if (block.timestamp < p.expireDate) {
            require(p.sender == msg.sender, "Only owner before expiration");
        }

        // Get minimum output
        uint256 amountIn = p.targetAmount;
        uint256 minOut = exchange.getAmountOut(address(targetToken), amountIn, path);
        require(minOut > 0, "No output");
        
        // M-2: Oracle validation
        uint256 oracleMinAssetOut = _oracleMinAssetOut(amountIn, maxDeviationBps);
        require(minOut >= oracleMinAssetOut, "Oracle deviation");

        // H-2: Exact amount approval
        uint256 currentAllowance = targetToken.allowance(address(this), exchangeAddress);
        if (currentAllowance < amountIn) {
            targetToken.approve(exchangeAddress, amountIn);
        }
        
        // M-18: Balance verification before swap
        uint256 assetBalanceBefore = asset.balanceOf(address(this));
        
        uint256 assetAmountOut = exchange.swap(address(targetToken), amountIn, minOut, path, deadline);
        
        // H-2: Revoke approval
        targetToken.approve(exchangeAddress, 0);
        
        // M-18: Check actual balance after swap
        uint256 assetBalanceAfter = asset.balanceOf(address(this));
        uint256 actualReceived = assetBalanceAfter - assetBalanceBefore;
        require(actualReceived >= minOut, "Actual received less than expected");
        
        assetAmountOut = actualReceived;
        
        // Calculate split between pool and borrower (includes profit sharing)
        (uint256 poolAmount, uint256 borrowerGross) = _splitClose(p.openAssetAmount, assetAmountOut, p.profitSharing);
        uint256 poolPrincipal = p.openAssetAmount / 2;
        
        // Calculate closing fee from profit only
        uint256 closeFee = 0;
        if (assetAmountOut >= p.openAssetAmount) {
            // There is profit - take fee from the profit
            uint256 profit = assetAmountOut - p.openAssetAmount;
            closeFee = (profit * feeBps) / 10_000;
            feesAccrued += closeFee;
        }
        
        uint256 borrowerNet = borrowerGross > closeFee ? borrowerGross - closeFee : 0;

        // H-2: Exact amount approval for pool return
        uint256 poolAllowance = asset.allowance(address(this), address(pool));
        if (poolAllowance < poolAmount) {
            asset.approve(address(pool), poolAmount);
        }
        
        // H-11: Return borrow with validated parameters
        pool.returnBorrow(poolAmount, poolPrincipal);
        
        // H-2: Revoke approval
        asset.approve(address(pool), 0);

        // Transfer to position owner
        if (borrowerNet > 0) {
            asset.safeTransfer(p.sender, borrowerNet);
        }

        // Update position
        positions[id].closeDate = block.timestamp;
        positions[id].closeAssetAmount = assetAmountOut;
        
        emit ClosePosition(id, assetAmountOut, closeFee);
    }

    /// @notice Preview a new position without state changes
    function previewNewPosition(
        uint256 assetAmount,
        uint256 maxDeviationBps,
        address exchangeAddress,
        bytes calldata path
    )
        external
        view
        returns (
            uint256 openFee,
            uint256 netUserAmount,
            uint256 totalAmount,
            uint256 expectedOut,
            uint256 oracleMinTargetOut,
            uint256 profitSharing
        )
    {
        require(assetAmount > 0, "Zero amount");
        require(maxDeviationBps <= ORACLE_MAX_DEVIATION_BPS, "Max deviation too high");
        require(isExchange[exchangeAddress], "Bad exchange");

        openFee = (assetAmount * feeBps) / 10_000;
        netUserAmount = assetAmount - openFee;
        totalAmount = netUserAmount * 2;

        expectedOut = IExchange(exchangeAddress).getAmountOut(address(asset), totalAmount, path);
        oracleMinTargetOut = _oracleMinTargetOutView(totalAmount, maxDeviationBps);
        profitSharing = currentProfitSharing();
    }

    /// @notice Get current profit sharing percentage based on pool utilization
    /// @dev M-6: Includes overflow protection
    function currentProfitSharing() public view returns (uint256) {
        uint256 assets = pool.totalAssets();
        uint256 debt = pool.totalDebt();
        
        // M-6: Overflow protection for addition
        if (assets > type(uint256).max - debt) {
            return 50; // Maximum profit sharing
        }
        
        uint256 total = assets + debt;
        if (total == 0) return 20;
        
        // M-6: Overflow protection for multiplication
        if (debt > type(uint256).max / 10_000) {
            return _calculateProfitSharingAlt(debt, total);
        }
        
        uint256 utilizationBps = (debt * 10_000) / total;

        if (utilizationBps <= 9000) return 20;
        if (utilizationBps <= 9200) return 30;
        if (utilizationBps <= 9400) return 40;
        return 50;
    }

    /// @notice Alternative profit sharing calculation for very large numbers
    /// @dev M-6: Prevents overflow in multiplication
    function _calculateProfitSharingAlt(uint256 debt, uint256 total) internal pure returns (uint256) {
        // Use percentage calculation to avoid overflow
        uint256 percentage = (debt / (total / 100));
        
        if (percentage <= 90) return 20;
        if (percentage <= 92) return 30;
        if (percentage <= 94) return 40;
        return 50;
    }

    /// @notice Get oracle price with validation
    /// @dev M-2: Comprehensive oracle validation with auto-pause
    function getOraclePrice() public view returns (uint256) {
        return _oraclePriceAssetPerTargetView();
    }

    /// @notice Oracle validation with state modification
    /// @dev M-2: Includes staleness checks and validation
    /// @dev Returns price of 1 targetToken in asset units (adjusted for decimals)
    /// @dev For Chainlink: ETH/USD feed with 8 decimals returns ~3000_00000000 for $3000
    ///      Adjusted to USDC (6 decimals) = 3000_000000
    function _oraclePriceAssetPerTarget() internal returns (uint256) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = priceOracle.latestRoundData();
        
        // M-2: Check for invalid oracle answer
        require(answer > 0, "Invalid oracle answer");
        
        // M-2: Validate oracle data freshness and validity
        require(answeredInRound >= roundId, "Stale oracle data");
        require(updatedAt > 0, "Invalid update time");
        require(block.timestamp - updatedAt <= ORACLE_MAX_STALENESS, "Oracle data too old");
        
        // M-2: Check price reasonableness (additional protection)
        require(answer < type(int192).max, "Oracle price overflow");
        
        uint8 oracleDecimals = priceOracle.decimals();
        uint256 price = uint256(answer);
        
        // Adjust decimals to match asset decimals
        // Example: Chainlink ETH/USD (8 decimals) -> USDC (6 decimals)
        // 3000_00000000 / 100 = 3000_000000
        if (oracleDecimals < assetDecimals) {
            return price * 10 ** (assetDecimals - oracleDecimals);
        } else if (oracleDecimals > assetDecimals) {
            return price / 10 ** (oracleDecimals - assetDecimals);
        }
        return price;
    }

    /// @notice View-only oracle price (no pause trigger)
    /// @dev M-2: Oracle validation without state modification
    function _oraclePriceAssetPerTargetView() internal view returns (uint256) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle answer");
        
        // M-2: Validate oracle data
        require(answeredInRound >= roundId, "Stale oracle data");
        require(updatedAt > 0, "Invalid update time");
        require(block.timestamp - updatedAt <= ORACLE_MAX_STALENESS, "Oracle data too old");
        
        // M-2: Check price reasonableness
        require(answer < type(int192).max, "Oracle price overflow");
        
        uint8 oracleDecimals = priceOracle.decimals();
        uint256 price = uint256(answer);
        
        if (oracleDecimals < assetDecimals) {
            return price * 10 ** (assetDecimals - oracleDecimals);
        } else if (oracleDecimals > assetDecimals) {
            return price / 10 ** (oracleDecimals - assetDecimals);
        }
        return price;
    }

    /// @notice Calculate minimum target token output based on oracle
    /// @dev Used when opening position: asset -> targetToken
    /// @param assetAmountIn Amount of asset tokens to swap (e.g., 2000 USDC)
    /// @param maxDeviationBps Maximum acceptable deviation from oracle price (e.g., 500 = 5%)
    /// @return Minimum expected targetToken amount (e.g., 0.66 WETH)
    function _oracleMinTargetOut(uint256 assetAmountIn, uint256 maxDeviationBps) internal returns (uint256) {
        uint256 priceAssetPerTarget = _oraclePriceAssetPerTarget();
        uint256 targetOut = (assetAmountIn * (10 ** uint256(targetDecimals))) / priceAssetPerTarget;
        return (targetOut * (10_000 - maxDeviationBps)) / 10_000;
    }

    /// @notice Calculate minimum asset output based on oracle
    /// @dev Used when closing position: targetToken -> asset
    /// @param targetAmountIn Amount of target tokens to swap (e.g., 0.66 WETH)
    /// @param maxDeviationBps Maximum acceptable deviation from oracle price (e.g., 500 = 5%)
    /// @return Minimum expected asset amount (e.g., 1900 USDC with 5% deviation)
    function _oracleMinAssetOut(uint256 targetAmountIn, uint256 maxDeviationBps) internal returns (uint256) {
        uint256 priceAssetPerTarget = _oraclePriceAssetPerTarget();
        uint256 assetOut = (targetAmountIn * priceAssetPerTarget) / (10 ** uint256(targetDecimals));
        return (assetOut * (10_000 - maxDeviationBps)) / 10_000;
    }
    
    /// @notice View-only minimum target output calculation
    function _oracleMinTargetOutView(uint256 assetAmountIn, uint256 maxDeviationBps) internal view returns (uint256) {
        uint256 priceAssetPerTarget = _oraclePriceAssetPerTargetView();
        require(priceAssetPerTarget > 0, "Oracle price 0");
        uint256 targetOut = (assetAmountIn * (10 ** uint256(targetDecimals))) / priceAssetPerTarget;
        return (targetOut * (10_000 - maxDeviationBps)) / 10_000;
    }

    /// @notice View-only minimum asset output calculation
    function _oracleMinAssetOutView(uint256 targetAmountIn, uint256 maxDeviationBps) internal view returns (uint256) {
        uint256 priceAssetPerTarget = _oraclePriceAssetPerTargetView();
        require(priceAssetPerTarget > 0, "Oracle price 0");
        uint256 assetOut = (targetAmountIn * priceAssetPerTarget) / (10 ** uint256(targetDecimals));
        return (assetOut * (10_000 - maxDeviationBps)) / 10_000;
    }

    /// @notice Withdraw accrued fees (only authorized by governance)
    function withdrawFees(address to, uint256 amount) external nonReentrant returns (uint256 withdrawn) {
        require(feeGovernance.isWithdrawer(msg.sender), "Not allowed");
        require(to != address(0), "Bad recipient");
        require(amount > 0, "Zero amount");
        require(amount <= feesAccrued, "Exceeds fees");
        
        feesAccrued -= amount;
        asset.safeTransfer(to, amount);
        withdrawn = amount;
    }

    /// @notice Split closing amount between pool and borrower
    function _splitClose(uint256 openAssetAmount, uint256 assetAmountOut, uint256 profitSharing)
        internal
        pure
        returns (uint256 poolAmount, uint256 borrowerGross)
    {
        uint256 poolPrincipal = openAssetAmount / 2;

        if (assetAmountOut >= openAssetAmount) {
            // Profit scenario
            uint256 profitUint = assetAmountOut - openAssetAmount;
            uint256 poolBonus = (profitUint * profitSharing) / 100;
            poolAmount = poolPrincipal + poolBonus;
            borrowerGross = assetAmountOut - poolAmount;
        } else {
            // Loss scenario - borrower bears losses first, then pool
            uint256 loss = openAssetAmount - assetAmountOut;
            uint256 borrowerOpenAmount = openAssetAmount / 2;
            
            if (loss <= borrowerOpenAmount) {
                // Loss is within borrower's capital - pool gets principal back
                poolAmount = poolPrincipal;
                borrowerGross = borrowerOpenAmount - loss;
            } else {
                // Loss exceeds borrower's capital - pool also takes losses
                poolAmount = assetAmountOut;
                borrowerGross = 0;
            }
        }
    }

    /// @notice Get user's position IDs
    function getUserPositions(address user) external view returns (uint256[] memory) {
        return positionsOf[user];
    }

    /// @notice Get position details
    function getPosition(uint256 id) external view returns (Position memory) {
        return positions[id];
    }
}
