import "dotenv/config";
import { ethers } from "ethers";
import { SIGNALS_ABI } from "./signals-abi.ts";

(async () => {
  const RPC = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);

  const addr = process.env.SIGNALS_ADDR!;
  const signals = new ethers.Contract(addr, SIGNALS_ABI, wallet);

  const norm = (x?: string) => (x && !x.startsWith("$") ? x : undefined);
  const DID = norm(process.argv[2]) ?? process.env.HOLDER_DID;
  const SALT_HEX = norm(process.argv[3]) ?? process.env.SALT;
  const CIT = norm(process.argv[4]) ?? process.env.CITIZENSHIP ?? "RO";
  const L = norm(process.argv[5]) ?? process.env.L ?? "8000";
  const U = norm(process.argv[6]) ?? process.env.U ?? "15000";
  const base = process.env.SERVER_BASE || "http://localhost:5501";

  if (!DID || !SALT_HEX)
    throw new Error(
      "Usage: tsx scripts/request_presentation.ts <holderDID> <saltHex> [citizenship] [L] [U]"
    );
  if (!/^0x[0-9a-fA-F]{64}$/.test(SALT_HEX))
    throw new Error("SALT has to be 0x + 64 hex (32 bytes)");

  const salt = Buffer.from(SALT_HEX.slice(2), "hex");

  const requestId = ethers.hexlify(ethers.randomBytes(32));
  const contextId = ethers.hexlify(ethers.randomBytes(16));

  const challengeHash = ethers.keccak256(ethers.toUtf8Bytes(String(contextId)));

  const toCommit = ethers.keccak256(
    new Uint8Array([
      ...ethers.toUtf8Bytes(DID),
      ...salt,
      ...ethers.toUtf8Bytes(challengeHash),
    ])
  );

  const schemaId = 1n;
  const expiresAt = Math.floor(Date.now() / 1000) + 600;

  console.log("Registering off-chain context...", {
    contextId,
    challengeHash,
    toCommit,
    CIT,
    L,
    U,
  });

  const reg = await fetch(`${base}/requests/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeHash,
      toCommit,
      context: { contextId, expectedCitizenship: CIT, L, U, expiresAt },
    }),
  }).then((r) => r.json());

  if (!reg?.ok)
    throw new Error(`/requests/register failed: ${JSON.stringify(reg)}`);
  console.log("✅ /requests/register ok");

  console.log("Emitting PresentationRequested...", {
    requestId,
    toCommit,
    challengeHash,
  });

  const tx = await signals.requestPresentation(
    requestId,
    toCommit,
    challengeHash,
    schemaId
  );
  const receipt = await tx.wait();

  console.log(
    `✅ requestPresentation tx: ${tx.hash} (block ${receipt.blockNumber})`
  );
})().catch((e) => {
  console.error("ERR:", e?.message || e);
  process.exit(1);
});
