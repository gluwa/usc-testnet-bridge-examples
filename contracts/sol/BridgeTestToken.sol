// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {USCMintableToken} from "./MintableToken.sol";

contract BridgeTestToken is USCMintableToken {
    constructor(address minter) USCMintableToken(minter, "Bridge Test Token", "BTKT") {}
}