// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct LoanFlow {
    address from;
    address to;
    address withToken;
}

enum LoanStatus {
    Created,
    Funded,
    PartlyRepaid,
    Repaid,
    Expired
}

struct LoanTerms {
    uint256 loanAmount;
    uint256 interestRate; // in basis points (e.g., 500 = 5%)
    uint256 expectedRepaymentAmount;
    uint256 deadlineBlockNumber;
}

// Complete loan order structure
struct LoanOrder {
    LoanFlow fundFlow;
    LoanFlow repayFlow;
    LoanTerms terms;
    bytes signatureOfLender;
    bytes signatureOfBorrower;
    uint256 createdAtBlock;
    LoanStatus status;
    uint256 repaidAmount;
}
