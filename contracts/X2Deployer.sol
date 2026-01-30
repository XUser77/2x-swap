// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {X2Pool} from "./X2Pool.sol";
import {X2Swap} from "./X2Swap.sol";
import {FeeGovernance} from "./FeeGovernance.sol";

/// @title X2Deployer
/// @notice Deploys a shared X2Pool and multiple X2Swap instances keyed by targetToken.
contract X2Deployer {
    struct TargetConfig {
        address targetToken;
        address priceOracle;
    }

    address public immutable asset;
    uint256 public immutable feeBps;
    uint256 public immutable positionDuration;
    X2Pool public immutable pool;
    FeeGovernance public immutable feeGovernance;
    mapping(address => address) public swaps; // targetToken => X2Swap
    address[] public allSwaps;

    event SwapCreated(address indexed targetToken, address indexed x2swap, address indexed priceOracle);

    constructor(
        address asset_,
        address[] memory exchanges_,
        uint256 feeBps_,
        uint256 positionDuration_,
        address[] memory governors_,
        TargetConfig[] memory targets_
    ) {
        require(asset_ != address(0), "Bad asset");
        require(feeBps_ <= 10_000, "Bad fee");
        require(exchanges_.length > 0, "No exchanges");
        asset = asset_;
        feeBps = feeBps_;
        positionDuration = positionDuration_;

        feeGovernance = new FeeGovernance(governors_);
        pool = new X2Pool(asset_, address(this), address(feeGovernance));

        uint256 targetsLength = targets_.length;
        for (uint256 i = 0; i < targetsLength; ) {
            address targetToken = targets_[i].targetToken;
            address priceOracle = targets_[i].priceOracle;
            require(targetToken != address(0), "Bad target");
            require(priceOracle != address(0), "Bad oracle");
            require(swaps[targetToken] == address(0), "Exists");

            X2Swap swap = new X2Swap(
                asset,
                targetToken,
                exchanges_,
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
            emit SwapCreated(targetToken, x2swap, priceOracle);
            unchecked { ++i; }
        }
    }

    function allSwapsLength() external view returns (uint256) {
        return allSwaps.length;
    }
}
