// server.ts
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { readFileSync } from "node:fs";
import { keccak256, toUtf8Bytes } from "ethers";
import * as snarkjs from "snarkjs";

import "reflect-metadata";
import { setupAgent, type TAgent } from "./agent.ts";

import { base64url } from "jose";
import { ed25519 as edc } from "@noble/curves/ed25519"; // ✅ are SHA-512 built-in
import { secp256k1 as secp } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";

import bs58 from "bs58";

// ───────────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────────
const app = express();
const PORT = 5501;

const CIRCUIT = process.env.CIRCUIT || "aggregate";
const VK_PATH = `./build/${CIRCUIT}/verification_key.json`;
const VERIFICATION_KEY = JSON.parse(readFileSync(VK_PATH, "utf8"));

app.use(cors());
app.use(express.json());

// ───────────────────────────────────────────────────────────────────────────────
// Tipuri & utilitare
// ───────────────────────────────────────────────────────────────────────────────
type ProofPack = { proof: any; publicSignals: any[] | Record<string, any> };
type ZkContext = {
  contextId: string;
  expectedCitizenship: string;
  L: string | number;
  U: string | number;
  expiresAt: number;
};

const REQUESTS = new Map<string, { toCommit: string; ctx: ZkContext }>();

const b64uToBytes = (s: string) => new Uint8Array(base64url.decode(s));
const utf8 = (s: string) => new TextEncoder().encode(s);

function normalizeSecpPub(raw: Uint8Array): Uint8Array {
  // întoarce cheia publică comprimată (33 bytes)
  if (raw.length === 33) return raw; // deja comprimată
  if (raw.length === 65 && raw[0] === 0x04) {
    // uncompressed 0x04||X||Y
    return secp.ProjectivePoint.fromHex(raw).toRawBytes(true);
  }
  if (raw.length === 64) {
    // X||Y fără prefix
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.set(raw, 1);
    return secp.ProjectivePoint.fromHex(uncompressed).toRawBytes(true);
  }
  throw new Error(`Unsupported secp256k1 pubkey length ${raw.length}`);
}

function extractPubKeyFromDidDoc(didDoc: any): {
  type: "Ed25519" | "Secp256k1";
  pub: Uint8Array;
} {
  const vms: any[] = didDoc?.didDocument?.verificationMethod || [];

  for (const vm of vms) {
    const t = String(vm.type || "").toLowerCase();
    const mb = vm.publicKeyMultibase || vm.publicKeyBase58;
    const jwk = vm.publicKeyJwk;

    // 1) publicKeyMultibase (Multikey) -> detectăm din prefixul multicodec
    if (mb) {
      const raw = bs58.decode(String(mb).replace(/^z/, ""));
      if (raw.length >= 2) {
        const prefix = (raw[0] << 8) | raw[1]; // multicodec
        const body = raw.slice(2);
        if (prefix === 0xed01) {
          // ed25519-pub
          return { type: "Ed25519", pub: body };
        }
        if (prefix === 0xe701) {
          // secp256k1-pub
          // comprima la 33B dacă e cazul
          return { type: "Secp256k1", pub: normalizeSecpPub(body) };
        }
      }
      // dacă tipul spune clar ed/secp, folosește-l ca fallback
      if (t.includes("ed25519")) return { type: "Ed25519", pub: raw.slice(2) };
      if (t.includes("secp256k1"))
        return { type: "Secp256k1", pub: normalizeSecpPub(raw.slice(2)) };
    }

    // 2) JWK
    if (jwk?.crv === "Ed25519" && jwk.x) {
      return { type: "Ed25519", pub: base64url.decode(jwk.x) };
    }
    if (jwk?.crv === "secp256k1" && jwk.x && jwk.y) {
      const x = base64url.decode(jwk.x);
      const y = base64url.decode(jwk.y);
      const uncompressed = new Uint8Array(1 + x.length + y.length);
      uncompressed[0] = 0x04;
      uncompressed.set(x, 1);
      uncompressed.set(y, 1 + x.length);
      return { type: "Secp256k1", pub: normalizeSecpPub(uncompressed) };
    }
  }
  throw new Error("No suitable verificationMethod found");
}

function keccakDidSalt(did: string, saltHex: string) {
  const salt = Buffer.from(saltHex.replace(/^0x/, ""), "hex");
  const bytes = new Uint8Array([...toUtf8Bytes(did), ...salt]);
  return keccak256(bytes);
}

