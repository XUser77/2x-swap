// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";
import {IERC4626} from "./interfaces/IERC4626.sol";

/// @title X2Pool - ERC-4626 style single contract for deposits and withdrawals
/// @notice Shares represent a pro-rata claim on pool assets; conversions adjust with gains/losses.
contract X2Pool is IERC4626 {
    // ERC20 share metadata
    string public constant name = "2x Swap Liquidity Provider Token";
    string public constant symbol = "2xLP";
    uint8 public constant decimals = 6;

    IERC20 public immutable underlying;
    address public immutable x2deployer;
    mapping(address => bool) public isSwap;
    uint256 public totalDebt;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(address asset_, address x2deployer_) {
        require(asset_ != address(0), "Asset required");
        require(x2deployer_ != address(0), "Deployer required");
        underlying = IERC20(asset_);
        x2deployer = x2deployer_;
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    function asset() external view override returns (address) {
        return address(underlying);
    }

    function totalAssets() public view override returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        return _convertToShares(assets, false);
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        return _convertToAssets(shares, false);
    }

    function previewDeposit(uint256 assets) external view override returns (uint256) {
        return _convertToShares(assets, false);
    }

    function previewMint(uint256 shares) external view override returns (uint256) {
        return _convertToAssets(shares, true);
    }

    function previewWithdraw(uint256 assets) external view override returns (uint256) {
        return _convertToShares(assets, true);
    }

    function previewRedeem(uint256 shares) external view override returns (uint256) {
        return _convertToAssets(shares, false);
    }

    function maxDeposit(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) external view override returns (uint256) {
        return _convertToAssets(balanceOf[owner], false);
    }

    function maxRedeem(address owner) external view override returns (uint256) {
        return balanceOf[owner];
    }

    /*//////////////////////////////////////////////////////////////
                             ERC20 LOGIC
    //////////////////////////////////////////////////////////////*/

    function transfer(address to, uint256 value) external override returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external override returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external override returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= value, "ERC20: transfer amount exceeds allowance");
        _transfer(from, to, value);
        unchecked {
            _approve(from, msg.sender, currentAllowance - value);
        }
        return true;
    }

    /*//////////////////////////////////////////////////////////////
                            POOL ACTIONS
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        require(assets > 0, "Zero assets");
        require(receiver != address(0), "Bad receiver");
        shares = convertToShares(assets);
        require(underlying.transferFrom(msg.sender, address(this), assets), "Asset transfer failed");
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external override returns (uint256 assets) {
        require(shares > 0, "Zero shares");
        require(receiver != address(0), "Bad receiver");
        assets = convertToAssets(shares);
        require(underlying.transferFrom(msg.sender, address(this), assets), "Asset transfer failed");
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        require(assets > 0, "Zero assets");
        require(receiver != address(0), "Bad receiver");
        require(owner != address(0), "Bad owner");
        shares = convertToShares(assets);
        if (msg.sender != owner) {
            uint256 currentAllowance = allowance[owner][msg.sender];
            require(currentAllowance >= shares, "Allowance exceeded");
            unchecked {
                _approve(owner, msg.sender, currentAllowance - shares);
            }
        }
        _burn(owner, shares);
        require(underlying.transfer(receiver, assets), "Asset transfer failed");
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external override returns (uint256 assets) {
        require(shares > 0, "Zero shares");
        require(receiver != address(0), "Bad receiver");
        require(owner != address(0), "Bad owner");
        assets = convertToAssets(shares);
        if (msg.sender != owner) {
            uint256 currentAllowance = allowance[owner][msg.sender];
            require(currentAllowance >= shares, "Allowance exceeded");
            unchecked {
                _approve(owner, msg.sender, currentAllowance - shares);
            }
        }
        _burn(owner, shares);
        require(underlying.transfer(receiver, assets), "Asset transfer failed");
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /*//////////////////////////////////////////////////////////////
                            X2SWAP ACTIONS
    //////////////////////////////////////////////////////////////*/

    function registerSwap(address swap) external {
        require(msg.sender == x2deployer, "Not deployer");
        require(swap != address(0), "Bad swap");
        isSwap[swap] = true;
    }

    /// @notice Borrow underlying to the linked X2Swap contract.
    /// @dev Only callable by the configured X2Swap.
    function borrow(uint256 amount) external {
        require(isSwap[msg.sender], "Not swap");
        require(amount > 0, "Zero amount");
        totalDebt += amount;
        require(underlying.transfer(msg.sender, amount), "Transfer failed");
    }

    /// @notice Repay borrowed underlying. Caller must transfer tokens and specify how much debt to clear.
    /// @dev Amount of tokens returned and amount of debt cleared can differ (e.g., accounting for losses).
    function returnBorrow(uint256 amount, uint256 debtRepaid) external {
        require(isSwap[msg.sender], "Not swap");
        require(debtRepaid <= totalDebt, "Exceeds debt");
        if (amount > 0) {
            require(underlying.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        }
        totalDebt -= debtRepaid;
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL HELPERS
    //////////////////////////////////////////////////////////////*/

    function _transfer(address from, address to, uint256 value) internal {
        require(from != address(0), "Transfer from zero");
        require(to != address(0), "Transfer to zero");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "Balance too low");
        unchecked {
            balanceOf[from] = fromBalance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        require(to != address(0), "Mint to zero");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        require(from != address(0), "Burn from zero");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "Burn exceeds balance");
        unchecked {
            balanceOf[from] = fromBalance - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    function _approve(address owner_, address spender, uint256 value) internal {
        require(owner_ != address(0), "Approve from zero");
        require(spender != address(0), "Approve to zero");
        allowance[owner_][spender] = value;
        emit Approval(owner_, spender, value);
    }

    // Shares reflect pro-rata claim: shares / totalSupply == assets / totalAssets
    function _convertToShares(uint256 assets, bool roundUp) internal view returns (uint256) { // TODO: Ask about roundUp potential attack!!! (yEarn case)
        uint256 supply = totalSupply;
        uint256 backing = totalAssets();
        if (supply == 0 || backing == 0) {
            return assets;
        }
        uint256 num = assets * supply;
        if (roundUp && num % backing != 0) {
            return num / backing + 1;
        }
        return num / backing;
    }

    function _convertToAssets(uint256 shares, bool roundUp) internal view returns (uint256) { // TODO: Ask about roundUp potential attack!!! (yEarn case)
        uint256 supply = totalSupply;
        uint256 backing = totalAssets();
        if (supply == 0 || backing == 0) {
            return shares;
        }
        uint256 num = shares * backing;
        if (roundUp && num % supply != 0) {
            return num / supply + 1;
        }
        return num / supply;
    }
}
