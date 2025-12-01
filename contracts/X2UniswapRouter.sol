// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import "hardhat/console.sol";

/// @notice Minimal Uniswap V2 router adapter implementing ISwapRouter for a fixed token0/token1 pair.
contract X2UniswapRouter is ISwapRouter {
    address public immutable token0;
    address public immutable token1;
    address public immutable uniV2Router;

    constructor(address token0_, address token1_, address uniV2Router_) {
        require(token0_ != address(0) && token1_ != address(0), "Tokens required");
        require(uniV2Router_ != address(0), "Router required");
        token0 = token0_;
        token1 = token1_;
        uniV2Router = uniV2Router_;
    }

    function getAmountOut(address tokenIn, uint256 amountIn) external view override returns (uint256) {
        address[] memory path = _buildPath(tokenIn);
        uint256[] memory amounts = IUniV2Router(uniV2Router).getAmountsOut(amountIn, path);
        return amounts[amounts.length - 1];
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external override returns (uint256 amountOut) {
        console.log("Swap start");
        address[] memory path = _buildPath(tokenIn);

        console.log("Path: ok");
        // pull tokens in
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Pull failed");
        console.log("transferFrom passed");
        // approve router if needed
        _ensureApproval(tokenIn, amountIn);
        console.log("approval passed");

        uint256[] memory amounts = IUniV2Router(uniV2Router).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            msg.sender,
            block.timestamp + 600
        );
        return amounts[amounts.length - 1];
    }

    function _buildPath(address tokenIn) internal view returns (address[] memory path) {
        if (tokenIn == token0) {
            path = new address[](2);
            path[0] = token0;
            path[1] = token1;
        } else {
            require(tokenIn == token1, "Invalid tokenIn");
            path = new address[](2);
            path[0] = token1;
            path[1] = token0;
        }
    }

    function _ensureApproval(address token, uint256 amount) internal {
        uint256 current = IERC20(token).allowance(address(this), uniV2Router);
        if (current < amount) {
            IERC20(token).approve(uniV2Router, type(uint256).max);
        }
    }
}

interface IUniV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
