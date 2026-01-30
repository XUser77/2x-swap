const { expect } = require("chai");
const hre = require("hardhat");

describe("FeeGovernance", function () {
  let feeGov;
  let deployer, gov1, gov2, gov3, gov4, withdrawer1, withdrawer2, nonGov;

  beforeEach(async function () {
    [deployer, gov1, gov2, gov3, gov4, withdrawer1, withdrawer2, nonGov] = await hre.ethers.getSigners();
    
    const FeeGovernance = await hre.ethers.getContractFactory("FeeGovernance");
    feeGov = await FeeGovernance.deploy([gov1.address, gov2.address, gov3.address]);
  });

  describe("Deployment", function () {
    it("Should initialize with correct governor count", async function () {
      expect(await feeGov.governorCount()).to.equal(3);
    });

    it("Should set correct threshold (more than half)", async function () {
      const threshold = await feeGov.threshold();
      expect(threshold).to.equal(2); // (3/2) + 1 = 2
    });

    it("Should mark governors correctly", async function () {
      expect(await feeGov.isGovernor(gov1.address)).to.equal(true);
      expect(await feeGov.isGovernor(gov2.address)).to.equal(true);
      expect(await feeGov.isGovernor(gov3.address)).to.equal(true);
      expect(await feeGov.isGovernor(nonGov.address)).to.equal(false);
    });

    it("Should reject deployment with < 3 governors", async function () {
      const FeeGovernance = await hre.ethers.getContractFactory("FeeGovernance");
      await expect(
        FeeGovernance.deploy([gov1.address, gov2.address])
      ).to.be.revertedWith("Min 3 governors");
    });

    it("Should reject deployment with duplicate governors", async function () {
      const FeeGovernance = await hre.ethers.getContractFactory("FeeGovernance");
      await expect(
        FeeGovernance.deploy([gov1.address, gov2.address, gov1.address])
      ).to.be.revertedWith("Duplicate governor");
    });

    it("Should reject deployment with zero address governor", async function () {
      const FeeGovernance = await hre.ethers.getContractFactory("FeeGovernance");
      await expect(
        FeeGovernance.deploy([gov1.address, gov2.address, hre.ethers.ZeroAddress])
      ).to.be.revertedWith("Bad governor");
    });

    it("Should start unpaused", async function () {
      expect(await feeGov.isPaused()).to.equal(false);
    });
  });

  describe("Add Withdrawer Proposal", function () {
    it("Should allow governor to propose add withdrawer", async function () {
      const proposalId = await feeGov.connect(gov1).proposeAddWithdrawer.staticCall(withdrawer1.address);
      await feeGov.connect(gov1).proposeAddWithdrawer(withdrawer1.address);
      
      const proposal = await feeGov.proposals(proposalId);
      expect(proposal.target).to.equal(withdrawer1.address);
      expect(proposal.approvals).to.equal(0);
      expect(proposal.executed).to.equal(false);
    });

    it("Should reject non-governor proposing", async function () {
      await expect(
        feeGov.connect(nonGov).proposeAddWithdrawer(withdrawer1.address)
      ).to.be.revertedWith("Not governor");
    });

    it("Should reject zero address withdrawer", async function () {
      await expect(
        feeGov.connect(gov1).proposeAddWithdrawer(hre.ethers.ZeroAddress)
      ).to.be.revertedWith("Bad withdrawer");
    });

    it("Should reject adding existing withdrawer", async function () {
      // First add a withdrawer
      const proposalId = await feeGov.connect(gov1).proposeAddWithdrawer.staticCall(withdrawer1.address);
      await feeGov.connect(gov1).proposeAddWithdrawer(withdrawer1.address);
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      await feeGov.connect(gov1).execute(proposalId);
      
      // Try to add again
      await expect(
        feeGov.connect(gov1).proposeAddWithdrawer(withdrawer1.address)
      ).to.be.revertedWith("Already withdrawer");
    });
  });

  describe("Remove Withdrawer Proposal", function () {
    beforeEach(async function () {
      // Add a withdrawer first
      const proposalId = await feeGov.connect(gov1).proposeAddWithdrawer.staticCall(withdrawer1.address);
      await feeGov.connect(gov1).proposeAddWithdrawer(withdrawer1.address);
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      await feeGov.connect(gov1).execute(proposalId);
    });

    it("Should allow governor to propose remove withdrawer", async function () {
      const proposalId = await feeGov.connect(gov1).proposeRemoveWithdrawer.staticCall(withdrawer1.address);
      await feeGov.connect(gov1).proposeRemoveWithdrawer(withdrawer1.address);
      
      const proposal = await feeGov.proposals(proposalId);
      expect(proposal.target).to.equal(withdrawer1.address);
    });

    it("Should reject removing non-existent withdrawer", async function () {
      await expect(
        feeGov.connect(gov1).proposeRemoveWithdrawer(withdrawer2.address)
      ).to.be.revertedWith("Not withdrawer");
    });
  });

  describe("Add Governor Proposal", function () {
    it("Should allow governor to propose add governor", async function () {
      const proposalId = await feeGov.connect(gov1).proposeAddGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeAddGovernor(gov4.address);
      
      const proposal = await feeGov.proposals(proposalId);
      expect(proposal.target).to.equal(gov4.address);
    });

    it("Should reject adding existing governor", async function () {
      await expect(
        feeGov.connect(gov1).proposeAddGovernor(gov2.address)
      ).to.be.revertedWith("Already governor");
    });

    it("Should reject zero address governor", async function () {
      await expect(
        feeGov.connect(gov1).proposeAddGovernor(hre.ethers.ZeroAddress)
      ).to.be.revertedWith("Bad governor");
    });
  });

  describe("Remove Governor Proposal", function () {
    it("Should allow proposing to remove governor when > 3 exist", async function () {
      // First add a 4th governor
      const addProposalId = await feeGov.connect(gov1).proposeAddGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeAddGovernor(gov4.address);
      await feeGov.connect(gov1).vote(addProposalId);
      await feeGov.connect(gov2).vote(addProposalId);
      await feeGov.connect(gov1).execute(addProposalId);
      
      // Now we have 4 governors, can propose removing one
      const removeProposalId = await feeGov.connect(gov1).proposeRemoveGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeRemoveGovernor(gov4.address);
      
      const proposal = await feeGov.proposals(removeProposalId);
      expect(proposal.target).to.equal(gov4.address);
    });

    it("Should reject removing governor when only 3 exist", async function () {
      await expect(
        feeGov.connect(gov1).proposeRemoveGovernor(gov3.address)
      ).to.be.revertedWith("Min 3 governors");
    });

    it("Should reject removing non-existent governor", async function () {
      await expect(
        feeGov.connect(gov1).proposeRemoveGovernor(nonGov.address)
      ).to.be.revertedWith("Not governor");
    });
  });

  describe("Pause/Unpause Proposals", function () {
    it("Should allow proposing pause when not paused", async function () {
      const proposalId = await feeGov.connect(gov1).proposePause.staticCall();
      await feeGov.connect(gov1).proposePause();
      
      const proposal = await feeGov.proposals(proposalId);
      expect(proposal.executed).to.equal(false);
    });

    it("Should reject proposing pause when already paused", async function () {
      // First pause
      const proposalId = await feeGov.connect(gov1).proposePause.staticCall();
      await feeGov.connect(gov1).proposePause();
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      await feeGov.connect(gov1).execute(proposalId);
      
      // Try to propose pause again
      await expect(
        feeGov.connect(gov1).proposePause()
      ).to.be.revertedWith("Already paused");
    });

    it("Should allow proposing unpause when paused", async function () {
      // First pause
      const pauseProposalId = await feeGov.connect(gov1).proposePause.staticCall();
      await feeGov.connect(gov1).proposePause();
      await feeGov.connect(gov1).vote(pauseProposalId);
      await feeGov.connect(gov2).vote(pauseProposalId);
      await feeGov.connect(gov1).execute(pauseProposalId);
      
      // Now propose unpause
      const unpauseProposalId = await feeGov.connect(gov1).proposeUnpause.staticCall();
      await feeGov.connect(gov1).proposeUnpause();
      
      const proposal = await feeGov.proposals(unpauseProposalId);
      expect(proposal.executed).to.equal(false);
    });

    it("Should reject proposing unpause when not paused", async function () {
      await expect(
        feeGov.connect(gov1).proposeUnpause()
      ).to.be.revertedWith("Not paused");
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      proposalId = await feeGov.connect(gov1).proposeAddWithdrawer.staticCall(withdrawer1.address);
      await feeGov.connect(gov1).proposeAddWithdrawer(withdrawer1.address);
    });

    it("Should allow governor to vote on proposal", async function () {
      await feeGov.connect(gov1).vote(proposalId);
      
      const proposal = await feeGov.proposals(proposalId);
      expect(proposal.approvals).to.equal(1);
    });

    it("Should reject non-governor voting", async function () {
      await expect(
        feeGov.connect(nonGov).vote(proposalId)
      ).to.be.revertedWith("Not governor");
    });

    it("Should reject voting twice on same proposal", async function () {
      await feeGov.connect(gov1).vote(proposalId);
      
      await expect(
        feeGov.connect(gov1).vote(proposalId)
      ).to.be.revertedWith("Already voted");
    });

    it("Should reject voting on non-existent proposal", async function () {
      await expect(
        feeGov.connect(gov1).vote(999)
      ).to.be.revertedWith("No proposal");
    });

    it("Should accumulate votes from multiple governors", async function () {
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      
      const proposal = await feeGov.proposals(proposalId);
      expect(proposal.approvals).to.equal(2);
    });
  });

  describe("Execution", function () {
    let proposalId;

    beforeEach(async function () {
      proposalId = await feeGov.connect(gov1).proposeAddWithdrawer.staticCall(withdrawer1.address);
      await feeGov.connect(gov1).proposeAddWithdrawer(withdrawer1.address);
    });

    it("Should execute proposal with enough votes", async function () {
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      
      await feeGov.connect(gov1).execute(proposalId);
      
      const proposal = await feeGov.proposals(proposalId);
      expect(proposal.executed).to.equal(true);
      expect(await feeGov.isWithdrawer(withdrawer1.address)).to.equal(true);
    });

    it("Should reject execution without enough votes", async function () {
      await feeGov.connect(gov1).vote(proposalId);
      // Only 1 vote, need 2
      
      await expect(
        feeGov.connect(gov1).execute(proposalId)
      ).to.be.revertedWith("Not enough votes");
    });

    it("Should reject executing twice", async function () {
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      await feeGov.connect(gov1).execute(proposalId);
      
      await expect(
        feeGov.connect(gov1).execute(proposalId)
      ).to.be.revertedWith("Executed");
    });

    it("Should reject non-governor executing", async function () {
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      
      await expect(
        feeGov.connect(nonGov).execute(proposalId)
      ).to.be.revertedWith("Not governor");
    });
  });

  describe("Full Governance Flow", function () {
    it("Should complete full add withdrawer flow", async function () {
      // 1. Propose
      const proposalId = await feeGov.connect(gov1).proposeAddWithdrawer.staticCall(withdrawer1.address);
      await feeGov.connect(gov1).proposeAddWithdrawer(withdrawer1.address);
      
      expect(await feeGov.isWithdrawer(withdrawer1.address)).to.equal(false);
      
      // 2. Vote (need 2 votes for threshold)
      await feeGov.connect(gov1).vote(proposalId);
      await feeGov.connect(gov2).vote(proposalId);
      
      // 3. Execute
      await feeGov.connect(gov3).execute(proposalId);
      
      expect(await feeGov.isWithdrawer(withdrawer1.address)).to.equal(true);
    });

    it("Should complete full pause/unpause flow", async function () {
      // Pause
      const pauseId = await feeGov.connect(gov1).proposePause.staticCall();
      await feeGov.connect(gov1).proposePause();
      await feeGov.connect(gov1).vote(pauseId);
      await feeGov.connect(gov2).vote(pauseId);
      await feeGov.connect(gov1).execute(pauseId);
      
      expect(await feeGov.isPaused()).to.equal(true);
      
      // Unpause
      const unpauseId = await feeGov.connect(gov1).proposeUnpause.staticCall();
      await feeGov.connect(gov1).proposeUnpause();
      await feeGov.connect(gov1).vote(unpauseId);
      await feeGov.connect(gov2).vote(unpauseId);
      await feeGov.connect(gov1).execute(unpauseId);
      
      expect(await feeGov.isPaused()).to.equal(false);
    });

    it("Should complete full add/remove governor flow", async function () {
      // Add 4th governor
      const addId = await feeGov.connect(gov1).proposeAddGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeAddGovernor(gov4.address);
      await feeGov.connect(gov1).vote(addId);
      await feeGov.connect(gov2).vote(addId);
      await feeGov.connect(gov1).execute(addId);
      
      expect(await feeGov.isGovernor(gov4.address)).to.equal(true);
      expect(await feeGov.governorCount()).to.equal(4);
      expect(await feeGov.threshold()).to.equal(3); // (4/2) + 1 = 3
      
      // Remove governor
      const removeId = await feeGov.connect(gov1).proposeRemoveGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeRemoveGovernor(gov4.address);
      await feeGov.connect(gov1).vote(removeId);
      await feeGov.connect(gov2).vote(removeId);
      await feeGov.connect(gov3).vote(removeId);
      await feeGov.connect(gov1).execute(removeId);
      
      expect(await feeGov.isGovernor(gov4.address)).to.equal(false);
      expect(await feeGov.governorCount()).to.equal(3);
      expect(await feeGov.threshold()).to.equal(2); // (3/2) + 1 = 2
    });
  });

  describe("Threshold Calculations", function () {
    it("Should calculate correct threshold for 3 governors", async function () {
      // 3 governors -> (3/2) + 1 = 2
      expect(await feeGov.threshold()).to.equal(2);
    });

    it("Should calculate correct threshold for 5 governors", async function () {
      const FeeGovernance = await hre.ethers.getContractFactory("FeeGovernance");
      const feeGov5 = await FeeGovernance.deploy([
        gov1.address, gov2.address, gov3.address, gov4.address, deployer.address
      ]);
      
      // 5 governors -> (5/2) + 1 = 3
      expect(await feeGov5.threshold()).to.equal(3);
    });

    it("Should update threshold when adding governor", async function () {
      const addId = await feeGov.connect(gov1).proposeAddGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeAddGovernor(gov4.address);
      await feeGov.connect(gov1).vote(addId);
      await feeGov.connect(gov2).vote(addId);
      await feeGov.connect(gov1).execute(addId);
      
      // 4 governors -> (4/2) + 1 = 3
      expect(await feeGov.threshold()).to.equal(3);
    });

    it("Should update threshold when removing governor", async function () {
      // First add to have 4
      const addId = await feeGov.connect(gov1).proposeAddGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeAddGovernor(gov4.address);
      await feeGov.connect(gov1).vote(addId);
      await feeGov.connect(gov2).vote(addId);
      await feeGov.connect(gov1).execute(addId);
      
      expect(await feeGov.threshold()).to.equal(3);
      
      // Remove to have 3 again
      const removeId = await feeGov.connect(gov1).proposeRemoveGovernor.staticCall(gov4.address);
      await feeGov.connect(gov1).proposeRemoveGovernor(gov4.address);
      await feeGov.connect(gov1).vote(removeId);
      await feeGov.connect(gov2).vote(removeId);
      await feeGov.connect(gov3).vote(removeId);
      await feeGov.connect(gov1).execute(removeId);
      
      expect(await feeGov.threshold()).to.equal(2);
    });
  });
});
