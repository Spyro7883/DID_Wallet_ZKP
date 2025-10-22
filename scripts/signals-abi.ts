export const SIGNALS_ABI = [
  "function signalOffer(bytes32 offerId, bytes32 toCommit, bytes32 payloadHash, uint64 schemaId, uint64 expiresAt)",
  "function requestPresentation(bytes32 requestId, bytes32 toCommit, bytes32 challengeHash, uint64 schemaId)",
  "function ackPresentation(bytes32 requestId, address holderAddr, bool ok)",

  "event OfferSignaled(bytes32 indexed offerId, address indexed issuer, bytes32 indexed toCommit, bytes32 payloadHash, uint64 schemaId, uint64 expiresAt)",
  "event PresentationRequested(bytes32 indexed requestId, address indexed verifier, bytes32 indexed toCommit, bytes32 challengeHash, uint64 schemaId)",
  "event PresentationAcked(bytes32 indexed requestId, address indexed verifier, address holderAddr, bool ok)",
];
