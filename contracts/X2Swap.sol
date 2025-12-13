// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {X2Pool} from "./X2Pool.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Position} from "./structs/Position.sol";
import {IExchange} from "./interfaces/IExchange.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/// @title X2Swap - factory wrapper that deploys an X2Pool
/// @notice Deploys a fresh X2Pool in the constructor and exposes its address.
contract X2Swap {
    X2Pool public immutable pool;
    IERC20 public immutable asset;
    IERC20 public immutable targetToken;
    uint256 public immutable positionDuration;
    uint8 public immutable assetDecimals;
    uint8 public immutable targetDecimals;
    IPriceOracle public immutable priceOracle;
    uint256 public immutable feeBps;

    uint256 public feesAccrued;
    address[] public feeWithdrawers; // TODO: Governance contract (3 of 5)
    mapping(address => bool) public isFeeWithdrawer;

    uint256 public constant ORACLE_MAX_DEVIATION_BPS = 500; // 5%

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) public positionsOf;

    IExchange public swapRouter;

    event OpenPosition(uint256 indexed id, address indexed sender, uint256 assetAmount, uint256 targetAmount, uint256 profitSharing, uint256 feeAmount);
    event ClosePosition(uint256 indexed id, uint256 closeAssetAmount, uint256 feeAmount);
    // fee withdraw events removed

    constructor(
        address asset_,
        address targetToken_,
        address swapRouter_,
        address priceOracle_,
        uint256 feeBps_,
        address pool_,
        address[] memory feeWithdrawers_,
        uint256 positionDuration_
    ) {
        require(pool_ != address(0), "Pool required");
        pool = X2Pool(pool_);
        asset = IERC20(asset_);
        assetDecimals = IERC20(asset_).decimals();
        targetToken = IERC20(targetToken_);
        targetDecimals = IERC20(targetToken_).decimals();
        swapRouter = IExchange(swapRouter_);
        priceOracle = IPriceOracle(priceOracle_);
        feeBps = feeBps_;
        positionDuration = positionDuration_;

        for (uint256 i = 0; i < feeWithdrawers_.length; i++) {
            address w = feeWithdrawers_[i];
            require(w != address(0), "Bad withdrawer");
            if (!isFeeWithdrawer[w]) {
                isFeeWithdrawer[w] = true;
                feeWithdrawers.push(w);
            }
        }
    }

    function openPosition(uint256 assetAmount) external returns (uint256 id) { // TODO: User max deviation
        require(assetAmount > 0, "Zero amount"); // TODO: Another checks???
        // pull tokens from user, take opening fee
        require(asset.transferFrom(msg.sender, address(this), assetAmount), "Transfer failed");
        uint256 openFee = (assetAmount * feeBps) / 10_000;
        feesAccrued += openFee;
        uint256 netUserAmount = assetAmount - openFee;

        // Borrow the same amount (net) from the pool to this swap
        pool.borrow(netUserAmount);

        uint256 totalAmount = netUserAmount * 2;

        // Swap combined amount to target token (assumes allowance to router via pool -> swap)
        uint256 expectedOut = swapRouter.getAmountOut(address(asset), totalAmount);
        require(expectedOut > 0, "No output");
        uint256 oracleMinTargetOut = _oracleMinTargetOut(totalAmount);
        require(expectedOut >= oracleMinTargetOut, "Oracle deviation");

        uint256 currentAllowance = asset.allowance(address(this), address(swapRouter));
        if (currentAllowance < totalAmount) {
            asset.approve(address(swapRouter), type(uint256).max);
        }
        uint256 amountOut = swapRouter.swap(address(asset), totalAmount, expectedOut);
        require(amountOut >= expectedOut, "Swap slippage");

        uint256 profitSharing = currentProfitSharing();
        id = nextPositionId++;
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

    function closePosition(uint256 id) external { // TODO: User deviation
        Position memory p = positions[id];
        if (block.timestamp < p.expireDate) {
            require(p.sender == msg.sender, "Not owner");
        }

        require(p.closeDate == 0, "Already closed");

        // Swap target back to asset
        uint256 amountIn = p.targetAmount;
        uint256 minOut = swapRouter.getAmountOut(address(targetToken), amountIn);
        require(minOut > 0, "No output");
        uint256 oracleMinAssetOut = _oracleMinAssetOut(amountIn);
        require(minOut >= oracleMinAssetOut, "Oracle deviation");

        uint256 currentAllowance = targetToken.allowance(address(this), address(swapRouter));
        if (currentAllowance < amountIn) {
            targetToken.approve(address(swapRouter), type(uint256).max);
        }
        uint256 assetAmountOut = swapRouter.swap(address(targetToken), amountIn, minOut);
        (uint256 poolAmount, uint256 borrowerGross) = _splitClose(p.openAssetAmount, assetAmountOut, p.profitSharing);
        uint256 poolPrincipal = p.openAssetAmount / 2;

        // Fee is charged from borrower side only
        uint256 borrowerFee = (borrowerGross * feeBps) / 10_000;
        feesAccrued += borrowerFee;
        uint256 borrowerNet = borrowerGross - borrowerFee;

        // Return funds to pool first (pool side not charged a fee); always clear the full borrowed principal.
        uint256 poolAllowance = asset.allowance(address(this), address(pool));
        if (poolAllowance < poolAmount) {
            asset.approve(address(pool), type(uint256).max);
        }
        pool.returnBorrow(poolAmount, poolPrincipal);

        if (borrowerNet > 0) {
            require(asset.transfer(p.sender, borrowerNet), "Borrower transfer failed");
        }

        positions[id].closeDate = block.timestamp;
        positions[id].closeAssetAmount = assetAmountOut;
        emit ClosePosition(id, assetAmountOut, borrowerFee);
    }

    /// @notice Returns pool profit share percentage based on pool utilization U = debt / (assets + debt).
    /// Threshold Model v2:
    /// 0–90%: 20%, 90–92%: 30%, 92–94%: 40%, >94%: 50%
    function currentProfitSharing() public view returns (uint256) {
        uint256 assets = pool.totalAssets();
        uint256 debt = pool.totalDebt();
        uint256 total = assets + debt;
        if (total == 0) return 20;
        uint256 utilizationBps = (debt * 10_000) / total;

        if (utilizationBps <= 9000) return 20;
        if (utilizationBps <= 9200) return 30;
        if (utilizationBps <= 9400) return 40;
        return 50;
    }

    function getPositionsOf(address owner) external view returns (uint256[] memory) {
        return positionsOf[owner];
    }

    /// @notice Returns oracle price of target token denominated in asset units.
    function targetRate() external view returns (uint256) {
        return _oraclePriceAssetPerTarget();
    }

    function _oraclePriceAssetPerTarget() internal view returns (uint256) {
        (, int256 answer,,,) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle answer");
        uint8 oracleDecimals = priceOracle.decimals();
        uint256 price = uint256(answer);
        if (oracleDecimals < assetDecimals) {
            return price * 10 ** (assetDecimals - oracleDecimals);
        } else if (oracleDecimals > assetDecimals) {
            return price / 10 ** (oracleDecimals - assetDecimals);
        }
        return price;
    }

    function _oracleMinTargetOut(uint256 assetAmountIn) internal view returns (uint256) {
        uint256 priceAssetPerTarget = _oraclePriceAssetPerTarget(); // asset units per 1 target token
        require(priceAssetPerTarget > 0, "Oracle price 0");
        uint256 targetOut = (assetAmountIn * (10 ** uint256(targetDecimals))) / priceAssetPerTarget;
        return (targetOut * (10_000 - ORACLE_MAX_DEVIATION_BPS)) / 10_000;
    }

    function _oracleMinAssetOut(uint256 targetAmountIn) internal view returns (uint256) {
        uint256 priceAssetPerTarget = _oraclePriceAssetPerTarget(); // asset units per 1 target token
        require(priceAssetPerTarget > 0, "Oracle price 0");
        uint256 assetOut = (targetAmountIn * priceAssetPerTarget) / (10 ** uint256(targetDecimals));
        return (assetOut * (10_000 - ORACLE_MAX_DEVIATION_BPS)) / 10_000;
    }

    function feeWithdrawersCount() external view returns (uint256) {
        return feeWithdrawers.length;
    }

    /// @notice Withdraw accrued fees (denominated in the asset token).
    /// @param to Recipient of the withdrawn fees.
    /// @param amount Amount to withdraw.
    function withdrawFees(address to, uint256 amount) external returns (uint256 withdrawn) {
        require(isFeeWithdrawer[msg.sender], "Not allowed");
        require(to != address(0), "Bad recipient");
        require(amount > 0, "Zero amount");
        require(amount <= feesAccrued, "Exceeds fees");
        feesAccrued -= amount;
        require(asset.transfer(to, amount), "Fee transfer failed");
        withdrawn = amount;
    }

    function _splitClose(uint256 openAssetAmount, uint256 assetAmountOut, uint256 profitSharing)
        internal
        pure
        returns (uint256 poolAmount, uint256 borrowerGross)
    {
        uint256 poolPrincipal = openAssetAmount / 2;

        if (assetAmountOut >= openAssetAmount) {
            uint256 profitUint = assetAmountOut - openAssetAmount;
            uint256 poolBonus = (profitUint * profitSharing) / 100;
            poolAmount = poolPrincipal + poolBonus;
            borrowerGross = assetAmountOut - poolAmount;
        } else {
            if (assetAmountOut >= poolPrincipal) {
                poolAmount = poolPrincipal;
                borrowerGross = assetAmountOut - poolPrincipal;
            } else {
                poolAmount = assetAmountOut;
                borrowerGross = 0;
            }
        }
    }

    /// @notice Simulate closing a position by estimating proceeds and their split between borrower and pool.
    /// @return profit signed profit/loss relative to total assets put into the position
    /// @return borrowerAmount amount the borrower would receive
    /// @return poolAmount amount the pool would receive
    /// @return feeAmount fee charged from borrower side
    /// @return assetAmountOut estimated amount after swapping target back to asset (before borrower fee)
    function checkPosition(uint256 id)
        external
        view
        returns (int256 profit, uint256 borrowerAmount, uint256 poolAmount, uint256 feeAmount, uint256 assetAmountOut)
    {
        Position memory p = positions[id];
        require(p.openDate != 0, "Position not found");
        assetAmountOut = swapRouter.getAmountOut(address(targetToken), p.targetAmount);

        profit = int256(assetAmountOut) - int256(p.openAssetAmount);
        uint256 borrowerGross;
        (poolAmount, borrowerGross) = _splitClose(p.openAssetAmount, assetAmountOut, p.profitSharing);
        feeAmount = (borrowerGross * feeBps) / 10_000;
        borrowerAmount = borrowerGross - feeAmount;
    }
}