const isPack = (x: any): x is ProofPack =>
  x && typeof x === "object" && x.proof && x.publicSignals;
const same = (a: any, b: any) => String(a) === String(b);
const eqBig = (a: any, b: any) => {
  try {
    return BigInt(String(a)) === BigInt(String(b));
  } catch {
    return same(a, b);
  }
};

const IDX = {
  allValid: 0,
  privHash: 1,
  agePrivHash: 2,
  citizenshipPrivHash: 3,
  incomePrivHash: 4,
  expectedCitizenship: 5,
  L: 6,
  U: 7,
  contextId: 8,
};

function readSignal(ps: any[] | Record<string, any>, key: keyof typeof IDX) {
  if (Array.isArray(ps)) return ps[IDX[key]];
  return (ps as any)?.[key];
}

const TOKENS = new Map<string, number>();
const TTL_SECONDS = 600;

let agent: TAgent;
let ISSUER_DID = "";

// pairing (off-chain)
const CHALLENGES = new Map<
  string,
  { id: string; challenge: string; exp: number }
>();
const CONNECTIONS = new Map<
  string,
  { holderDid: string; token: string; exp: number }
>();

const rid = (n = 16) => crypto.randomBytes(n).toString("hex");
const now = () => Date.now();

function issueToken(): { token: string; exp: number } {
  const token = "tk_" + crypto.randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  TOKENS.set(token, exp);
  return { token, exp };
}
function isValidToken(tok?: string) {
  if (!tok) return false;
  const exp = TOKENS.get(tok);
  if (!exp) return false;
  if (Math.floor(Date.now() / 1000) > exp) {
    TOKENS.delete(tok);
    return false;
  }
  return true;
}
function bearer(req: any) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h) return null;
  const m = /Bearer\s+(.+)/i.exec(String(h));
  return m ? m[1] : null;
}

async function ensureIssuerDid() {
  const ids = await agent.didManagerFind();
  let issuer = ids.find((i: any) => i.alias === "issuer");
  if (!issuer) {
    issuer = await agent.didManagerCreate({
      provider: "did:key",
      kms: "local",
      alias: "issuer",
    });
  }
  ISSUER_DID = issuer.did;
}

// bootstrap agent
(async () => {
  agent = await setupAgent();
  await ensureIssuerDid();
})();

// curățare tokens
setInterval(() => {
  const t = Math.floor(Date.now() / 1000);
  for (const [token, exp] of TOKENS.entries()) {
    if (exp < t) TOKENS.delete(token);
  }
}, 60_000);

