// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GovernanceProposal, GovernanceAction} from "./structs/GovernanceProposal.sol";

/// @title FeeGovernance
/// @notice 3-of-5 governor multisig for managing fee withdrawal addresses and pulling fees from X2Swap.
contract FeeGovernance {
    uint256 public governorCount;
    uint256 public threshold;

    address[] public governors;
    mapping(address => bool) public isGovernor;

    mapping(address => bool) public isWithdrawer;

    uint256 public nextProposalId;
    mapping(uint256 => GovernanceProposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public voted;

    // events removed

    modifier onlyGovernor() {
        require(isGovernor[msg.sender], "Not governor");
        _;
    }

    constructor(address[] memory governors_) {
        require(governors_.length >= 3, "Min 3 governors");
        for (uint256 i = 0; i < governors_.length; i++) {
            address g = governors_[i];
            require(g != address(0), "Bad governor");
            require(!isGovernor[g], "Duplicate governor");
            governors.push(g);
            isGovernor[g] = true;
        }
        _recomputeThreshold();
    }

    function _recomputeThreshold() internal {
        governorCount = governors.length;
        require(governorCount >= 3, "Min 3 governors");
        threshold = (governorCount / 2) + 1; // more than half
    }

    function proposeAddWithdrawer(address withdrawer) external onlyGovernor returns (uint256 id) {
        require(withdrawer != address(0), "Bad withdrawer");
        require(!isWithdrawer[withdrawer], "Already withdrawer");
        id = nextProposalId++;
        proposals[id] = GovernanceProposal({
            action: GovernanceAction.AddWithdrawer,
            target: withdrawer,
            approvals: 0,
            executed: false
        });
    }

    function proposeRemoveWithdrawer(address withdrawer) external onlyGovernor returns (uint256 id) {
        require(withdrawer != address(0), "Bad withdrawer");
        require(isWithdrawer[withdrawer], "Not withdrawer");
        id = nextProposalId++;
        proposals[id] = GovernanceProposal({
            action: GovernanceAction.RemoveWithdrawer,
            target: withdrawer,
            approvals: 0,
            executed: false
        });
    }

    function proposeAddGovernor(address governor) external onlyGovernor returns (uint256 id) {
        require(governor != address(0), "Bad governor");
        require(!isGovernor[governor], "Already governor");
        id = nextProposalId++;
        proposals[id] = GovernanceProposal({
            action: GovernanceAction.AddGovernor,
            target: governor,
            approvals: 0,
            executed: false
        });
    }

    function proposeRemoveGovernor(address governor) external onlyGovernor returns (uint256 id) {
        require(governor != address(0), "Bad governor");
        require(isGovernor[governor], "Not governor");
        require(governors.length > 3, "Min 3 governors");
        id = nextProposalId++;
        proposals[id] = GovernanceProposal({
            action: GovernanceAction.RemoveGovernor,
            target: governor,
            approvals: 0,
            executed: false
        });
    }

    function vote(uint256 id) external onlyGovernor {
        GovernanceProposal storage p = proposals[id];
        require(p.target != address(0), "No proposal");
        require(!p.executed, "Executed");
        require(!voted[id][msg.sender], "Already voted");
        voted[id][msg.sender] = true;
        p.approvals += 1;
    }

    function execute(uint256 id) external onlyGovernor {
        GovernanceProposal storage p = proposals[id];
        require(p.target != address(0), "No proposal");
        require(!p.executed, "Executed");
        require(p.approvals >= threshold, "Not enough votes");
        p.executed = true;

        if (p.action == GovernanceAction.AddWithdrawer) {
            require(!isWithdrawer[p.target], "Already withdrawer");
            isWithdrawer[p.target] = true;
            return;
        }
        if (p.action == GovernanceAction.RemoveWithdrawer) {
            require(isWithdrawer[p.target], "Not withdrawer");
            isWithdrawer[p.target] = false;
            return;
        }
        if (p.action == GovernanceAction.AddGovernor) {
            require(p.target != address(0), "Bad governor");
            require(!isGovernor[p.target], "Already governor");
            governors.push(p.target);
            isGovernor[p.target] = true;
            _recomputeThreshold();
            return;
        }

        // RemoveGovernor
        require(isGovernor[p.target], "Not governor");
        require(governors.length > 3, "Min 3 governors");
        isGovernor[p.target] = false;
        uint256 len = governors.length;
        for (uint256 i = 0; i < len; i++) {
            if (governors[i] == p.target) {
                address last = governors[len - 1];
                governors[i] = last;
                governors.pop();
                _recomputeThreshold();
                return;
            }
        }
        revert("Governor not found");
    }
}
