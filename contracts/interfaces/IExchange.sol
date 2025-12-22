// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal exchange interface used by the pool frontend.
interface IExchange {
    function getAmountOut(address tokenIn, uint256 amountIn, address[] calldata path) external view returns (uint256);
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address[] calldata path
    ) external returns (uint256 amountOut);
}
