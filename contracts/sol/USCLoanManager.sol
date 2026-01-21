// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {LoanFlow, LoanStatus, LoanOrder, LoanTerms} from "./LoanTypes.sol";

/**
 * @title USCLoanManager
 * @dev Main contract for managing cross-chain loan orders in the USC system
 */
contract USCLoanManager is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    // State variables
    mapping(uint256 => LoanOrder) public loanOrders;
    uint256 public nextLoanId;

    // Events
    event LoanRegistered(
        uint256 indexed loanId,
        address indexed lender,
        address indexed borrower,
        uint256 loanAmount,
        uint256 repayAmount,
        uint256 deadlineBlockNumber
    );
    event LoanFunded(uint256 indexed loanId);
    event LoanRepaid(uint256 indexed loanId);
    event LoanPartiallyRepaid(uint256 indexed loanId, uint256 amount);
    event LoanExpired(uint256 indexed loanId);

    constructor() Ownable(msg.sender) {
        // Get the precompile instance using the helper library
        nextLoanId = 1;
    }

    /**
     * @dev Register a new loan order, can only be called by the contract owner
     * @param fundFlow Flow details for funding phase
     * @param repayFlow Flow details for repayment phase
     * @param loanTerms Terms of the loan
     * @param signatureOfLender Lender's signature approving the loan
     * @param signatureOfBorrower Borrower's signature approving the loan
     */
    function registerLoan(
        LoanFlow memory fundFlow,
        LoanFlow memory repayFlow,
        LoanTerms memory loanTerms,
        bytes memory signatureOfLender,
        bytes memory signatureOfBorrower
    ) external onlyOwner returns (uint256) {
        require(loanTerms.loanAmount > 0, "Loan amount must be greater than 0");
        require(loanTerms.deadlineBlockNumber > block.number, "Deadline must be in the future");
        require(loanTerms.expectedRepaymentAmount >= loanTerms.loanAmount, "Repayment amount must be >= loan amount");

        // Verify signatures
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                fundFlow.from,
                fundFlow.to,
                fundFlow.withToken,
                repayFlow.from,
                repayFlow.to,
                repayFlow.withToken,
                loanTerms.loanAmount,
                loanTerms.interestRate,
                loanTerms.expectedRepaymentAmount,
                loanTerms.deadlineBlockNumber
            )
        );

        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);

        address recoveredLender = ethSignedMessageHash.recover(signatureOfLender);
        address recoveredBorrower = ethSignedMessageHash.recover(signatureOfBorrower);

        // If the recovered addresses do not match the expected addresses, revert
        require(recoveredLender == fundFlow.from, "Invalid lender signature");
        require(recoveredBorrower == fundFlow.to, "Invalid borrower signature");

        // If all checks pass, register the loan
        uint256 loanId = nextLoanId;
        loanOrders[loanId] = LoanOrder({
            fundFlow: fundFlow,
            repayFlow: repayFlow,
            terms: loanTerms,
            signatureOfLender: signatureOfLender,
            signatureOfBorrower: signatureOfBorrower,
            createdAtBlock: block.number,
            status: LoanStatus.Created,
            repaidAmount: 0
        });

        emit LoanRegistered(
            loanId,
            fundFlow.from,
            fundFlow.to,
            loanTerms.loanAmount,
            loanTerms.expectedRepaymentAmount,
            loanTerms.deadlineBlockNumber
        );

        // Increment next loan ID
        nextLoanId += 1;

        return loanId;
    }

    /**
     * @dev Mark a loan as funded, can only be called by the contract owner
     * @param loanId ID of the loan to fund
     */
    function markLoanAsFunded(uint256 loanId) external onlyOwner {
        LoanOrder storage loan = loanOrders[loanId];
        require(loan.status == LoanStatus.Created, "Loan is not in Created status");
        require(block.number <= loan.terms.deadlineBlockNumber, "Loan has expired");

        loan.status = LoanStatus.Funded;
        emit LoanFunded(loanId);
    }

    /**
     * @dev Note a repayment for a loan, can only be called by the contract owner
     * @param loanId ID of the loan being repaid
     * @param amount Amount being repaid
     */
    function noteLoanRepayment(uint256 loanId, uint256 amount) external onlyOwner {
        LoanOrder storage loan = loanOrders[loanId];
        require(
            loan.status == LoanStatus.Funded || loan.status == LoanStatus.PartlyRepaid,
            "Invalid loan status for repayment"
        );
        require(block.number <= loan.terms.deadlineBlockNumber, "Loan has expired");

        loan.repaidAmount += amount;

        if (loan.repaidAmount >= loan.terms.expectedRepaymentAmount) {
            loan.status = LoanStatus.Repaid;
            emit LoanRepaid(loanId);
        } else {
            loan.status = LoanStatus.PartlyRepaid;
            emit LoanPartiallyRepaid(loanId, amount);
        }
    }

    /**
     * @dev Mark a loan as expired, can only be called by the contract owner
     * @param loanId ID of the loan to mark as expired
     */
    function markLoanAsExpired(uint256 loanId) external onlyOwner {
        LoanOrder storage loan = loanOrders[loanId];
        require(loan.status != LoanStatus.Repaid && loan.status != LoanStatus.Expired, "Loan already finalized");
        require(block.number >= loan.terms.deadlineBlockNumber, "Loan has not expired yet");

        loan.status = LoanStatus.Expired;
        emit LoanExpired(loanId);
    }

    /**
     * @dev Retrieve loan order details
     * @param loanId ID of the loan to retrieve
     * @return LoanOrder structure containing loan details
     */
    function getLoanOrder(uint256 loanId) external view returns (LoanOrder memory) {
        return loanOrders[loanId];
    }
}
