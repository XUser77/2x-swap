// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title X2ETH ERC20 token
/// @notice ERC20 token with zero initial supply and a configurable minter for external liquidity contracts.
contract LPToken {
    // ERC20 metadata
    string public name;
    string public symbol;
    uint8 public decimals;

    address public minter;

    // Total token supply in the smallest unit (wei-style for ERC20)
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterUpdated(address indexed newMinter);

    /// @param minter_ Address allowed to mint tokens
    /// @param name_ Token name
    /// @param symbol_ Token symbol
    /// @param decimals_ Token decimals
    constructor(address minter_, string memory name_, string memory symbol_, uint8 decimals_) {
        require(minter_ != address(0), "Minter required");
        minter = minter_;
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        emit MinterUpdated(minter_);
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "Not minter");
        _;
    }

    /// @notice Transfer tokens to another address
    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /// @notice Approve a spender to spend tokens on behalf of the caller
    function approve(address spender, uint256 value) external returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    /// @notice Transfer tokens using an allowance
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= value, "ERC20: transfer amount exceeds allowance");
        _transfer(from, to, value);
        _approve(from, msg.sender, currentAllowance - value);
        return true;
    }

    /// @notice Increase allowance without resetting it to zero first
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        _approve(msg.sender, spender, allowance[msg.sender][spender] + addedValue);
        return true;
    }

    /// @notice Decrease allowance, reverting if it would go below zero
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 currentAllowance = allowance[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        _approve(msg.sender, spender, currentAllowance - subtractedValue);
        return true;
    }

    /// @notice Mint new tokens to a recipient (restricted to minter)
    function mint(address to, uint256 value) external onlyMinter returns (bool) {
        _mint(to, value);
        return true;
    }

    /// @notice Set a new minter address
    function setMinter(address newMinter) external onlyMinter {
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    /// @notice Burn tokens from an account (restricted to minter)
    function burn(address from, uint256 value) external onlyMinter returns (bool) {
        require(from != address(0), "ERC20: burn from zero");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "ERC20: burn exceeds balance");

        unchecked {
            balanceOf[from] = fromBalance - value;
            totalSupply -= value;
        }

        emit Transfer(from, address(0), value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "ERC20: transfer amount exceeds balance");

        unchecked {
            balanceOf[from] = fromBalance - value;
            balanceOf[to] += value;
        }

        emit Transfer(from, to, value);
    }

    function _mint(address account, uint256 value) internal {
        require(account != address(0), "ERC20: mint to the zero address");

        totalSupply += value;
        balanceOf[account] += value;
        emit Transfer(address(0), account, value);
    }

    function _approve(address owner_, address spender, uint256 value) internal {
        require(owner_ != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        allowance[owner_][spender] = value;
        emit Approval(owner_, spender, value);
    }
}
