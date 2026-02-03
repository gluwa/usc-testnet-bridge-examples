// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {EvmV1Decoder} from "./EvmV1Decoder.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./VerifierInterface.sol";

contract SimpleMinterUSC is ERC20 {
    /// @notice The Native Query Verifier precompile instance
    /// @dev Address: 0x0000000000000000000000000000000000000FD2 (4050 decimal)
    INativeQueryVerifier public immutable VERIFIER;

    // ERC20 Transfer event signature: keccak256("Transfer(address,address,uint256)")
    bytes32 public constant TRANSFER_EVENT_SIGNATURE =
        0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    event TokensMinted(address indexed token, address indexed recipient, uint256 amount, bytes32 indexed queryId);

    mapping(bytes32 => bool) public processedQueries;

    constructor() ERC20("Mintable (TEST)", "TEST") {
        // Get the precompile instance using the helper library
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    function _processTransferLogs(EvmV1Decoder.LogEntry[] memory transferLogs, address targetSourceAddress)
        internal
        pure
        returns (bool found, uint256 value)
    {
        found = false;

        for (uint256 i = 0; i < transferLogs.length; i++) {
            EvmV1Decoder.LogEntry memory log = transferLogs[i];

            // Transfer event has 3 topics: [signature, from, to]
            // and data: value (uint256)
            //require(log.topics.length >= 3, "Invalid Transfer event format");

            address from = address(uint160(uint256(log.topics[1])));
            address to = address(uint160(uint256(log.topics[2])));

            // If transfer is from targetSourceAddress to address(128) or lower, consider it a burn
            if (from == targetSourceAddress && to < address(128)) {
                // Now that we've found a burn transaction, let's get its value
                require(log.data.length == 32, "Not ERC20 Transfer: data len");
                // data is a single uint256 (32 bytes)
                value = abi.decode(log.data, (uint256));
                found = true;

                break;
            }
        }

        return (found, value);
    }

    function _verifyProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) internal returns (bool verified) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        // Verify inclusion proof
        verified = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);

        return verified;
    }

    function _validateTransactionContents(bytes memory encodedTransaction) internal pure returns (bool valid, uint256 value) {
        // Validate transaction type
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "Unsupported transaction type");

        // Decode and validate receipt status
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction did not succeed");

        // Find transfer events and validate
        EvmV1Decoder.LogEntry[] memory transferLogs =
            EvmV1Decoder.getLogsByEventSignature(receipt, TRANSFER_EVENT_SIGNATURE);
        require(transferLogs.length > 0, "No transfer events found");

        // Get the original sender
        EvmV1Decoder.CommonTxFields memory txFields = EvmV1Decoder.decodeCommonTxFields(encodedTransaction);

        // Check if there's an actual burn transfer from the sender
        (bool found, uint256 burnValue) = _processTransferLogs(transferLogs, txFields.from);
        require(found, "No valid burn transfer found");

        return (true, burnValue);
    }

    function mintFromQuery(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        // Calculate transaction index from merkle proof path
        uint256 transactionIndex = NativeQueryVerifierLib._calculateTransactionIndex(siblings);

        // Check if the query has already been processed
        bytes32 txKey;
        {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, chainKey)
                mstore(add(ptr, 32), shl(192, blockHeight))
                mstore(add(ptr, 40), transactionIndex)
                txKey := keccak256(ptr, 72)
            }
            require(!processedQueries[txKey], "Query already processed");
        }

        // First we verify the proof
        bool verified = _verifyProof(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );
        require(verified, "Verification failed");

        // Mark the query as processed
        processedQueries[txKey] = true;

        // Next we validate the transaction contents
        (bool valid, uint256 burnValue) = _validateTransactionContents(encodedTransaction);
        require(valid, "Transaction contents validation failed");

        // If the transaction validation passes, mint tokens to the sender
        _mint(msg.sender, burnValue);

        emit TokensMinted(address(this), msg.sender, burnValue, txKey);

        return true;
    }
}
