// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice Simple ERC20 for local testing (anyone can mint to any address).
 * @dev Do NOT deploy to production networks.
 */
contract TestMintERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

