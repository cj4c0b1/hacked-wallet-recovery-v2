// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @notice Simple ERC721 for local testing (anyone can mint to any address).
 * @dev Do NOT deploy to production networks.
 */
contract TestMintERC721 is ERC721 {
    uint256 public nextTokenId;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {
    }

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextTokenId;
        nextTokenId = tokenId + 1;
        _safeMint(to, tokenId);
    }
}

