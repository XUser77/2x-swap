// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {FeeGovernance} from "./FeeGovernance.sol";
import {IERC20Extended} from "./interfaces/IERC20Extended.sol";

/// @title X2Pool - ERC-4626 style single contract for deposits and withdrawals
/// @notice Shares represent a pro-rata claim on pool assets; conversions adjust with gains/losses.
contract X2Pool is ERC4626, ReentrancyGuard {

    using SafeERC20 for IERC20;

    FeeGovernance public immutable feeGovernance;
    address public immutable x2deployer;
    mapping(address => bool) public isSwap;
    uint256 public totalDebt;
    
    // Protection against first depositor attack (1 token minimum)
    uint256 public immutable MIN_DEPOSIT;
    
    // Protection against pool insolvency (mathematical constants)
    uint256 public constant MAX_UTILIZATION_BPS = 9500; // 95% maximum utilization
    
    // Maximum pool size (10M tokens)
    uint256 public immutable MAX_POOL_SIZE;
    
    // Minimum liquidity for borrow (10 tokens)
    uint256 public immutable MIN_BORROW_LIQUIDITY;
    
    // Events for critical operations
    event Borrow(
        address indexed swap,
        uint256 amount,
        uint256 newDebt,
        uint256 totalAssets,
        uint256 utilizationBps
    );
    
    event ReturnBorrow(
        address indexed swap,
        uint256 amountReturned,
        uint256 debtRepaid,
        uint256 newDebt,
        uint256 totalAssets,
        uint256 utilizationBps
    );
    
    event SwapRegistered(address indexed swap);
    
    event PartialWithdraw(
        address indexed owner,
        address indexed receiver,
        uint256 requested,
        uint256 actual
    );
    
    event PartialRedeem(
        address indexed owner,
        address indexed receiver,
        uint256 requestedShares,
        uint256 actualShares,
        uint256 assets
    );

    constructor(address asset_, address x2deployer_, address feeGovernance_)
        ERC4626(IERC20(asset_)) ERC20("2x Swap Liquidity Provider Token", "2xLP") {

        require(asset_ != address(0), "Asset required");
        require(x2deployer_ != address(0), "Deployer required");
        require(feeGovernance_ != address(0), "Governance required");
        
        x2deployer = x2deployer_;
        feeGovernance = FeeGovernance(feeGovernance_);
        
        // Set limits based on token decimals (adaptive to any token)
        uint8 decimals_ = IERC20Extended(asset_).decimals();
        uint256 oneToken = 10 ** decimals_;
        
        MIN_DEPOSIT = oneToken;                    // 1 token minimum deposit
        MAX_POOL_SIZE = 10_000_000 * oneToken;     // 10M tokens maximum pool size
        MIN_BORROW_LIQUIDITY = 10 * oneToken;      // 10 tokens minimum liquidity
    }

    /*//////////////////////////////////////////////////////////////
                            CORE OVERRIDES
    //////////////////////////////////////////////////////////////*/

    /// @notice Override totalAssets to include both free and borrowed funds
    /// @dev ERC4626 by default uses balanceOf, but we need to track total capital (free + debt)
    /// @return Total assets under management (balance + debt)
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalDebt;
    }

    /*//////////////////////////////////////////////////////////////
                            POOL ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit assets with security checks
    /// @dev Includes MIN_DEPOSIT check and fee-on-transfer detection
    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256 shares) {
        require(!feeGovernance.isPaused(), "Protocol emergency paused");
        require(assets >= MIN_DEPOSIT, "Deposit amount too small");
        
        // Check maximum pool size
        uint256 newTotalAssets = totalAssets() + assets;
        require(newTotalAssets <= MAX_POOL_SIZE, "Pool size limit exceeded");

        uint256 balanceBefore = IERC20(asset()).balanceOf(address(this));
        shares = super.deposit(assets, receiver);
        uint256 balanceAfter = IERC20(asset()).balanceOf(address(this));
        require(balanceAfter - balanceBefore == assets, "Fee detected");

        return shares;
    }

    /// @notice Mint shares with security checks
    /// @dev Includes MIN_DEPOSIT check and fee-on-transfer detection
    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256 assets) {
        require(!feeGovernance.isPaused(), "Protocol emergency paused");
        assets = previewMint(shares);
        require(assets >= MIN_DEPOSIT, "Deposit amount too small");
        
        // Check maximum pool size
        uint256 newTotalAssets = totalAssets() + assets;
        require(newTotalAssets <= MAX_POOL_SIZE, "Pool size limit exceeded");

        uint256 balanceBefore = IERC20(asset()).balanceOf(address(this));
        assets = super.mint(shares, receiver);
        uint256 balanceAfter = IERC20(asset()).balanceOf(address(this));
        require(balanceAfter - balanceBefore == assets, "Fee detected");

        return assets;
    }

    /// @notice Withdraw assets with partial fulfillment if insufficient liquidity
    /// @dev Returns available liquidity if requested amount exceeds free balance
    function withdraw(uint256 assets, address receiver, address owner) 
        public 
        override 
        nonReentrant 
        returns (uint256 shares) 
    {
        require(assets > 0, "Zero amount");
        
        // Get available liquidity (free balance)
        uint256 available = IERC20(asset()).balanceOf(address(this));
        
        // Withdraw what we can (minimum of requested and available)
        uint256 actualWithdraw = assets > available ? available : assets;
        
        // Emit event if partial withdrawal
        if (actualWithdraw < assets) {
            emit PartialWithdraw(owner, receiver, assets, actualWithdraw);
        }
        
        // Use standard ERC4626 withdraw for the actual amount
        return super.withdraw(actualWithdraw, receiver, owner);
    }

    /// @notice Redeem shares with partial fulfillment if insufficient liquidity
    /// @dev Returns available liquidity if share value exceeds free balance
    function redeem(uint256 shares, address receiver, address owner) 
        public 
        override 
        nonReentrant 
        returns (uint256 assets) 
    {
        require(shares > 0, "Zero shares");
        
        // Calculate how many assets these shares represent
        uint256 requestedAssets = previewRedeem(shares);
        
        // Get available liquidity (free balance)
        uint256 available = IERC20(asset()).balanceOf(address(this));
        
        if (requestedAssets > available) {
            // Partial redemption: calculate how many shares we can redeem
            // shares_to_redeem = (available * totalShares) / totalAssets
            uint256 totalShares = totalSupply();
            uint256 _totalAssets = totalAssets();
            uint256 sharesToRedeem = (available * totalShares) / _totalAssets;
            
            emit PartialRedeem(owner, receiver, shares, sharesToRedeem, available);
            
            // Redeem only what we can
            return super.redeem(sharesToRedeem, receiver, owner);
        }
        
        // Full redemption possible
        return super.redeem(shares, receiver, owner);
    }

    /*//////////////////////////////////////////////////////////////
                            X2SWAP ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Register a new swap contract
    /// @dev Only callable by deployer
    function registerSwap(address swap) external {
        require(msg.sender == x2deployer, "Not deployer");
        require(swap != address(0), "Bad swap");
        isSwap[swap] = true;
        emit SwapRegistered(swap);
    }

    /// @notice Borrow underlying to the linked X2Swap contract with security checks
    /// @dev Only callable by the configured X2Swap, includes utilization checks
    function borrow(uint256 amount) external nonReentrant {
        require(isSwap[msg.sender], "Not swap");
        require(!feeGovernance.isPaused(), "Protocol emergency paused");
        require(amount > 0, "Zero amount");
        
        uint256 _totalAssets = totalAssets();
        uint256 newDebt = totalDebt + amount;
        
        // Check sufficient liquidity
        require(_totalAssets >= amount, "Insufficient pool liquidity");
        require(_totalAssets - amount >= MIN_BORROW_LIQUIDITY, "Below min liquidity");
        
        // Check maximum utilization
        uint256 total = _totalAssets + newDebt;
        uint256 newUtilizationBps = total > 0 ? (newDebt * 10_000) / total : 0;
        require(newUtilizationBps <= MAX_UTILIZATION_BPS, "Max utilization exceeded");
        
        totalDebt += amount;
        
        // Emit event with full information
        emit Borrow(msg.sender, amount, totalDebt, _totalAssets, newUtilizationBps);
        
        IERC20(asset()).safeTransfer(msg.sender, amount);
    }

    /// @notice Return borrowed funds to the pool with validation
    /// @dev Includes parameter consistency checks and utilization tracking
    /// @dev Allows debtRepaid > amount in loss scenarios (pool absorbs losses)
    function returnBorrow(uint256 amount, uint256 debtRepaid) external nonReentrant {
        require(isSwap[msg.sender], "Not swap");
        require(debtRepaid <= totalDebt, "Exceeds debt");

        // Transfer tokens if amount > 0
        if (amount > 0) {
            IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            // H-11: Cannot clear debt without returning tokens
            require(debtRepaid == 0, "Cannot clear debt without returning tokens");
        }
        
        totalDebt -= debtRepaid;
        
        // Calculate state for event
        uint256 _totalAssets = totalAssets();
        uint256 total = _totalAssets + totalDebt;
        uint256 utilizationBps = total > 0 ? (totalDebt * 10_000) / total : 0;
        
        // Emit event with full information
        emit ReturnBorrow(msg.sender, amount, debtRepaid, totalDebt, _totalAssets, utilizationBps);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Get current utilization rate in basis points
    /// @return Utilization rate (0-10000 = 0%-100%)
    function currentUtilizationBps() external view returns (uint256) {
        uint256 _totalAssets = totalAssets();
        uint256 total = _totalAssets + totalDebt;
        return total > 0 ? (totalDebt * 10_000) / total : 0;
    }

    /// @notice Get available liquidity (free balance not currently borrowed)
    /// @return Available assets for withdrawal or borrowing
    function availableLiquidity() external view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @notice Get maximum withdrawable amount for given shares
    /// @dev Accounts for available liquidity constraints
    /// @param shares Amount of shares to check
    /// @return Maximum assets that can be withdrawn
    function maxWithdrawForShares(uint256 shares) external view returns (uint256) {
        uint256 requestedAssets = previewRedeem(shares);
        uint256 available = IERC20(asset()).balanceOf(address(this));
        return requestedAssets > available ? available : requestedAssets;
    }
}
