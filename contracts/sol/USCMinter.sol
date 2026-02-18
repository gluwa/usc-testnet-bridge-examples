// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {USCMintableToken, USC_MINTER} from "./MintableToken.sol";
import {USCBaseBridge} from "./USCBaseBridge.sol";
import {EvmV1Decoder} from "./EvmV1Decoder.sol";

interface IUSCMinter {
    function wrapOriginToken(address originToken, address targetToken) external;
}

contract USCMinter is USCBaseBridge, IUSCMinter {
    // TokensBurnedForBridging event signature: keccak256("TokensBurnedForBridging(address,uint256)")
    bytes32 public constant BURN_EVENT_SIGNATURE =
        0x17dc4d6f69d484e59be774c29b47d2fa4c14af2e01df42fc5643ac968f4d427e;

    event TokensMinted(address indexed wrappedTokenAddress, address indexed burntFrom, uint256 amount, bytes32 indexed queryId);

    mapping(address => address) public wrappedTokens;

    function wrapOriginToken(address originToken, address targetToken) external {
        require(originToken != address(0), "Origin token cannot be the zero address");
        require(targetToken != address(0), "Target token cannot be the zero address");
        require(wrappedTokens[originToken] == address(0), "Origin token already wrapped");
        require(USCMintableToken(targetToken).owner() == msg.sender, "Target token must be owned by the caller");
        require(USCMintableToken(targetToken).hasRole(USC_MINTER, address(this)), "Target token must be USCMintableToken and support AccessControl");

        wrappedTokens[originToken] = targetToken;
    }

    function _processAndEmitEvent(bytes32 queryId, bytes memory encodedTransaction) internal override {
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
        (address originTokenAddress, address burntFrom, uint256 burntValue) = _processBurnLogs(burnLogs);

        address wrappedTokenAddress = wrappedTokens[originTokenAddress];

        // will revert if not registered in wrappedTokens or not mintable
        USCMintableToken(wrappedTokenAddress).mint(burntFrom, burntValue);

        emit TokensMinted(wrappedTokenAddress, burntFrom, burntValue, queryId);
    }

    function _processBurnLogs(EvmV1Decoder.LogEntry[] memory burnLogs)
        internal
        pure
        returns (address originTokenAddress, address from, uint256 value)
    {
        // For this demonstration we only process the first burn log found within a transaction.
        // We only expect a single burn log per transaction in this demo anyways
        require(burnLogs.length > 0, "No burn logs");
        EvmV1Decoder.LogEntry memory log = burnLogs[0];

        require(log.topics.length == 2, "Invalid TokensBurnedForBridging topics");
        require(log.topics[0] == BURN_EVENT_SIGNATURE, "Not TokensBurnedForBridging event");

        originTokenAddress = log.address_;
        from = address(uint160(uint256(log.topics[1])));

        // data is a single uint256 (32 bytes)
        require(log.data.length == 32, "Not burn event: data len");
        value = abi.decode(log.data, (uint256));

        return (originTokenAddress, from, value);
    }
}
