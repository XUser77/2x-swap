// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum GovernanceAction {
    AddWithdrawer,
    RemoveWithdrawer,
    AddGovernor,
    RemoveGovernor
}

struct GovernanceProposal {
    GovernanceAction action;
    address target;
    uint256 approvals;
    bool executed;
}

