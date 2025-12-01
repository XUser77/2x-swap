// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {X2Pool} from "./X2Pool.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Position} from "./structs/Position.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/// @title X2Swap - factory wrapper that deploys an X2Pool
/// @notice Deploys a fresh X2Pool in the constructor and exposes its address.
contract X2Swap {
    X2Pool public immutable pool;
    IERC20 public immutable asset;
    IERC20 public immutable targetToken;
    uint256 public immutable positionDuration;

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) public positionsOf;

    ISwapRouter public swapRouter;

    event OpenPosition(uint256 indexed id, address indexed sender, uint256 assetAmount, uint256 targetAmount, uint256 profitSharing);
    event ClosePosition(uint256 indexed id, uint256 closeAssetAmount);

    constructor(address asset_, address targetToken_, address swapRouter_, string memory lpTokenName, string memory lpTokenSymbol, uint256 positionDuration_) {
        pool = new X2Pool(asset_, targetToken_, address(this), lpTokenName, lpTokenSymbol);
        asset = IERC20(asset_);
        targetToken = IERC20(targetToken_);
        swapRouter = ISwapRouter(swapRouter_);
        positionDuration = positionDuration_;
    }

    function openPosition(uint256 assetAmount) external returns (uint256 id) {
        require(assetAmount > 0, "Zero amount");
        // pull tokens from user
        require(asset.transferFrom(msg.sender, address(this), assetAmount), "Transfer failed");
        // Borrow the same amount from the pool to this swap (mock usage)
        pool.borrow(assetAmount);
        // Swap borrowed asset to target token (assumes allowance to router via pool -> swap)
        uint256 expectedOut = swapRouter.getAmountOut(address(asset), assetAmount);
        require(expectedOut > 0, "No output");
        uint256 amountOut = swapRouter.swap(address(asset), assetAmount, expectedOut);
        require(amountOut >= expectedOut, "Swap slippage");

        id = nextPositionId++;
        Position memory p = Position({
            id: id,
            sender: msg.sender,
            openAssetAmount: assetAmount,
            targetAmount: amountOut,
            openDate: block.timestamp,
            expireDate: block.timestamp + positionDuration,
            profitSharing: 0,
            closeDate: 0,
            closeAssetAmount: 0
        });
        positions[id] = p;
        positionsOf[msg.sender].push(id);
        emit OpenPosition(id, msg.sender, p.openAssetAmount, p.targetAmount, p.profitSharing);
    }

    function closePosition(uint256 id) external {
        Position memory p = positions[id];
        require(p.sender == msg.sender, "Not owner");

        positions[id].closeDate = block.timestamp;
        positions[id].closeAssetAmount = positions[id].openAssetAmount; // mock close value
        emit ClosePosition(id, positions[id].closeAssetAmount);
    }
}
