// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LPToken.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC20Metadata is IERC20Minimal {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @title Liquidity pool for collateral-backed X2Token minting
/// @notice Accepts source token deposits and mints a freshly deployed X2Token to the sender.
contract LiquidityPool {
    LPToken public immutable lpToken;
    IERC20Metadata public immutable sourceToken;
    IERC20Metadata public immutable targetToken;

    event Deposited(address indexed user, uint256 sourceAmount, uint256 tokensMinted);
    event Withdrawn(address indexed user, uint256 sourceAmount, uint256 tokensBurned);

    constructor(
        address sourceTokenAddress,
        address targetTokenAddress,
        string memory tokenName,
        string memory tokenSymbol
    ) {
        require(sourceTokenAddress != address(0), "Source required");
        require(targetTokenAddress != address(0), "Target required");
        sourceToken = IERC20Metadata(sourceTokenAddress);
        targetToken = IERC20Metadata(targetTokenAddress);

        uint8 decimals = sourceToken.decimals();

        lpToken = new LPToken(address(this), tokenName, tokenSymbol, decimals);
    }

    /// @notice Deposit source token and receive newly minted X2Token.
    /// @dev Caller must approve this contract to spend `sourceAmount` before calling.
    function deposit(uint256 sourceAmount) public returns (uint256 minted) {
        require(sourceAmount > 0, "No source sent");
        minted = sourceAmount; // 1:1 with source token units (decimals aligned at deployment)
        require(sourceToken.transferFrom(msg.sender, address(this), sourceAmount), "Source transfer failed");
        lpToken.mint(msg.sender, minted);
        emit Deposited(msg.sender, sourceAmount, minted);
    }

    /// @notice Redeem X2Token for source token by burning tokens.
    /// @param tokenAmount Amount of X2Token (token decimals) to burn.
    /// @return sourceAmount Amount of source token sent to caller (1:1 with token units).
    function withdraw(uint256 tokenAmount) external returns (uint256 sourceAmount) {
        require(tokenAmount > 0, "Amount zero");

        sourceAmount = tokenAmount; // 1:1 with minted units
        require(sourceAmount > 0, "Amount too small");
        lpToken.burn(msg.sender, tokenAmount);
        require(sourceToken.transfer(msg.sender, sourceAmount), "Source transfer failed");

        emit Withdrawn(msg.sender, sourceAmount, tokenAmount);
    }
}
