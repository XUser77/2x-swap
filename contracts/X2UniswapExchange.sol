// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IExchange} from "./interfaces/IExchange.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @notice Minimal Uniswap V2 router adapter implementing IExchange for a fixed token0/token1 pair.
contract X2UniswapExchange is IExchange {
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

    function getAmountOut(
        address tokenIn,
        uint256 amountIn,
        address[] calldata path
    ) external view override returns (uint256) {
        _validatePath(tokenIn, path);
        uint256[] memory amounts = IUniV2Router(uniV2Router).getAmountsOut(amountIn, path);
        return amounts[amounts.length - 1];
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address[] calldata path
    ) external override returns (uint256 amountOut) {
        _validatePath(tokenIn, path);

        // pull tokens in
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Pull failed");
        // approve router if needed
        _ensureApproval(tokenIn, amountIn);

        uint256[] memory amounts = IUniV2Router(uniV2Router).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            msg.sender,
            block.timestamp + 600
        );
        return amounts[amounts.length - 1];
    }

    function _validatePath(address tokenIn, address[] calldata path) internal view {
        require(path.length >= 2, "Bad path");
        require(path[0] == tokenIn, "Bad tokenIn");
        address last = path[path.length - 1];
        if (tokenIn == token0) {
            require(last == token1, "Bad tokenOut");
        } else {
            require(tokenIn == token1, "Invalid tokenIn");
            require(last == token0, "Bad tokenOut");
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
