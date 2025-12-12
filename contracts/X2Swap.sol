// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {X2Pool} from "./X2Pool.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Position} from "./structs/Position.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/// @title X2Swap - factory wrapper that deploys an X2Pool
/// @notice Deploys a fresh X2Pool in the constructor and exposes its address.
contract X2Swap {
    X2Pool public immutable pool;
    IERC20 public immutable asset;
    IERC20 public immutable targetToken;
    uint256 public immutable positionDuration;

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) public positionsOf;

    ISwapRouter public swapRouter;

    event OpenPosition(uint256 indexed id, address indexed sender, uint256 assetAmount, uint256 targetAmount, uint256 profitSharing);
    event ClosePosition(uint256 indexed id, uint256 closeAssetAmount);

    constructor(address asset_, address targetToken_, address swapRouter_, string memory lpTokenName, string memory lpTokenSymbol, uint256 positionDuration_) {
        pool = new X2Pool(asset_, targetToken_, address(this), lpTokenName, lpTokenSymbol);
        asset = IERC20(asset_);
        targetToken = IERC20(targetToken_);
        swapRouter = ISwapRouter(swapRouter_);
        positionDuration = positionDuration_;
    }

    function openPosition(uint256 assetAmount) external returns (uint256 id) {
        require(assetAmount > 0, "Zero amount");
        // pull tokens from user
        require(asset.transferFrom(msg.sender, address(this), assetAmount), "Transfer failed");
        // Borrow the same amount from the pool to this swap
        pool.borrow(assetAmount);

        uint256 totalAmount = assetAmount * 2;

        // Swap combined amount to target token (assumes allowance to router via pool -> swap)
        uint256 expectedOut = swapRouter.getAmountOut(address(asset), totalAmount);
        require(expectedOut > 0, "No output");

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
        emit OpenPosition(id, msg.sender, p.openAssetAmount, p.targetAmount, p.profitSharing);
    }

    function closePosition(uint256 id) external {
        Position memory p = positions[id];
        require(p.sender == msg.sender, "Not owner");

        require(p.closeDate == 0, "Already closed");

        // Swap target back to asset
        uint256 amountIn = p.targetAmount;
        uint256 minOut = swapRouter.getAmountOut(address(targetToken), amountIn);
        require(minOut > 0, "No output");

        uint256 currentAllowance = targetToken.allowance(address(this), address(swapRouter));
        if (currentAllowance < amountIn) {
            targetToken.approve(address(swapRouter), type(uint256).max);
        }
        uint256 assetAmountOut = swapRouter.swap(address(targetToken), amountIn, minOut);

        uint256 poolPrincipal = p.openAssetAmount / 2;
        int256 profit = int256(assetAmountOut) - int256(p.openAssetAmount);

        uint256 poolAmount;
        uint256 borrowerAmount;
        if (profit >= 0) {
            uint256 profitUint = uint256(profit);
            uint256 poolBonus = (profitUint * p.profitSharing) / 100;
            poolAmount = poolPrincipal + poolBonus;
            borrowerAmount = assetAmountOut - poolAmount;
        } else {
            if (assetAmountOut >= poolPrincipal) {
                poolAmount = poolPrincipal;
                borrowerAmount = assetAmountOut - poolPrincipal;
            } else {
                poolAmount = assetAmountOut;
                borrowerAmount = 0;
            }
        }

        if (poolAmount > 0) {
            uint256 poolAllowance = asset.allowance(address(this), address(pool));
            if (poolAllowance < poolAmount) {
                asset.approve(address(pool), type(uint256).max);
            }
            pool.returnBorrow(poolAmount, poolPrincipal);
        }

        if (borrowerAmount > 0) {
            require(asset.transfer(msg.sender, borrowerAmount), "Borrower transfer failed");
        }

        positions[id].closeDate = block.timestamp;
        positions[id].closeAssetAmount = assetAmountOut;
        emit ClosePosition(id, assetAmountOut);
    }

    /// @notice Returns profit sharing percentage (20% to 50%) based on pool debt ratio.
    /// More debt relative to assets increases the profit sharing.
    function currentProfitSharing() public view returns (uint256) {
        uint256 assets = pool.totalAssets();
        uint256 debt = pool.totalDebt();
        if (assets == 0) return 50; // max if no assets to back debt

        // ratio in 1e18 precision: debt / assets
        uint256 ratio = (debt * 1e18) / assets;
        uint256 minPct = 20;
        uint256 maxPct = 50;
        uint256 span = maxPct - minPct;

        // Linear interpolation, clamped to maxBps
        uint256 variablePart = (span * ratio) / 1e18;
        uint256 sharing = minPct + variablePart;
        if (sharing > maxPct) sharing = maxPct;
        return sharing;
    }

    function getPositionsOf(address owner) external view returns (uint256[] memory) {
        return positionsOf[owner];
    }

    /// @notice Simulate closing a position by estimating proceeds and their split between borrower and pool.
    /// @return profit signed profit/loss relative to total assets put into the position
    /// @return borrowerAmount amount the borrower would receive
    /// @return poolAmount amount the pool would receive
    /// @return assetAmountOut estimated amount after swapping target back to asset
    function checkPosition(uint256 id) external view returns (int256 profit, uint256 borrowerAmount, uint256 poolAmount, uint256 assetAmountOut) {
        Position memory p = positions[id];
        require(p.openDate != 0, "Position not found");
        assetAmountOut = swapRouter.getAmountOut(address(targetToken), p.targetAmount);

        uint256 poolPrincipal = p.openAssetAmount / 2;

        profit = int256(assetAmountOut) - int256(p.openAssetAmount);

        if (profit >= 0) {
            uint256 profitUint = uint256(profit);
            uint256 poolBonus = (profitUint * p.profitSharing) / 100;
            poolAmount = poolPrincipal + poolBonus;
            borrowerAmount = assetAmountOut - poolAmount;
        } else {
            if (assetAmountOut >= poolPrincipal) {
                poolAmount = poolPrincipal;
                borrowerAmount = assetAmountOut - poolPrincipal;
            } else {
                poolAmount = assetAmountOut;
                borrowerAmount = 0;
            }
        }
    }
}
