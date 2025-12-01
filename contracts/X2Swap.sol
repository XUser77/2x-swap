// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {X2Pool} from "./X2Pool.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Position} from "./structs/Position.sol";

/// @title X2Swap - factory wrapper that deploys an X2Pool
/// @notice Deploys a fresh X2Pool in the constructor and exposes its address.
contract X2Swap {
    X2Pool public immutable pool;
    IERC20 public immutable asset;
    IERC20 public immutable targetToken;
    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) public positionsOf;

    event OpenPosition(uint256 indexed id, address indexed sender, uint256 assetAmount, uint256 targetAmount, uint256 profitSharing);
    event ClosePosition(uint256 indexed id, uint256 closeAssetAmount);

    constructor(address asset_, address targetToken_, string memory name, string memory symbol) {
        pool = new X2Pool(asset_, targetToken_, name, symbol);
        asset = IERC20(asset_);
        targetToken = IERC20(targetToken_);
    }

    function openPosition() external returns (uint256 id) {
        id = nextPositionId++;
        Position memory p = Position({
            id: id,
            sender: msg.sender,
            assetAmount: 1e6,
            targetAmount: 1e6,
            openDate: block.timestamp,
            profitSharing: 0
        });
        positions[id] = p;
        positionsOf[msg.sender].push(id);
        emit OpenPosition(id, msg.sender, p.assetAmount, p.targetAmount, p.profitSharing);
    }

    function closePosition(uint256 id) external {
        Position memory p = positions[id];
        require(p.sender == msg.sender, "Not owner");

        positions[id].closeDate = block.timestamp;
        positions[id].closeAssetAmount = positions[id].assetAmount; // mock close value
        emit ClosePosition(id, positions[id].closeAssetAmount);
    }
}
