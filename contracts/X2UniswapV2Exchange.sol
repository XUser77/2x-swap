// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IExchange} from "./interfaces/IExchange.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @notice Minimal Uniswap V2 router adapter implementing IExchange for a fixed token0/token1 pair.
contract X2UniswapV2Exchange is IExchange {
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

    function provider() external pure override returns (string memory) {
        return "UniswapV2";
    }

    function getAmountOut(
        address tokenIn,
        uint256 amountIn,
        bytes calldata path
    ) external view override returns (uint256) {
        address[] memory decodedPath = _decodePath(tokenIn, path);
        uint256[] memory amounts = IUniV2Router(uniV2Router).getAmountsOut(amountIn, decodedPath);
        return amounts[amounts.length - 1];
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata path,
        uint256 deadline
    ) external override returns (uint256 amountOut) {
        address[] memory decodedPath = _decodePath(tokenIn, path);

        // pull tokens in
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Pull failed");
        // approve router if needed
        _ensureApproval(tokenIn, amountIn);

        uint256[] memory amounts = IUniV2Router(uniV2Router).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            decodedPath,
            msg.sender,
            deadline
        );
        return amounts[amounts.length - 1];
    }

    function _decodePath(address tokenIn, bytes calldata path) internal view returns (address[] memory decodedPath) {
        decodedPath = abi.decode(path, (address[]));
        require(decodedPath.length >= 2, "Bad path");
        require(decodedPath[0] == tokenIn, "Bad tokenIn");
        address last = decodedPath[decodedPath.length - 1];
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
