// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    address public constant BURN_ADDRESS = address(1); // 0x...01

    /// @notice Emitted when tokens are burned (sent to the burn address).
    /// @param from The address burning their tokens
    /// @param value The amount of tokens burned
    event TokensBurned(address indexed from, uint256 value);

    constructor() ERC20("Burn Test", "TEST") {
        // Mint sender initial supply
        _mint(msg.sender, 1_000_000 ether);
    }

    /// @notice "Burn" by transferring tokens to the 0x...01 sink address.
    /// @dev This does NOT reduce totalSupply; it only makes tokens inaccessible.
    function burn(uint256 amount) external returns (bool) {
        _transfer(msg.sender, BURN_ADDRESS, amount);
        emit TokensBurned(msg.sender, amount);
        return true;
    }
}
