// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {LoanFlow, LoanStatus, LoanOrder, LoanTerms} from "./LoanTypes.sol";
import {EvmV1Decoder} from "./EvmV1Decoder.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./VerifierInterface.sol";
import {USCBase} from "./USCBase.sol";

/**
 * @title USCLoanManager
 * @dev Main contract for managing cross-chain loan orders in the USC system
 */
contract USCLoanManager is Ownable, ReentrancyGuard, USCBase {
    using ECDSA for bytes32;

    enum LoanManagerActions {
        LoanFunded, // 0
        LoanRepaid // 1
    }
    error InvalidAction(uint8 action);

    // ERC20 LoanFunded event signature: keccak256("LoanFunded(uint256)")
    bytes32 public constant FUND_EVENT_SIGNATURE =
        0x9e71d2fb732e68272b7e74ecfd14638673c1d77e19a5d390a3ffff054d57c44b;

    // ERC20 LoanRepaid event signature: keccak256("LoanRepaid(uint256,uint256)")
    bytes32 public constant REPAY_EVENT_SIGNATURE =
        0x040cee90ee4799897c30ca04e5feb6fa43dbba9b6d084b4b257cdafd84ba013e;

    // State variables
    mapping(uint256 => LoanOrder) public loanOrders;
    mapping(uint256 => bool) public registeredLoans;

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
        nextLoanId = 1;
        // Get the precompile instance using the helper library
        VERIFIER = NativeQueryVerifierLib.getVerifier();
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

        registeredLoans[loanId] = true;

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

    // Processes a USC action resulting from the `execute` function of the USCBase contract
    function _processAndEmitEvent(
        uint8 action, 
        bytes32, // queryId - unused
        bytes memory encodedTransaction
        ) internal override {
        if (action == uint8(LoanManagerActions.LoanFunded)) {
            _markLoanAsFunded(encodedTransaction);
        } else if (action == uint8(LoanManagerActions.LoanRepaid)) {
            _noteLoanRepayment(encodedTransaction);
        } else {
            revert InvalidAction(action);
        }
    }

    function _markLoanAsFunded(bytes memory encodedTransaction) internal {
        // We need to validate that the transaction actually contains our LoanFunded event
        EvmV1Decoder.LogEntry[] memory fundEventLogs = _validateTransactionContents(encodedTransaction, FUND_EVENT_SIGNATURE);
        uint256 loanId = _processFundLogs(fundEventLogs);

        // Now we can proceed with marking the loan as funded
        LoanOrder storage loan = loanOrders[loanId];
        require(loan.status == LoanStatus.Created, "Loan is not in Created status");
        require(block.number <= loan.terms.deadlineBlockNumber, "Loan has expired");

        loan.status = LoanStatus.Funded;
        emit LoanFunded(loanId);
    }

    function _noteLoanRepayment(bytes memory encodedTransaction) internal {
        // We need to validate that the transaction actually contains our LoanRepaid event
        EvmV1Decoder.LogEntry[] memory repayEventLogs = _validateTransactionContents(encodedTransaction, REPAY_EVENT_SIGNATURE);
        (uint256 loanId, uint256 amount) = _processRepayLogs(repayEventLogs);

        // Now we can proceed with marking the loan as partially or fully repaid
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
        require(registeredLoans[loanId], "Loan ID not registered");

        return loanOrders[loanId];
    }

    function _validateTransactionContents(bytes memory encodedTransaction, bytes32 eventSignature) internal pure returns (EvmV1Decoder.LogEntry[] memory selectedEventLogs) {
        // Validate transaction type
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "Unsupported transaction type");

        // Decode and validate receipt status
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction did not succeed");

        // Find events and validate
        selectedEventLogs = EvmV1Decoder.getLogsByEventSignature(receipt, eventSignature);
        require(selectedEventLogs.length > 0, "No events of type required type found");

        return selectedEventLogs;
    }

    function _processFundLogs(EvmV1Decoder.LogEntry[] memory fundLogs)
        internal
        pure
        returns (uint256 loanId)
    {
        // For this demonstration we only process the first fund log found within a transaction.
        // We only expect a single fund log to exist per transaction anyways
        require(fundLogs.length > 0);
        EvmV1Decoder.LogEntry memory log = fundLogs[0];

        require(log.topics.length == 2, "Invalid LoanFunded topics");
        require(log.topics[0] == FUND_EVENT_SIGNATURE, "Not LoanFunded event");

        loanId = uint256(log.topics[1]);

        return loanId;
    }

    function _processRepayLogs(EvmV1Decoder.LogEntry[] memory repayLogs)
        internal
        pure
        returns (uint256 loanId, uint256 amount)
    {
        // For this demonstration we only process the first repay log found within a transaction.
        // We only expect a single repay log to exist per transaction anyways
        require(repayLogs.length > 0);
        EvmV1Decoder.LogEntry memory log = repayLogs[0];

        require(log.topics.length == 2, "Invalid LoanRepaid topics");
        require(log.topics[0] == REPAY_EVENT_SIGNATURE, "Not LoanRepaid event");
        require(log.data.length == 32, "Invalid LoanRepaid data");

        loanId = uint256(log.topics[1]);
        amount = abi.decode(log.data, (uint256));

        return (loanId, amount);
    }
}
