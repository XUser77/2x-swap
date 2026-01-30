// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IExchange} from "./interfaces/IExchange.sol";

/// @notice Minimal Uniswap V3 router adapter implementing IExchange for a fixed token0/token1 pair.
contract X2UniswapV3Exchange is IExchange {
    address public immutable token0;
    address public immutable token1;
    address public immutable uniV3Router;
    address public immutable uniV3Quoter;
    uint24 public immutable poolFee;

    constructor(address token0_, address token1_, address uniV3Router_, address uniV3Quoter_, uint24 poolFee_) {
        require(token0_ != address(0) && token1_ != address(0), "Tokens required");
        require(uniV3Router_ != address(0), "Router required");
        require(uniV3Quoter_ != address(0), "Quoter required");
        token0 = token0_;
        token1 = token1_;
        uniV3Router = uniV3Router_;
        uniV3Quoter = uniV3Quoter_;
        poolFee = poolFee_;
    }

    function provider() external pure override returns (string memory) {
        return "UniswapV3";
    }

    function getAmountOut(
        address tokenIn,
        uint256 amountIn,
        bytes calldata path
    ) external view override returns (uint256) {
        _validatePath(tokenIn, path);
        uint256 amountOut = IUniV3Quoter(uniV3Quoter).quoteExactInput(path, amountIn);
        return amountOut;
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata path,
        uint256 deadline
    ) external override returns (uint256 amountOut) {
        // Validate deadline
        require(deadline >= block.timestamp, "Deadline expired");
        
        _validatePath(tokenIn, path);

        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Pull failed");
        _ensureApproval(tokenIn, amountIn);
        
        // Validate minAmountOut reasonableness
        require(minAmountOut > 0, "Zero min output");

        IUniV3SwapRouter.ExactInputParams memory params = IUniV3SwapRouter.ExactInputParams({
            path: path,
            recipient: msg.sender,
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: minAmountOut
        });
        amountOut = IUniV3SwapRouter(uniV3Router).exactInput(params);
    }

    function _validatePath(address tokenIn, bytes calldata path) internal view {
        (address first, address last) = _decodeEndpoints(path);
        require(first == tokenIn, "Bad tokenIn");
        if (tokenIn == token0) {
            require(last == token1, "Bad tokenOut");
        } else {
            require(tokenIn == token1, "Invalid tokenIn");
            require(last == token0, "Bad tokenOut");
        }
    }

    function _decodeEndpoints(bytes calldata path) internal pure returns (address first, address last) {
        require(path.length >= 43, "Bad path");
        require((path.length - 20) % 23 == 0, "Bad path");
        assembly {
            let start := path.offset
            first := shr(96, calldataload(start))
            let end := sub(add(start, path.length), 20)
            last := shr(96, calldataload(end))
        }
    }

    function _ensureApproval(address token, uint256 amount) internal {
        uint256 current = IERC20(token).allowance(address(this), uniV3Router);
        if (current < amount) {
            IERC20(token).approve(uniV3Router, amount); // Exact amount approval
        }
    }
}

interface IUniV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IUniV3Quoter {
    function quoteExactInput(bytes calldata path, uint256 amountIn) external view returns (uint256 amountOut);

    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}
