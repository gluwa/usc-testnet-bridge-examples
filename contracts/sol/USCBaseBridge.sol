// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {EvmV1Decoder} from "./EvmV1Decoder.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./VerifierInterface.sol";

abstract contract USCBaseBridge {
    /// @notice The Native Query Verifier precompile instance
    /// @dev Address: 0x0000000000000000000000000000000000000FD2 (4050 decimal)
    INativeQueryVerifier public immutable VERIFIER;

    mapping(bytes32 => bool) public processedQueries;

    constructor() {
        // Get the precompile instance using the helper library
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    function _processAndEmitEvent(bytes32 queryId, bytes memory encodedTransaction) internal virtual;

    function execute(
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
        bytes32 queryId;
        {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, chainKey)
                mstore(add(ptr, 32), shl(192, blockHeight))
                mstore(add(ptr, 40), transactionIndex)
                queryId := keccak256(ptr, 72)
            }
            require(!processedQueries[queryId], "Query already processed");
        }

        // First we verify the proof
        bool verified = _verifyProof(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );
        require(verified, "Proof of inclusion verification failed");

        // Mark the query as processed
        processedQueries[queryId] = true;

        _processAndEmitEvent(queryId, encodedTransaction);

        return true;
    }

    // allows for bypassing the processed queries check
    function executeDev(
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
        bytes32 queryId;
        {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, chainKey)
                mstore(add(ptr, 32), shl(192, blockHeight))
                mstore(add(ptr, 40), transactionIndex)
                queryId := keccak256(ptr, 72)
            }
//            require(!processedQueries[queryId], "Query already processed");
        }

        // First we verify the proof
        bool verified = _verifyProof(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );
        require(verified, "Proof of inclusion verification failed");

        // Mark the query as processed
        processedQueries[queryId] = true;

        _processAndEmitEvent(queryId, encodedTransaction);

        return true;
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
}
