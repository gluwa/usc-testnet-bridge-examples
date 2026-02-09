// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {EvmV1Decoder} from "./EvmV1Decoder.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./VerifierInterface.sol";

contract SimpleMinterUSC is ERC20 {
    /// @notice The Native Query Verifier precompile instance
    /// @dev Address: 0x0000000000000000000000000000000000000FD2 (4050 decimal)
    INativeQueryVerifier public immutable VERIFIER;

    // TokensBurnedForBridging event signature: keccak256("TokensBurnedForBridging(address,uint256)")
    bytes32 public constant BURN_EVENT_SIGNATURE =
        0x17dc4d6f69d484e59be774c29b47d2fa4c14af2e01df42fc5643ac968f4d427e;

    event TokensMinted(address indexed token, address indexed recipient, uint256 amount, bytes32 indexed queryId);

    mapping(bytes32 => bool) public processedQueries;

    constructor() ERC20("Mintable (TEST)", "TEST") {
        // Get the precompile instance using the helper library
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    function _processBurnLogs(EvmV1Decoder.LogEntry[] memory burnLogs)
        internal
        pure
        returns (address from, uint256 value)
    {
        // For this demonstration we only process the first burn log found within a transaction.
        // We only expect a single burn log per transaction in this demo anyways
        require(burnLogs.length > 0, "No burn logs");
        EvmV1Decoder.LogEntry memory log = burnLogs[0];

        require(log.topics.length == 2, "Invalid TokensBurnedForBridging topics");
        require(log.topics[0] == BURN_EVENT_SIGNATURE, "Not TokensBurnedForBridging event");

        from = address(uint160(uint256(log.topics[1])));
                
        // data is a single uint256 (32 bytes)
        require(log.data.length == 32, "Not burn event: data len");
        value = abi.decode(log.data, (uint256));

        return (from, value);
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

    function _validateTransactionContents(bytes memory encodedTransaction) internal pure returns (address sender, uint256 value) {
        // Validate transaction type
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "Unsupported transaction type");

        // Decode and validate receipt status
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction did not succeed");

        // Find burn events and validate
        EvmV1Decoder.LogEntry[] memory burnLogs =
            EvmV1Decoder.getLogsByEventSignature(receipt, BURN_EVENT_SIGNATURE);
        require(burnLogs.length > 0, "No burn events found");

        // Check if the burn is valid
        (address burnSender, uint256 burnValue) = _processBurnLogs(burnLogs);

        return (burnSender, burnValue);
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
        (address burnSender, uint256 burnValue) = _validateTransactionContents(encodedTransaction);

        // If the transaction validation passes, mint tokens to the sender
        _mint(burnSender, burnValue);

        emit TokensMinted(address(this), burnSender, burnValue, txKey);

        return true;
    }
}
