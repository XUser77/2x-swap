// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal exchange interface used by the pool frontend.
interface IExchange {
    function provider() external view returns (string memory);
    function getAmountOut(address tokenIn, uint256 amountIn, bytes calldata path) external view returns (uint256);
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata path,
        uint256 deadline
    ) external returns (uint256 amountOut);
}
