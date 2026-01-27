// // SPDX-License-Identifier: MIT
// pragma solidity ^0.8.23;

// import {Test} from "forge-std/Test.sol";

// import {INativeQueryVerifier, SimpleMinterUSC} from "../sol/SimpleMinterUSC.sol";

// contract TestableSimpleMinterUSC is SimpleMinterUSC {
//     function exposed_calculateTransactionIndex(INativeQueryVerifier.MerkleProofEntry[] memory proof)
//         public
//         pure
//         returns (uint256)
//     {
//         return _calculateTransactionIndex(proof);
//     }
// }

// contract SimpleMinterUSCTest is Test {
//     TestableSimpleMinterUSC internal minter;

//     function setUp() public {
//         minter = new TestableSimpleMinterUSC();
//     }

//     /// @notice Create a Merkle proof sibling array where the bits of `n` encode `isLeft`.
//     /// @dev Bits are read from LSB -> MSB (leaf -> root).
//     /// @dev Example: 81 (0b1010001) => [true,false,false,false,true,false,true].
//     /// @dev the confusing part here is that boolean values represent "sibling's" left or right, not "self" left or right
//     /// @dev `hash` values are placeholders (not used by `_calculateTransactionIndex`).
//     function _makeProofFromIndex(uint256 n)
//         internal
//         pure
//         returns (INativeQueryVerifier.MerkleProofEntry[] memory proof)
//     {
//         // Define 0 as a single-bit "0" representation.
//         uint256 bitLen = 1;
//         {
//             uint256 tmp = n;
//             while (tmp > 1) {
//                 bitLen++;
//                 tmp >>= 1;
//             }
//         }

//         proof = new INativeQueryVerifier.MerkleProofEntry[](bitLen);
//         for (uint256 i = 0; i < bitLen; i++) {
//             // LSB -> MSB (leaf -> root)
//             uint256 selfOffset = ((n >> i) & 1);
//             // isLeft represents "sibling's" left or right, not "self" left or right
//             bool isLeft = selfOffset == 1;
//             proof[i] = INativeQueryVerifier.MerkleProofEntry({hash: bytes32(uint256(i + 1)), isLeft: isLeft});
//         }
//     }

//     function test_calculateTransactionIndex_threeEntries() public view {
//         // isLeft sequence is LSB -> MSB: [true, false, true] == 0b101
//         INativeQueryVerifier.MerkleProofEntry[] memory proof = _makeProofFromIndex(5);

//         uint256 index = minter.exposed_calculateTransactionIndex(proof);
//         assertEq(index, 5);
//     }

//     function test_makeProofFromNumber_81_bitsToIsLeft() public view {
//         INativeQueryVerifier.MerkleProofEntry[] memory proof = _makeProofFromIndex(81); // 0b1010001

//         assertEq(proof.length, 7);
//         assertTrue(proof[0].isLeft);
//         assertFalse(proof[1].isLeft);
//         assertFalse(proof[2].isLeft);
//         assertFalse(proof[3].isLeft);
//         assertTrue(proof[4].isLeft);
//         assertFalse(proof[5].isLeft);
//         assertTrue(proof[6].isLeft);

//         uint256 index = minter.exposed_calculateTransactionIndex(proof);
//         assertEq(index, 81);

//     }
// }
