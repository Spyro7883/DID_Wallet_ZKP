// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VerifiableSignals is Ownable {
    constructor(address initialOwner) Ownable(initialOwner) {}

    event OfferSignaled(bytes32 indexed offerId, address indexed issuer, bytes32 indexed toCommit, bytes32 payloadHash, uint64 schemaId, uint64 expiresAt);
    event PresentationRequested(bytes32 indexed requestId, address indexed verifier, bytes32 indexed toCommit, bytes32 challengeHash, uint64 schemaId);
    event PresentationAcked(bytes32 indexed requestId, address indexed verifier, address holderAddr, bool ok);

    modifier onlyIssuer() { _checkOwner(); _; }
    modifier onlyVerifier() { _checkOwner(); _; }

    function signalOffer(bytes32 offerId, bytes32 toCommit, bytes32 payloadHash, uint64 schemaId, uint64 expiresAt) external onlyIssuer {
        emit OfferSignaled(offerId, msg.sender, toCommit, payloadHash, schemaId, expiresAt);
    }
    function requestPresentation(bytes32 requestId, bytes32 toCommit, bytes32 challengeHash, uint64 schemaId) external onlyVerifier {
        emit PresentationRequested(requestId, msg.sender, toCommit, challengeHash, schemaId);
    }
    function ackPresentation(bytes32 requestId, address holderAddr, bool ok) external onlyVerifier {
        emit PresentationAcked(requestId, msg.sender, holderAddr, ok);
    }
}
