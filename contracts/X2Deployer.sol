// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {X2Pool} from "./X2Pool.sol";
import {X2Swap} from "./X2Swap.sol";
import {FeeGovernance} from "./FeeGovernance.sol";

/// @title X2Deployer
/// @notice Deploys a shared X2Pool and multiple X2Swap instances keyed by targetToken.
contract X2Deployer {
    address public immutable asset;
    address public immutable exchange;
    address public immutable priceOracle;
    uint256 public immutable feeBps;
    uint256 public immutable positionDuration;
    X2Pool public immutable pool;
    FeeGovernance public immutable feeGovernance;
    mapping(address => address) public swaps; // targetToken => X2Swap
    address[] public allSwaps;

    event SwapCreated(address indexed targetToken, address indexed x2swap);

    constructor(
        address asset_,
        address exchange_,
        address priceOracle_,
        uint256 feeBps_,
        uint256 positionDuration_,
        address[] memory governors_,
        address[] memory targetTokens_
    ) {
        require(asset_ != address(0), "Bad asset");
        require(exchange_ != address(0), "Bad exchange");
        require(priceOracle_ != address(0), "Bad oracle");
        require(feeBps_ <= 10_000, "Bad fee");
        asset = asset_;
        exchange = exchange_;
        priceOracle = priceOracle_;
        feeBps = feeBps_;
        positionDuration = positionDuration_;

        pool = new X2Pool(asset_, address(this));
        feeGovernance = new FeeGovernance(governors_);

        for (uint256 i = 0; i < targetTokens_.length; i++) {
            address targetToken = targetTokens_[i];
            require(targetToken != address(0), "Bad target");
            require(swaps[targetToken] == address(0), "Exists");

            X2Swap swap = new X2Swap(
                asset,
                targetToken,
                exchange,
                priceOracle,
                feeBps,
                address(pool),
                address(feeGovernance),
                positionDuration
            );

            address x2swap = address(swap);
            swaps[targetToken] = x2swap;
            allSwaps.push(x2swap);
            pool.registerSwap(x2swap);
            emit SwapCreated(targetToken, x2swap);
        }
    }

    function allSwapsLength() external view returns (uint256) {
        return allSwaps.length;
    }
}
