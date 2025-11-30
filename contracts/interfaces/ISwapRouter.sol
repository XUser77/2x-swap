// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal swap router interface used by the pool frontend.
interface ISwapRouter {
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256);
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut);
}
