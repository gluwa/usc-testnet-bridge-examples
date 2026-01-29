// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface INativeQueryVerifier {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool);
}

library NativeQueryVerifierLib {
    address constant PRECOMPILE_ADDRESS = 0x0000000000000000000000000000000000000FD2;

    function getVerifier() internal pure returns (INativeQueryVerifier) {
        return INativeQueryVerifier(PRECOMPILE_ADDRESS);
    }

    /**
     * @notice Calculates the transaction index from the merkle proof path
     */
    function _calculateTransactionIndex(INativeQueryVerifier.MerkleProofEntry[] memory proof)
        internal
        pure
        returns (uint256 index)
    {
        index = 0;
        // Iterate from root -> leaf
        for (uint256 i = proof.length; i > 0; i--) {
            // isLeft represents "sibling's" left or right, not "self" left or right
            // isLeft == true means "sibling" is on the left, itself offset == 1
            // isLeft == false means "sibling" is on the right, itself offset == 0
            index = index * 2 + (proof[i - 1].isLeft ? 1 : 0);
        }
        return index;
    }
}
