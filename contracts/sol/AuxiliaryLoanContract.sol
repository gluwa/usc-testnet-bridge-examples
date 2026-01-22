// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {LoanFlow} from "./LoanTypes.sol";

/**
 * @title AuxiliaryLoanContract
 * @dev Contract for orchestrating token transfers in loan funding and repayment flows
 */
contract AuxiliaryLoanContract is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Events
    event LoanFunded(uint256 indexed loanId);
    event LoanRepaid(uint256 indexed loanId, uint256 amount);

    // Mapping to track authorized tokens
    mapping(address => bool) public authorizedTokens;

    // Mapping to track funding flows
    mapping(uint256 => LoanFlow) public loanFundFlows;

    // Mapping to track repayment flows
    mapping(uint256 => LoanFlow) public loanRepayFlows;

    // Mapping to track loan amounts to fund before loan is marked as funded
    mapping(uint256 => uint256) public loanFundAmounts;
    mapping(uint256 => bool) public loanFundRegistered;

    // Mapping to track total repayment amount for each loan
    mapping(uint256 => uint256) public loanRepaymentAmounts;
    mapping(uint256 => bool) public loanRepaymentRegistered;

    // Mapping of expired loans
    mapping(uint256 => bool) public expiredLoans;

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Add an authorized token that can be used for loans allowing its use in future loans
     * @param token Address of the ERC20 token to authorize
     */
    function addAuthorizedToken(address token) external onlyOwner {
        // TODO: Need to check if the address is a valid ERC20

        require(token != address(0), "Invalid token address");
        authorizedTokens[token] = true;
    }

    /**
     * @dev Remove an authorized token, preventing its further use in future loans
     * @param token Address of the ERC20 token to remove
     */
    function removeAuthorizedToken(address token) external onlyOwner {
        authorizedTokens[token] = false;
    }

    /**
     * @dev Check if a token is authorized
     * @param token Address of the token to check
     */
    function isTokenAuthorized(address token) external view returns (bool) {
        return authorizedTokens[token];
    }

    /**
     * @dev Validate a flow structure
     * @param flow Flow structure to validate
     */
    function validateFlow(LoanFlow calldata flow) private view returns (bool) {
        require(flow.from != address(0), "Invalid source address");
        require(flow.to != address(0), "Invalid target address");
        require(flow.from != flow.to, "Source and target cannot be the same");
        require(authorizedTokens[flow.withToken], "Token not authorized");

        return true;
    }

    /**
     * @dev Register a loan for funding, can only be called by the owner (USC system) to avoid setting arbitrary amounts
     * @param loanId ID of the loan being registered
     * @param flow Flow structure for the loan funding
     * @param fundAmount Amount to be funded for the loan
     */
    function registerLoanFund(uint256 loanId, LoanFlow calldata flow, uint256 fundAmount) external onlyOwner {
        require(!expiredLoans[loanId], "Cannot register a loan for funding that is expired");

        // Validate inputs
        require(!loanFundRegistered[loanId], "Loan already registered");
        require(fundAmount > 0, "Fund amount must be greater than 0");
        require(validateFlow(flow), "Invalid loan flow structure");

        loanFundAmounts[loanId] = fundAmount;
        loanFundFlows[loanId] = flow;
        loanFundRegistered[loanId] = true;

    }

    /**
     * @dev Register a repayment for a loan, can only be called by the owner (USC system) to avoid setting arbitrary amounts
     * @param loanId ID of the loan being repaid
     * @param flow Flow structure for the loan repayment
     * @param repayAmount Amount to be repaid for the loan
     */
    function registerLoanRepayment(uint256 loanId, LoanFlow calldata flow, uint256 repayAmount) external onlyOwner {
        require(!expiredLoans[loanId], "Cannot register a loan for repayment that is expired");

        // Validate inputs
        require(!loanRepaymentRegistered[loanId], "Loan already registered");
        require(repayAmount > 0, "Repay amount must be greater than 0");
        require(validateFlow(flow), "Invalid loan flow structure");

        loanRepaymentAmounts[loanId] = repayAmount;
        loanRepayFlows[loanId] = flow;
        loanRepaymentRegistered[loanId] = true;
    }

    /**
     * @dev Fund a loan by transferring tokens from lender to borrower
     * @param loanId ID of the loan being funded
     * @param amount Amount of tokens to transfer
     * @param from Address of the lender providing the funds
     * @param to Address of the borrower receiving the funds
     * @param token Address of the ERC20 token being transferred
     */
    function fundLoan(
        uint256 loanId,
        uint256 amount,
        address from,
        address to,
        address token
    ) external nonReentrant {
        require(!expiredLoans[loanId], "Cannot fund an expired loan");

        // Validate arguments
        require(msg.sender == from, "Only lender can initiate funding");
        require(amount > 0, "Amount must be greater than 0");

        // Ensure the loan is registered for funding and not already funded
        require(loanFundRegistered[loanId], "Loan not registered for funding");
        require(loanFundAmounts[loanId] > 0, "Loan already funded");

        // Validate that flow details match
        LoanFlow memory loanFlow = loanFundFlows[loanId];
        require(loanFlow.withToken == token, "Token mismatch for loan");
        require(loanFlow.from == from, "Lender address mismatch");
        require(loanFlow.to == to, "Borrower address mismatch");

        // If the funded amount exceeds expected, cap it to expected
        uint256 expectedAmount = loanFundAmounts[loanId];
        if (amount > expectedAmount) {
            amount = expectedAmount;
        }

        // Transfer tokens from lender to borrower
        IERC20(token).safeTransferFrom(from, to, amount);

        // Decrease the remaining amount to be funded
        loanFundAmounts[loanId] -= amount;

        // If fully funded, emit event
        if (loanFundAmounts[loanId] == 0) {
            // Emit event for USC worker to listen to
            emit LoanFunded(loanId);
        }
    }

    /**
     * @dev Repay a loan by transferring tokens from borrower to lender
     * @param loanId ID of the loan being repaid
     * @param amount Amount of tokens to transfer
     * @param from Address of the borrower making the repayment
     * @param to Address of the lender receiving the repayment
     * @param token Address of the ERC20 token being transferred
     */
    function repayLoan(
        uint256 loanId,
        uint256 amount,
        address from,
        address to,
        address token
    ) external nonReentrant {
        require(!expiredLoans[loanId], "Cannot repay an expired loan");

        // Validate arguments
        require(msg.sender == from, "Only borrower can initiate repayment");
        require(amount > 0, "Amount must be greater than 0");

        // Ensure the loan is registered for repayment and not already repaid
        require(loanRepaymentRegistered[loanId], "Loan not registered for repayment");
        require(loanRepaymentAmounts[loanId] > 0, "Loan already repaid");

        // Validate that flow details match
        LoanFlow memory loanFlow = loanRepayFlows[loanId];
        require(loanFlow.withToken == token, "Token mismatch for loan");
        require(loanFlow.from == from, "Borrower address mismatch");
        require(loanFlow.to == to, "Lender address mismatch");

        // If the repayment amount exceeds expected, cap it to expected
        uint256 expectedAmount = loanRepaymentAmounts[loanId];
        if (amount > expectedAmount) {
            amount = expectedAmount;
        }

        // Transfer tokens from lender to borrower
        IERC20(token).safeTransferFrom(from, to, amount);

        // Decrease the remaining amount to be funded
        loanRepaymentAmounts[loanId] -= amount;

        emit LoanRepaid(loanId, amount);
    }

    function markLoanAsExpired(uint256 loanId) external onlyOwner {
        // Mark the loan as fully repaid to prevent further repayments
        expiredLoans[loanId] = true;
    }
}