// ───────────────────────────────────────────────────────────────────────────────
// ZK Present flow
// ───────────────────────────────────────────────────────────────────────────────
app.post("/present", async (req, res) => {
  console.log("\n Payload received @/present");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const { vp, contextId, nonce, zk } = req.body || {};

    if (contextId === undefined || contextId === null)
      throw new Error("contextId is missing");
    if (!isPack(zk)) throw new Error("zk pack invalid (proof/publicSignals)");
    if (nonce) console.log(`Nonce received: ${nonce} (extra security VP)`);

    console.log("\n Verification ZK proof...");
    const publicSignalsForVerify = Array.isArray(zk.publicSignals)
      ? zk.publicSignals
      : (() => {
          throw new Error(
            "publicSignals has to be an array (from public.json) for groth16 verify."
          );
        })();

    console.log(`publicSignals: ${publicSignalsForVerify.length} elements`);
    const ok = await snarkjs.groth16.verify(
      VERIFICATION_KEY,
      publicSignalsForVerify,
      zk.proof
    );
    if (!ok) throw new Error("zk verification failed");
    console.log("valid ZK proof");

    console.log("\n Verificare structură publicSignals...");
    const allValid = readSignal(zk.publicSignals, "allValid");
    const privHash = readSignal(zk.publicSignals, "privHash");
    const agePrivHash = readSignal(zk.publicSignals, "agePrivHash");
    const citizenshipPrivHash = readSignal(
      zk.publicSignals,
      "citizenshipPrivHash"
    );
    const incomePrivHash = readSignal(zk.publicSignals, "incomePrivHash");
    const expectedCitizenship = readSignal(
      zk.publicSignals,
      "expectedCitizenship"
    );
    const L = readSignal(zk.publicSignals, "L");
    const U = readSignal(zk.publicSignals, "U");
    const contextIdPS = readSignal(zk.publicSignals, "contextId");

    console.log(`   [${IDX.allValid}] allValid: ${allValid}`);
    console.log(`   [${IDX.privHash}] privHash: ${privHash}`);
    console.log(`   [${IDX.agePrivHash}] agePrivHash: ${agePrivHash}`);
    console.log(
      `   [${IDX.citizenshipPrivHash}] citizenshipPrivHash: ${citizenshipPrivHash}`
    );
    console.log(`   [${IDX.incomePrivHash}] incomePrivHash: ${incomePrivHash}`);
    console.log(
      `   [${IDX.expectedCitizenship}] expectedCitizenship: ${expectedCitizenship}`
    );
    console.log(` [${IDX.L}] L (minIncome): ${L}`);
    console.log(` [${IDX.U}] U (maxIncome): ${U}`);
    console.log(` [${IDX.contextId}] contextId: ${contextIdPS}`);

    if (allValid === undefined)
      throw new Error("allValid is missing from publicSignals");
    if (allValid !== "1" && allValid !== 1)
      throw new Error(`allValid has to be 1, but it's ${allValid}`);
    console.log("allValid = 1 (all verifications from circuit have passed)");

    if (contextIdPS === undefined)
      throw new Error("contextId is missing from publicSignals");
    if (!eqBig(contextIdPS, contextId)) {
      throw new Error(
        `contextId mismatch: expected "${contextId}", got "${contextIdPS}"`
      );
    }
    console.log("contextId match");

    if (!privHash || !agePrivHash || !citizenshipPrivHash || !incomePrivHash) {
      throw new Error("One or more hashes are missing from publicSignals");
    }
    console.log("All present hashes");

    console.log("\n Parameters verificated:");
    console.log(`Citizenship: ${expectedCitizenship}`);
    console.log(`Income range: [${L}, ${U}]`);
    console.log(`Context: ${contextId}`);

    const { token, exp } = issueToken();
    const expDate = new Date(exp * 1000).toISOString();

    console.log(`\n Valid payload!`);
    console.log(`Token issued: ${token.substring(0, 20)}...`);
    console.log(`Expires at: ${expDate}\n`);

    res.json({
      token,
      exp,
      status: "verified",
      verified: {
        allValid: true,
        contextId,
        citizenship: expectedCitizenship,
        incomeRange: { min: L, max: U },
      },
    });
  } catch (e: any) {
    console.error("\n Error @/present:", e.message || e);
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Context cache (off-chain)
app.post("/requests/register", (req, res) => {
  const { challengeHash, toCommit, context } = req.body || {};
  if (!challengeHash || !toCommit || !context)
    return res.status(400).json({ error: "bad_request" });

  const ctx: ZkContext = {
    contextId: String(context.contextId),
    expectedCitizenship: String(context.expectedCitizenship ?? ""),
    L: String(context.L ?? "0"),
    U: String(context.U ?? "0"),
    expiresAt: Number(context.expiresAt ?? Math.floor(Date.now() / 1000) + 600),
  };
  REQUESTS.set(String(challengeHash).toLowerCase(), {
    toCommit: String(toCommit).toLowerCase(),
    ctx,
  });
  return res.json({ ok: true });
});

app.post("/requests/claim", (req, res) => {
  const { challengeHash, did, salt } = req.body || {};
  if (!challengeHash || !did || !salt)
    return res.status(400).json({ error: "bad_request" });

  const rec = REQUESTS.get(String(challengeHash).toLowerCase());
  if (!rec) return res.status(404).json({ error: "unknown_request" });

  const computed = keccakDidSalt(String(did), String(salt)).toLowerCase();
  if (computed !== rec.toCommit)
    return res.status(400).json({ error: "commit_mismatch" });

  if (Math.floor(Date.now() / 1000) > rec.ctx.expiresAt)
    return res.status(400).json({ error: "expired" });

  return res.json({ ok: true, context: rec.ctx });
});

// Resursă protejată cu token
app.get("/secret", (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    console.log("/secret: No token provided");
    return res.status(401).json({
      error: "Token is missing",
      hint: "Use: Authorization: Bearer <token>",
    });
  }
  if (!isValidToken(token)) {
    console.log(`/secret: Invalid/expired token: ${token.substring(0, 20)}...`);
    return res.status(401).json({ error: "Invalid/expired token" });
  }

  console.log(
    `/secret: Access granted for token: ${token.substring(0, 20)}...`
  );
  res.json({
    message: "Access granted to protected resource!",
    secret: {
      data: "This is the confidential information",
      level: "restricted",
      timestamp: new Date().toISOString(),
    },
  });
});

// Health
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    circuit: CIRCUIT,
    activeTokens: TOKENS.size,
    timestamp: new Date().toISOString(),
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Pairing (off-chain) & Issuing
// ───────────────────────────────────────────────────────────────────────────────

// GET /connect/challenge -> { id, challenge, issuerDid, expiresAt }
app.get("/connect/challenge", (_req, res) => {
  const id = rid(8);
  const challenge = rid(16);
  const exp = now() + 5 * 60_000;
  CHALLENGES.set(id, { id, challenge, exp });
  res.json({ id, challenge, issuerDid: ISSUER_DID, expiresAt: exp });
});

// POST /connect/confirm  Body: { id, holderDid, payload, sig, alg }
// payload = { id, challenge, ts }
app.post("/connect/confirm", async (req, res) => {
  try {
    const { id, holderDid, payload, sig, alg } = req.body || {};
    const ch = CHALLENGES.get(String(id));
    if (!ch || ch.exp < now())
      return res.status(400).json({ error: "challenge_expired" });

    // 1) validează payload
    const expected = JSON.stringify({
      id: ch.id,
      challenge: ch.challenge,
      ts: payload?.ts ?? 0,
    });
    if (JSON.stringify(payload) !== expected)
      return res.status(400).json({ error: "payload_mismatch" });

    // 2) rezolvă DID & extrage cheia publică
    const didDoc = await agent.resolveDid({ didUrl: holderDid });
    const { type, pub } = extractPubKeyFromDidDoc(didDoc);

    // 3) verifică semnătura
    const msg = utf8(JSON.stringify(payload));
    const signature = b64uToBytes(sig);
    const ok =
      type === "Ed25519"
        ? edc.verify(signature, msg, pub)
        : secp.verify(signature, sha256(msg), pub); // ES256K

    if (!ok) return res.status(400).json({ error: "bad_signature" });

    // 4) emite conexiunea
    const connectionId = rid(8);
    const token = rid(24);
    const exp = now() + 24 * 60 * 60_000;
    CONNECTIONS.set(connectionId, { holderDid, token, exp });
    CHALLENGES.delete(id);

    res.json({ connectionId, token, holderDid, issuerDid: ISSUER_DID });
  } catch (e: any) {
    res.status(400).json({ error: "verification_failed", message: e?.message });
  }
});

// POST /issue  (Authorization: Bearer <token>)
// body: { subjectDid, claims, type?, validitySeconds? }
app.post("/issue", async (req, res) => {
  try {
    const tok = bearer(req);
    if (!tok) return res.status(401).json({ error: "missing_token" });

    const conn = [...CONNECTIONS.values()].find(
      (c) => c.token === tok && c.exp > now()
    );
    if (!conn)
      return res.status(401).json({ error: "invalid_or_expired_token" });

    const { subjectDid, claims, type, validitySeconds } = req.body || {};
    if (!subjectDid || typeof claims !== "object")
      return res.status(400).json({ error: "bad_request" });
    if (subjectDid !== conn.holderDid)
      return res.status(400).json({ error: "subject_mismatch" });

    const issuanceDate = new Date().toISOString();
    const expSec = validitySeconds
      ? Math.floor(Date.now() / 1000) + Number(validitySeconds)
      : undefined;

    const verifiableCredential = await agent.createVerifiableCredential({
      credential: {
        issuer: { id: ISSUER_DID },
        issuanceDate,
        expirationDate: expSec
          ? new Date(expSec * 1000).toISOString()
          : undefined,
        type: [
          "VerifiableCredential",
          ...(Array.isArray(type) ? type : type ? [type] : []),
        ],
        credentialSubject: { id: subjectDid, ...claims },
      },
      proofFormat: "jwt",
    });

    res.json({ ok: true, vc: verifiableCredential });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// ───────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nVerifier running on http://localhost:${PORT}`);
  console.log(`Circuit: ${CIRCUIT}`);
  console.log(`Verification key: ${VK_PATH}`);
});
