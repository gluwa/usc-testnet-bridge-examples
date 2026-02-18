// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IUSCMinter} from "./USCMinter.sol";

bytes32 constant USC_MINTER = keccak256("USC_MINTER");

abstract contract USCMintableToken is ERC20, AccessControl, Ownable {
    constructor(address minter, string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {
        _grantRole(USC_MINTER, minter);
    }

    function mint(address to, uint256 amount) external onlyRole(USC_MINTER) {
        _mint(to, amount);
    }
}
