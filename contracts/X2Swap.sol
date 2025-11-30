// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {X2Pool} from "./X2Pool.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title X2Swap - factory wrapper that deploys an X2Pool
/// @notice Deploys a fresh X2Pool in the constructor and exposes its address.
contract X2Swap {
    X2Pool public immutable pool;
    IERC20 public immutable asset;
    IERC20 public immutable targetToken;

    constructor(address asset_, address targetToken_, string memory name, string memory symbol) {
        pool = new X2Pool(asset_, targetToken_, name, symbol);
        asset = IERC20(asset_);
        targetToken = IERC20(targetToken_);
    }
}
