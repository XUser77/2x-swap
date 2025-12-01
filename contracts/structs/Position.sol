// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct Position {
    uint256 id;
    address sender;
    uint256 assetAmount;
    uint256 targetAmount;
    uint256 openDate;
    uint256 expireDate;
    uint256 profitSharing;
    uint256 closeDate;
    uint256 closeAssetAmount;
}
