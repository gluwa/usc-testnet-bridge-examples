// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {USCBase} from "./USCBase.sol";
import {EvmV1Decoder} from "./EvmV1Decoder.sol";

contract USCDecodeOnly is USCBase {
    event TransactionDecoded(
        bytes32 indexed queryId,
        uint8 txType,
        uint64 nonce,
        uint64 gasLimit,
        address from,
        uint256 value,
        uint8 receiptStatus,
        uint64 receiptGasUsed,
        uint256 logCount,
        uint256 encodedLength
    );

    function _processAndEmitEvent(
        uint8,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "Unsupported transaction type");

        EvmV1Decoder.CommonTxFields memory common;
        EvmV1Decoder.ReceiptFields memory receipt;

        if (txType == 0) {
            EvmV1Decoder.DecodedTransactionType0 memory decoded =
                EvmV1Decoder.decodeTransactionType0(encodedTransaction);
            common = decoded.commonTx;
            receipt = decoded.receipt;
        } else if (txType == 1) {
            EvmV1Decoder.DecodedTransactionType1 memory decoded =
                EvmV1Decoder.decodeTransactionType1(encodedTransaction);
            common = decoded.commonTx;
            receipt = decoded.receipt;
        } else if (txType == 2) {
            EvmV1Decoder.DecodedTransactionType2 memory decoded =
                EvmV1Decoder.decodeTransactionType2(encodedTransaction);
            common = decoded.commonTx;
            receipt = decoded.receipt;
        } else if (txType == 3) {
            EvmV1Decoder.DecodedTransactionType3 memory decoded =
                EvmV1Decoder.decodeTransactionType3(encodedTransaction);
            common = decoded.commonTx;
            receipt = decoded.receipt;
        } else {
            EvmV1Decoder.DecodedTransactionType4 memory decoded =
                EvmV1Decoder.decodeTransactionType4(encodedTransaction);
            common = decoded.commonTx;
            receipt = decoded.receipt;
        }

        emit TransactionDecoded(
            queryId,
            txType,
            common.nonce,
            common.gasLimit,
            common.from,
            common.value,
            receipt.receiptStatus,
            receipt.receiptGasUsed,
            receipt.receiptLogs.length,
            encodedTransaction.length
        );
    }
}