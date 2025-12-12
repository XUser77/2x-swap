// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

interface IUniswapV2RouterLike {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

/// @title FakeOracle
/// @notice Chainlink-style oracle that derives price from Uniswap V2 quotes (for local testing).
/// @dev Returns price of 1 targetToken denominated in `asset` units (asset decimals).
contract FakeOracle is IPriceOracle {
    IUniswapV2RouterLike public immutable router;
    IERC20 public immutable asset;
    IERC20 public immutable targetToken;
    uint8 public immutable override decimals;

    constructor(address router_, address asset_, address targetToken_) {
        require(router_ != address(0), "Router required");
        require(asset_ != address(0), "Asset required");
        require(targetToken_ != address(0), "Target required");
        router = IUniswapV2RouterLike(router_);
        asset = IERC20(asset_);
        targetToken = IERC20(targetToken_);
        decimals = IERC20(asset_).decimals();
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint256 amountIn = 10 ** uint256(targetToken.decimals()); // 1 targetToken
        address[] memory path = new address[](2);
        path[0] = address(targetToken);
        path[1] = address(asset);
        uint256[] memory amounts = router.getAmountsOut(amountIn, path);
        // amounts[1] is in asset units (asset decimals)
        answer = int256(amounts[1]);
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        roundId = 0;
        answeredInRound = 0;
    }
}

