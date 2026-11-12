// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title RelicRegistry
 * @dev v2 MVP: tokenizes real-world assets (Optic Relics) as ERC721s with provenance.
 * Minting is gated to verified issuers (galleries, brands such as IBG Collection).
 */
contract RelicRegistry is ERC721URIStorage, Ownable {
    struct Relic {
        string physicalId;   // physical asset identifier (NFC tag, serial, catalog id)
        address issuer;      // verified issuer that attested the asset
        uint64 mintedAt;
    }

    uint256 public nextId = 1;
    mapping(address => bool) public issuers;
    mapping(uint256 => Relic) private _relics;
    mapping(bytes32 => uint256) public tokenByPhysicalId; // keccak(physicalId) => tokenId

    event IssuerSet(address indexed issuer, bool allowed);
    event RelicMinted(uint256 indexed tokenId, address indexed issuer, address indexed to, string physicalId, string uri);

    error NotIssuer();
    error DuplicatePhysicalId();

    constructor() ERC721("RelicPay Registry", "RELIC") Ownable(msg.sender) {}

    function setIssuer(address issuer, bool allowed) external onlyOwner {
        issuers[issuer] = allowed;
        emit IssuerSet(issuer, allowed);
    }

    function mintRelic(address to, string calldata physicalId, string calldata uri) external returns (uint256 tokenId) {
        if (!issuers[msg.sender]) revert NotIssuer();
        bytes32 pid = keccak256(bytes(physicalId));
        if (tokenByPhysicalId[pid] != 0) revert DuplicatePhysicalId();

        tokenId = nextId++;
        _relics[tokenId] = Relic({ physicalId: physicalId, issuer: msg.sender, mintedAt: uint64(block.timestamp) });
        tokenByPhysicalId[pid] = tokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit RelicMinted(tokenId, msg.sender, to, physicalId, uri);
    }

    function getRelic(uint256 tokenId) external view returns (Relic memory) {
        _requireOwned(tokenId);
        return _relics[tokenId];
    }
}
