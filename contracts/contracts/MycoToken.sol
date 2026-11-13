// SPDX-License-Identifier: MIT
// $MYCO — BEP-20 reward token for MYCO (mushroom forest spirits).
// Economics (user-confirmed 2026-11-13, rescaled to the 3,333 NFT supply):
//   Total supply 3,333,000 $MYCO (18 decimals), fixed at deploy —
//   NO further minting ever. Rewards pool 1,800,000 $MYCO is held by this
//   token contract itself; the remaining 1,533,000 $MYCO is minted to the
//   owner at deploy (treasury — owner-controlled, not part of the pool).
//   $MYCO is NOT paid per mint. It is earned AFTER mint, by the scheme
//   contracts that deploy later (Mining / Burn / Node), which call
//   accrue() to record rewards for a wallet:
//   Mining 1-5 $MYCO/day by rarity, Burn 50-500 $MYCO, Node 5/15/40
//   $MYCO/day. The owner points accrual at each scheme contract with
//   setMinter(address, bool) when that scheme deploys.
//   accrue() enforces the pool cap (total accrued can never exceed
//   1,800,000). There is NO per-wallet cap — rewards accrue over time.
//   Claims are retroactive: claim() pays the caller's claimable balance;
//   claimFor(address) pays a beneficiary's claimable balance and can be
//   called by any wallet (e.g. an agent claiming for its user).
//   claimable(address) shows what is waiting. No staking, no tax, no
//   pausing, no blacklist — plain ERC-20 + accrual ledger.
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MYCO
contract MycoToken is ERC20, Ownable {
    uint256 public constant REWARDS_POOL = 1_800_000 ether; // held by this contract
    uint256 public constant TREASURY = 1_533_000 ether; // minted to owner at deploy

    mapping(address => bool) public minters; // scheme contracts allowed to accrue
    uint256 public totalAccrued; // sum of all accrue() amounts; never exceeds REWARDS_POOL

    mapping(address => uint256) public accrued; // lifetime rewards earned
    mapping(address => uint256) public claimed; // lifetime rewards claimed

    event Accrued(address indexed wallet, uint256 amount, uint256 totalAccruedForWallet);
    event Claimed(address indexed wallet, uint256 amount);
    event MinterSet(address indexed minter, bool allowed);

    error NotMinter();
    error NothingToClaim();
    error OverPoolCap();

    constructor(address owner_) ERC20("MYCO", "MYCO") Ownable(owner_) {
        // Pool stays in this contract for claims; remainder goes to the owner.
        _mint(address(this), REWARDS_POOL);
        _mint(owner_, TREASURY);
    }

    /// @notice Claimable $MYCO for a wallet (accrued minus already claimed).
    function claimable(address wallet) public view returns (uint256) {
        return accrued[wallet] - claimed[wallet];
    }

    /// @notice Record a reward for a wallet. Only an approved scheme contract can call this.
    function accrue(address wallet, uint256 amount) external {
        if (!minters[msg.sender]) revert NotMinter();
        if (totalAccrued + amount > REWARDS_POOL) revert OverPoolCap();
        accrued[wallet] += amount;
        totalAccrued += amount;
        emit Accrued(wallet, amount, accrued[wallet]);
    }

    /// @notice Claim your own waiting $MYCO.
    function claim() external {
        _claim(msg.sender);
    }

    /// @notice Claim a beneficiary's waiting $MYCO to that beneficiary. Callable by anyone.
    function claimFor(address beneficiary) external {
        _claim(beneficiary);
    }

    function _claim(address wallet) internal {
        uint256 amount = claimable(wallet);
        if (amount == 0) revert NothingToClaim();
        claimed[wallet] += amount;
        _transfer(address(this), wallet, amount);
        emit Claimed(wallet, amount);
    }

    /// @notice Allow (or revoke) a scheme contract to accrue rewards. Owner only.
    function setMinter(address minter_, bool allowed) external onlyOwner {
        minters[minter_] = allowed;
        emit MinterSet(minter_, allowed);
    }
}
