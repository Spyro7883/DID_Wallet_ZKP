import express from "express";
import cors from "cors";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak256, toUtf8Bytes } from "ethers";
import * as snarkjs from "snarkjs";

import "reflect-metadata";
import { setupAgent, type TAgent } from "./agent.ts";

import { base64url } from "jose";
import { ed25519 as edc } from "@noble/curves/ed25519";
import { secp256k1 as secp } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";

import bs58 from "bs58";

import * as zlib from "node:zlib";
import { DataSource } from "typeorm";
import { Entities } from "@veramo/data-store";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
const PORT = 5501;

// const CIRCUIT = process.env.CIRCUIT || "aggregate";
// const VK_PATH = `./build/${CIRCUIT}/verification_key.json`;
// const VERIFICATION_KEY = JSON.parse(readFileSync(VK_PATH, "utf8"));

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const TABLES = [
  "wallet_meta",
  "identifier",
  "key",
  "private-key",
  "service",
  "credential",
  "claim",
  "message",
  "message_credentials_credential",
  "message_presentations_presentation",
  "presentation",
  "presentation_credentials_credential",
  "presentation_verifier_identifier",
] as const;

const slug = (p: string) =>
  (p || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

const schemaFor = (profile: string) => `wallet_${slug(profile)}`;

const gzip = (b: Buffer) =>
  new Promise<Buffer>((res, rej) =>
    zlib.gzip(b, (e, o) => (e ? rej(e) : res(o))),
  );

async function ds(schema?: string, withEntities = false): Promise<DataSource> {
  const useSsl = String(process.env.DB_SSL || "").toLowerCase() === "true";
  const d = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.POSTGRESQL_USER,
    password: process.env.POSTGRESQL_PASS,
    database: process.env.POSTGRESQL_DB,
    schema,
    entities: withEntities ? (Entities as any) : undefined,
    synchronize: false,
    logging: ["warn", "error"],
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  } as any);

  if (!d.isInitialized) await d.initialize();
  return d;
}

async function ensureAdminUsersTable() {
  const d = await ds();
  try {
    await d.query(`
      CREATE TABLE IF NOT EXISTS public.admin_users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } finally {
    await d.destroy();
  }
}

async function ensureAdminSettingsTable() {
  const d = await ds();
  try {
    await d.query(`
      CREATE TABLE IF NOT EXISTS public.admin_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } finally {
    await d.destroy();
  }
}

async function getSetting<T = any>(key: string): Promise<T | null> {
  const d = await ds();
  try {
    const rows = await d.query(
      `SELECT value FROM public.admin_settings WHERE key = $1 LIMIT 1`,
      [key],
    );
    return rows?.[0]?.value ?? null;
  } finally {
    await d.destroy();
  }
}

async function setSetting(key: string, value: any) {
  const d = await ds();
  try {
    await d.query(
      `
      INSERT INTO public.admin_settings (key, value)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `,
      [key, JSON.stringify(value)],
    );
  } finally {
    await d.destroy();
  }
}

function requireAdmin(req: any, res: any, next: any) {
  const h = req.headers.authorization || req.headers.Authorization;
  const m = /Bearer\s+(.+)/i.exec(String(h || ""));
  const token = m?.[1];
  if (!token) return res.status(401).send("missing_token");

  try {
    const secret = process.env.ADMIN_JWT_SECRET!;
    const payload = jwt.verify(token, secret) as any;
    (req as any).admin = payload;
    return next();
  } catch {
    return res.status(401).send("invalid_token");
  }
}

function toSaltBuffer(v: any): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "string") {
    try {
      return Buffer.from(v, "base64");
    } catch {
      return Buffer.from(v);
    }
  }
  return Buffer.from(v);
}

function verifyWalletPass(
  passphrase: string,
  salt: Buffer,
  passGuardHex: string,
): boolean {
  const dk = crypto.scryptSync(passphrase, salt, 32);
  const calcGuard = crypto
    .createHmac("sha256", dk)
    .update("kms-guard-v1")
    .digest("hex");
  return !!passGuardHex && calcGuard === passGuardHex;
}

type ProofPack = { proof: any; publicSignals: any[] | Record<string, any> };
type ZkContext = {
  contextId: string;
  expectedCitizenship: string;
  L: string | number;
  U: string | number;
  expiresAt: number;
};

function signAdminToken(payload: { sub: string; email: string; role: string }) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error("Missing ADMIN_JWT_SECRET");
  return jwt.sign(payload, secret, { expiresIn: "12h" });
}

const REQUESTS = new Map<string, { toCommit: string; ctx: ZkContext }>();

const b64uToBytes = (s: string) => new Uint8Array(base64url.decode(s));
const utf8 = (s: string) => new TextEncoder().encode(s);

function normalizeSecpPub(raw: Uint8Array): Uint8Array {
  if (raw.length === 33) return raw;
  if (raw.length === 65 && raw[0] === 0x04) {
    return secp.ProjectivePoint.fromHex(raw).toRawBytes(true);
  }
  if (raw.length === 64) {
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

    if (mb) {
      const raw = bs58.decode(String(mb).replace(/^z/, ""));
      if (raw.length >= 2) {
        const prefix = (raw[0] << 8) | raw[1];
        const body = raw.slice(2);
        if (prefix === 0xed01) {
          return { type: "Ed25519", pub: body };
        }
        if (prefix === 0xe701) {
          return { type: "Secp256k1", pub: normalizeSecpPub(body) };
        }
      }
      if (t.includes("ed25519")) return { type: "Ed25519", pub: raw.slice(2) };
      if (t.includes("secp256k1"))
        return { type: "Secp256k1", pub: normalizeSecpPub(raw.slice(2)) };
    }

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

function keccakDidSalt(did: string, saltHex: string, challengeHash: string) {
  const salt = Buffer.from(saltHex.replace(/^0x/, ""), "hex");
  const bytes = new Uint8Array([
    ...toUtf8Bytes(did),
    ...salt,
    ...toUtf8Bytes(challengeHash),
  ]);
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

const CHALLENGES = new Map<
  string,
  { id: string; challenge: string; exp: number }
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

async function ensureIssuerDid() {
  const ids = await agent.didManagerFind();
  const pref = await getSetting<{ did: string }>("issuer_did");
  if (pref?.did) {
    const found = ids.find((i: any) => i.did === pref.did);
    if (found) {
      ISSUER_DID = found.did;
      return;
    }
  }

  let issuer = ids.find((i: any) => i.alias === "issuer");
  if (!issuer) {
    issuer = await agent.didManagerCreate({
      provider: "did:key",
      kms: "local",
      alias: "issuer",
    });
  }
  ISSUER_DID = issuer.did;
  await setSetting("issuer_did", { did: ISSUER_DID });
}

const gunzip = (b: Buffer) =>
  new Promise<Buffer>((res, rej) =>
    zlib.gunzip(b, (e, o) => (e ? rej(e) : res(o))),
  );

async function ensureSchema(schema: string) {
  const d = await ds();
  await d.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await d.destroy();
}

async function schemaIsEmpty(schema: string): Promise<boolean> {
  const d = await ds(schema);
  try {
    for (const t of TABLES) {
      const r = await d
        .query(`SELECT 1 FROM "${schema}"."${t}" LIMIT 1;`)
        .catch(() => []);
      if (Array.isArray(r) && r.length > 0) return false;
    }
    return true;
  } finally {
    await d.destroy();
  }
}

(async () => {
  await ensureAdminUsersTable();
  await ensureAdminSettingsTable();
  await ensureVcIssuanceLogTable();
  await ensureVcRequestsTable();

  agent = await setupAgent(
    "issuer",
    process.env.ISSUER_KMS_PASSPHRASE || "change-me",
  );
  await ensureIssuerDid();
})();

setInterval(() => {
  const t = Math.floor(Date.now() / 1000);
  for (const [token, exp] of TOKENS.entries()) {
    if (exp < t) TOKENS.delete(token);
  }
}, 60_000);

// app.post("/present", async (req, res) => {
//   console.log("\n Payload received @/present");
//   console.log(JSON.stringify(req.body, null, 2));

//   try {
//     const { vp, contextId, nonce, zk } = req.body || {};

//     if (contextId === undefined || contextId === null)
//       throw new Error("contextId is missing");
//     if (!isPack(zk)) throw new Error("zk pack invalid (proof/publicSignals)");
//     if (nonce) console.log(`Nonce received: ${nonce} (extra security VP)`);

//     console.log("\n Verification ZK proof...");
//     const publicSignalsForVerify = Array.isArray(zk.publicSignals)
//       ? zk.publicSignals
//       : (() => {
//           throw new Error(
//             "publicSignals has to be an array (from public.json) for groth16 verify.",
//           );
//         })();

//     console.log(`publicSignals: ${publicSignalsForVerify.length} elements`);
//     const ok = await snarkjs.groth16.verify(
//       VERIFICATION_KEY,
//       publicSignalsForVerify,
//       zk.proof,
//     );
//     if (!ok) throw new Error("zk verification failed");
//     console.log("valid ZK proof");

//     console.log("\n Structured verification publicSignals...");
//     const allValid = readSignal(zk.publicSignals, "allValid");
//     const privHash = readSignal(zk.publicSignals, "privHash");
//     const agePrivHash = readSignal(zk.publicSignals, "agePrivHash");
//     const citizenshipPrivHash = readSignal(
//       zk.publicSignals,
//       "citizenshipPrivHash",
//     );
//     const incomePrivHash = readSignal(zk.publicSignals, "incomePrivHash");
//     const expectedCitizenship = readSignal(
//       zk.publicSignals,
//       "expectedCitizenship",
//     );
//     const L = readSignal(zk.publicSignals, "L");
//     const U = readSignal(zk.publicSignals, "U");
//     const contextIdPS = readSignal(zk.publicSignals, "contextId");

//     console.log(`   [${IDX.allValid}] allValid: ${allValid}`);
//     console.log(`   [${IDX.privHash}] privHash: ${privHash}`);
//     console.log(`   [${IDX.agePrivHash}] agePrivHash: ${agePrivHash}`);
//     console.log(
//       `   [${IDX.citizenshipPrivHash}] citizenshipPrivHash: ${citizenshipPrivHash}`,
//     );
//     console.log(`   [${IDX.incomePrivHash}] incomePrivHash: ${incomePrivHash}`);
//     console.log(
//       `   [${IDX.expectedCitizenship}] expectedCitizenship: ${expectedCitizenship}`,
//     );
//     console.log(` [${IDX.L}] L (minIncome): ${L}`);
//     console.log(` [${IDX.U}] U (maxIncome): ${U}`);
//     console.log(` [${IDX.contextId}] contextId: ${contextIdPS}`);

//     if (allValid === undefined)
//       throw new Error("allValid is missing from publicSignals");
//     if (allValid !== "1" && allValid !== 1)
//       throw new Error(`allValid has to be 1, but it's ${allValid}`);
//     console.log("allValid = 1 (all verifications from circuit have passed)");

//     if (contextIdPS === undefined)
//       throw new Error("contextId is missing from publicSignals");
//     if (!eqBig(contextIdPS, contextId)) {
//       throw new Error(
//         `contextId mismatch: expected "${contextId}", got "${contextIdPS}"`,
//       );
//     }
//     console.log("contextId match");

//     if (!privHash || !agePrivHash || !citizenshipPrivHash || !incomePrivHash) {
//       throw new Error("One or more hashes are missing from publicSignals");
//     }
//     console.log("All present hashes");

//     console.log("\n Parameters verificated:");
//     console.log(`Citizenship: ${expectedCitizenship}`);
//     console.log(`Income range: [${L}, ${U}]`);
//     console.log(`Context: ${contextId}`);

//     const { token, exp } = issueToken();
//     const expDate = new Date(exp * 1000).toISOString();

//     console.log(`\n Valid payload!`);
//     console.log(`Token issued: ${token.substring(0, 20)}...`);
//     console.log(`Expires at: ${expDate}\n`);

//     res.json({
//       token,
//       exp,
//       status: "verified",
//       verified: {
//         allValid: true,
//         contextId,
//         citizenship: expectedCitizenship,
//         incomeRange: { min: L, max: U },
//       },
//     });
//   } catch (e: any) {
//     console.error("\n Error @/present:", e.message || e);
//     res.status(400).json({ error: String(e?.message ?? e) });
//   }
// });

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

  const computed = keccakDidSalt(
    String(did),
    String(salt),
    String(challengeHash),
  ).toLowerCase();
  if (computed !== rec.toCommit)
    return res.status(400).json({ error: "commit_mismatch" });

  if (Math.floor(Date.now() / 1000) > rec.ctx.expiresAt)
    return res.status(400).json({ error: "expired" });

  return res.json({ ok: true, context: rec.ctx });
});

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
    `/secret: Access granted for token: ${token.substring(0, 20)}...`,
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

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    // circuit: CIRCUIT,
    activeTokens: TOKENS.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/connect/challenge", (_req, res) => {
  const id = rid(8);
  const challenge = rid(16);
  const exp = now() + 5 * 60_000;
  CHALLENGES.set(id, { id, challenge, exp });
  console.log(
    `[connect] challenge issued id=${id} exp=${new Date(exp).toISOString()}`,
  );
  res.json({ id, challenge, issuerDid: ISSUER_DID, expiresAt: exp });
});

app.post("/connect/confirm", async (req, res) => {
  try {
    const { id, holderDid, payload, sig, alg } = req.body || {};
    console.log(
      `[connect] confirm start id=${id} holder=${holderDid} alg=${alg}`,
    );
    const ch = CHALLENGES.get(String(id));
    if (!ch || ch.exp < now()) {
      console.warn(`[connect] challenge expired/missing id=${id}`);
      return res.status(400).json({ error: "challenge_expired" });
    }

    if (
      !payload ||
      payload.id !== ch.id ||
      payload.challenge !== ch.challenge
    ) {
      return res.status(400).json({ error: "payload_mismatch" });
    }

    const didDoc = await agent.resolveDid({ didUrl: holderDid });
    const { type, pub } = extractPubKeyFromDidDoc(didDoc);

    const msg = utf8(JSON.stringify(payload));
    const signature = b64uToBytes(sig);
    const ok =
      type === "Ed25519"
        ? edc.verify(signature, msg, pub)
        : secp.verify(signature, sha256(msg), pub);

    if (!ok) return res.status(400).json({ error: "bad_signature" });

    const holderToken = signHolderToken({ sub: holderDid, holderDid });

    // 2) consumă challenge-ul (nu mai ai nevoie de CONNECTIONS Map)
    CHALLENGES.delete(String(id));

    console.log(`[connect] ✅ paired holder=${holderDid}`);

    // 3) răspuns
    return res.json({
      ok: true,
      holderDid,
      issuerDid: ISSUER_DID,
      token: holderToken,
      expiresIn: 24 * 60 * 60,
    });
  } catch (e: any) {
    console.error(`[connect] ❌ verification_failed: ${e?.message || e}`);
    res.status(400).json({ error: "verification_failed", message: e?.message });
  }
});

const VC_POLICY: Record<
  string,
  {
    allowedClaims: string[];
    requiredClaims: string[];
    maxValidityDays: number;
  }
> = {
  AgeCredential: {
    allowedClaims: ["dateOfBirth"],
    requiredClaims: ["dateOfBirth"],
    maxValidityDays: 3650,
  },
  CitizenshipCredential: {
    allowedClaims: ["citizenship"],
    requiredClaims: ["citizenship"],
    maxValidityDays: 3650,
  },
  IncomeCredential: {
    allowedClaims: ["incomeMin", "incomeMax", "currency"],
    requiredClaims: ["incomeMin", "incomeMax", "currency"],
    maxValidityDays: 365,
  },
};
function pickClaims(input: any, allowed: string[]) {
  const out: Record<string, any> = {};
  for (const k of allowed) {
    if (input?.[k] !== undefined) out[k] = input[k];
  }
  return out;
}

function assertRequired(obj: Record<string, any>, required: string[]) {
  for (const k of required) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") {
      throw new Error(`missing_claim:${k}`);
    }
  }
}

function validateClaims(mainType: string, claims: Record<string, any>) {
  if (mainType === "CitizenshipCredential") {
    const c = String(claims.citizenship || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw new Error("bad_citizenship");
    claims.citizenship = c;
  }

  if (mainType === "AgeCredential") {
    const dob = String(claims.dateOfBirth || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error("bad_dateOfBirth");
  }

  if (mainType === "IncomeCredential") {
    const min = Number(claims.incomeMin);
    const max = Number(claims.incomeMax);
    const cur = String(claims.currency || "").toUpperCase();
    if (!Number.isFinite(min) || !Number.isFinite(max))
      throw new Error("bad_income_range");
    if (min > max) throw new Error("income_min_gt_max");
    if (!/^[A-Z]{3}$/.test(cur)) throw new Error("bad_currency");
    claims.incomeMin = min;
    claims.incomeMax = max;
    claims.currency = cur;
  }
}

function clampValidityDays(requested: any, maxDays: number) {
  const d = Number(requested);
  if (!Number.isFinite(d) || d <= 0) return maxDays;
  return Math.min(Math.floor(d), maxDays);
}

function signHolderToken(payload: { sub: string; holderDid: string }) {
  const secret = process.env.HOLDER_JWT_SECRET;
  if (!secret) throw new Error("Missing HOLDER_JWT_SECRET");
  return jwt.sign({ ...payload, typ: "holder" }, secret, { expiresIn: "24h" });
}

function requireHolder(req: any, res: any, next: any) {
  const h = req.headers.authorization || req.headers.Authorization;
  const m = /Bearer\s+(.+)/i.exec(String(h || ""));
  const token = m?.[1];
  if (!token)
    return res.status(401).json({ ok: false, error: "missing_token" });

  try {
    const secret = process.env.HOLDER_JWT_SECRET!;
    const payload = jwt.verify(token, secret) as any;
    if (payload?.typ !== "holder" || !payload?.holderDid) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }
    (req as any).holder = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
}

function sigToB64u(sig: string): string {
  const s = String(sig || "").trim();

  if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0) {
    return base64url.encode(Buffer.from(s, "hex"));
  }

  try {
    base64url.decode(s);
    return s;
  } catch {}

  try {
    return base64url.encode(Buffer.from(s, "base64"));
  } catch {}

  return base64url.encode(Buffer.from(s, "utf8"));
}

app.post("/wallets/sign", async (req, res) => {
  try {
    const { profile, passphrase, did, payload } = req.body || {};
    if (!profile || !passphrase || !did || !payload) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const walletAgent = await setupAgent(
      String(profile).trim(),
      String(passphrase),
    );

    const dids = await walletAgent.didManagerFind();
    const ident = (dids || []).find((i: any) => String(i.did) === String(did));
    if (!ident)
      return res.status(404).json({ ok: false, error: "did_not_found" });

    const keyRef = ident.keys?.[0]?.kid || ident.controllerKeyId || ident.kid;

    if (!keyRef)
      return res.status(400).json({ ok: false, error: "no_key_for_did" });

    const keyType = String(ident.keys?.[0]?.type || "").toLowerCase();
    const algorithm = keyType.includes("ed25519") ? "EdDSA" : "ES256K";

    const data = JSON.stringify(payload);

    const sigRaw: string = await (walletAgent as any).keyManagerSign({
      keyRef,
      data,
      encoding: "utf-8",
      algorithm,
    });

    const sig = sigToB64u(sigRaw);

    return res.json({ ok: true, alg: algorithm, sig });
  } catch (e: any) {
    console.error("[/wallets/sign] error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "sign_failed", message: e?.message });
  }
});

app.post("/vc/requests", requireHolder, async (req, res) => {
  try {
    const holderDid = String((req as any).holder?.holderDid || "").trim();
    if (!holderDid.startsWith("did:")) {
      return res.status(401).json({ ok: false, error: "bad_holder" });
    }

    const type = String(req.body?.type || "").trim();
    const policy = VC_POLICY[type];
    if (!policy) {
      return res.status(400).json({ ok: false, error: "type_not_allowed" });
    }

    const claimsIn = req.body?.claims;
    if (!claimsIn || typeof claimsIn !== "object" || Array.isArray(claimsIn)) {
      return res
        .status(400)
        .json({ ok: false, error: "claims_must_be_object" });
    }

    const subjectDid = String(req.body?.subjectDid || holderDid).trim();
    if (subjectDid !== holderDid) {
      return res
        .status(400)
        .json({ ok: false, error: "subject_must_equal_holder" });
    }

    const claims = pickClaims(claimsIn, policy.allowedClaims);
    try {
      assertRequired(claims, policy.requiredClaims);
      validateClaims(type, claims);
    } catch (e: any) {
      return res
        .status(400)
        .json({ ok: false, error: String(e?.message || e) });
    }

    const validityDays = clampValidityDays(
      req.body?.validityDays,
      policy.maxValidityDays,
    );

    const d = await ds();
    try {
      const rows = await d.query(
        `INSERT INTO public.vc_requests
         (status, holder_did, subject_did, vc_type, claims, validity_days)
         VALUES ('pending', $1, $2, $3, $4::jsonb, $5)
         RETURNING id, status, created_at`,
        [holderDid, subjectDid, type, JSON.stringify(claims), validityDays],
      );

      const r = rows?.[0];
      return res.json({
        ok: true,
        request: {
          id: Number(r.id),
          status: String(r.status),
          createdAt: String(r.created_at),
        },
      });
    } finally {
      await d.destroy();
    }
  } catch (e: any) {
    console.error("[/vc/requests] error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "request_failed", message: e?.message });
  }
});

app.get("/vc/requests/:id", requireHolder, async (req, res) => {
  const holderDid = String((req as any).holder?.holderDid || "").trim();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }

  const d = await ds();
  try {
    const rows = await d.query(
      `SELECT id, status, holder_did, subject_did, vc_type, claims,
              validity_days, created_at, decided_at, decided_by, decision_note,
              issued_vc_hash, issued_vc_jwt
       FROM public.vc_requests
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    const row = rows?.[0];
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });

    if (String(row.holder_did) !== holderDid) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    return res.json({
      ok: true,
      request: {
        id: Number(row.id),
        status: String(row.status),
        holderDid: String(row.holder_did),
        subjectDid: String(row.subject_did),
        vcType: String(row.vc_type),
        claims: row.claims ?? {},
        validityDays: row.validity_days ?? null,
        createdAt: String(row.created_at),
        decidedAt: row.decided_at ? String(row.decided_at) : null,
        decidedBy: row.decided_by ? String(row.decided_by) : null,
        decisionNote: row.decision_note ? String(row.decision_note) : null,
        issued: row.issued_vc_hash
          ? {
              vcHash: String(row.issued_vc_hash),
              vcJwt: row.issued_vc_jwt ? String(row.issued_vc_jwt) : null,
            }
          : null,
      },
    });
  } finally {
    await d.destroy();
  }
});

app.get("/admin/vc/requests", requireAdmin, async (req, res) => {
  const status = String(req.query?.status || "pending").toLowerCase();
  const allowed = new Set(["pending", "approved", "rejected", "all"]);
  const st = allowed.has(status) ? status : "pending";

  const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
  const offset = Math.max(0, Number(req.query?.offset || 0));

  const d = await ds();
  try {
    const where = st === "all" ? "" : "WHERE status = $1";
    const params: any[] = st === "all" ? [] : [st];

    // pagination params
    params.push(limit, offset);

    const rows = await d.query(
      `
      SELECT id, status, holder_did, subject_did, vc_type, created_at,
             decided_at, decided_by, issued_vc_hash
      FROM public.vc_requests
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );

    return res.json({ ok: true, items: rows || [] });
  } finally {
    await d.destroy();
  }
});

app.post("/admin/vc/requests/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }

  const adminEmail = String((req as any).admin?.email || "");

  const d = await ds();
  const qr = d.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();

  try {
    // lock row
    const rows = await qr.query(
      `SELECT id, status, holder_did, subject_did, vc_type, claims, validity_days
       FROM public.vc_requests
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const r = rows?.[0];
    if (!r) {
      await qr.rollbackTransaction();
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (String(r.status) !== "pending") {
      await qr.rollbackTransaction();
      return res
        .status(409)
        .json({ ok: false, error: "not_pending", status: String(r.status) });
    }

    const type = String(r.vc_type);
    const policy = VC_POLICY[type];
    if (!policy) {
      await qr.rollbackTransaction();
      return res.status(400).json({ ok: false, error: "type_not_allowed" });
    }

    // claims in DB are already filtered, but re-validate
    const claims = r.claims && typeof r.claims === "object" ? r.claims : {};
    try {
      assertRequired(claims, policy.requiredClaims);
      validateClaims(type, claims);
    } catch (e: any) {
      await qr.rollbackTransaction();
      return res
        .status(400)
        .json({ ok: false, error: String(e?.message || e) });
    }

    const validityDays = clampValidityDays(
      r.validity_days ?? policy.maxValidityDays,
      policy.maxValidityDays,
    );

    const issuanceDate = new Date().toISOString();
    const expirationDate = new Date(
      Date.now() + validityDays * 86400_000,
    ).toISOString();

    const subjectDid = String(r.subject_did);

    const vc = await agent.createVerifiableCredential({
      credential: {
        issuer: { id: ISSUER_DID },
        issuanceDate,
        expirationDate,
        type: ["VerifiableCredential", type],
        credentialSubject: { id: subjectDid, ...claims },
      },
      proofFormat: "jwt",
    });

    const vcHash = hashVcPayload(vc);

    const vcJwt =
      typeof vc === "string"
        ? vc
        : (vc as any)?.proof?.jwt
        ? String((vc as any).proof.jwt)
        : JSON.stringify(vc);

    await qr.query(
      `UPDATE public.vc_requests
       SET status = 'approved',
           decided_at = now(),
           decided_by = $2,
           decision_note = $3,
           issued_vc_hash = $4,
           issued_vc_jwt = $5
       WHERE id = $1`,
      [
        id,
        adminEmail || null,
        String(req.body?.note || "").slice(0, 500) || null,
        vcHash,
        vcJwt,
      ],
    );

    await qr.query(
      `INSERT INTO public.vc_issuance_log
       (admin_email, issuer_did, subject_did, vc_type, claims, issuance_date, expiration_date, vc_hash, vc_jwt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        adminEmail || null,
        ISSUER_DID,
        subjectDid,
        type,
        JSON.stringify(claims),
        issuanceDate,
        expirationDate,
        vcHash,
        vcJwt,
      ],
    );

    await qr.commitTransaction();

    return res.json({
      ok: true,
      requestId: id,
      vcHash,
      vc,
    });
  } catch (e: any) {
    await qr.rollbackTransaction();
    console.error("[/admin/vc/requests/:id/approve] error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "approve_failed", message: e?.message });
  } finally {
    await qr.release();
    await d.destroy();
  }
});

app.get("/admin/vc/requests/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ ok: false, error: "bad_id" });

  const d = await ds();
  try {
    const rows = await d.query(
      `SELECT id, status, holder_did, subject_did, vc_type, claims, validity_days,
              created_at, decided_at, decided_by, decision_note, issued_vc_hash
       FROM public.vc_requests
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    const row = rows?.[0];
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, request: row });
  } finally {
    await d.destroy();
  }
});

app.post("/wallets", async (req, res) => {
  try {
    const { profile, passphrase } = req.body || {};

    if (!profile || !passphrase) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const safeProfile = String(profile).trim();

    console.log(`[wallets] create profile="${safeProfile}"`);

    await setupAgent(safeProfile, passphrase);

    return res.json({ ok: true, profile: safeProfile });
  } catch (e: any) {
    console.error("[wallets] create error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "wallet_create_failed" });
  }
});

app.post("/wallets/summary", async (req, res) => {
  try {
    const { profile, passphrase, limit } = req.body || {};
    if (!profile || !passphrase) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const safeProfile = String(profile).trim();
    const safeLimit = Number(limit ?? 3);

    const walletAgent = await setupAgent(safeProfile, String(passphrase));

    const dids = await walletAgent.didManagerFind();
    const vcs = await walletAgent.dataStoreORMGetVerifiableCredentials();
    const vps = await walletAgent.dataStoreORMGetVerifiablePresentations();

    const activeDid = dids[0]?.did ?? null;

    const didItems = dids.map((d: any) => ({
      id: d.did,
      kind: "did" as const,
      title: "[DID] " + (d.alias || "identity"),
      subject: d.did,
      issuedAt: d.createdAt
        ? `Created: ${String(d.createdAt).slice(0, 10)}`
        : "Created: -",
      _sort: d.createdAt ? Date.parse(String(d.createdAt)) : 0,
    }));

    const vcItems = vcs.map((row: any) => {
      const vc = row.verifiableCredential;
      const typeArr = Array.isArray(vc?.type)
        ? vc.type
        : [vc?.type].filter(Boolean);
      const mainType =
        typeArr.find((t: string) => t !== "VerifiableCredential") ||
        "VerifiableCredential";

      const subjectId =
        typeof vc?.credentialSubject === "object"
          ? vc?.credentialSubject?.id
          : undefined;

      const issuance = vc?.issuanceDate ? String(vc.issuanceDate) : "";

      return {
        id: row.hash,
        kind: "vc" as const,
        title: `[Credential] ${mainType}`,
        subject: `Subject: ${subjectId ?? "-"}`,
        issuedAt: issuance ? `Issued: ${issuance.slice(0, 10)}` : "Issued: -",
        _sort: issuance ? Date.parse(issuance) : 0,
      };
    });

    const vpItems = vps.map((row: any) => {
      const vp = row.verifiablePresentation;
      const created =
        (vp as any)?.issuanceDate ||
        (vp as any)?.createdAt ||
        row.createdAt ||
        "";
      const holder = vp?.holder ?? "-";

      return {
        id: row.hash,
        kind: "vp" as const,
        title: "[Presentation] VP",
        subject: `Holder: ${holder}`,
        issuedAt: created
          ? `Created: ${String(created).slice(0, 10)}`
          : "Created: -",
        _sort: created ? Date.parse(String(created)) : 0,
      };
    });

    const recentItems = [...vcItems, ...vpItems, ...didItems]
      .sort((a, b) => b._sort - a._sort)
      .slice(0, safeLimit)
      .map(({ _sort, ...x }) => x);

    return res.json({
      ok: true,
      profile: safeProfile,
      activeDid,
      stats: { dids: dids.length, vcs: vcs.length, vps: vps.length },
      recentItems,
    });
  } catch (e: any) {
    console.error("[wallets/summary] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "summary_failed" });
  }
});

app.post("/wallets/item", async (req, res) => {
  try {
    const { profile, passphrase, kind, id, resolveDidDoc } = req.body || {};
    if (!profile || !passphrase || !kind || !id) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const safeProfile = String(profile).trim();
    const walletAgent = await setupAgent(safeProfile, String(passphrase));

    const k = String(kind);

    if (k === "did") {
      const did = String(id);
      const dids = await walletAgent.didManagerFind();
      const found = dids.find((d: any) => String(d.did) === did);
      if (!found)
        return res.status(404).json({ ok: false, error: "did_not_found" });

      let didDoc: any = null;
      if (resolveDidDoc) {
        try {
          didDoc = await walletAgent.resolveDid({ didUrl: did });
        } catch {
          didDoc = null;
        }
      }

      return res.json({
        ok: true,
        item: {
          kind: "did",
          id: did,
          identifier: found,
          didDoc,
        },
      });
    }

    if (k === "vc") {
      const hash = String(id);
      const rows = await walletAgent.dataStoreORMGetVerifiableCredentials();
      const row = (rows || []).find((r: any) => String(r.hash) === hash);
      if (!row)
        return res.status(404).json({ ok: false, error: "vc_not_found" });

      return res.json({
        ok: true,
        item: {
          kind: "vc",
          id: hash,
          hash: row.hash,
          verifiableCredential: row.verifiableCredential,
          createdAt: row.createdAt ?? null,
        },
      });
    }

    if (k === "vp") {
      const hash = String(id);
      const rows = await walletAgent.dataStoreORMGetVerifiablePresentations();
      const row = (rows || []).find((r: any) => String(r.hash) === hash);
      if (!row)
        return res.status(404).json({ ok: false, error: "vp_not_found" });

      return res.json({
        ok: true,
        item: {
          kind: "vp",
          id: hash,
          hash: row.hash,
          verifiablePresentation: row.verifiablePresentation,
          createdAt: row.createdAt ?? null,
        },
      });
    }

    return res.status(400).json({ ok: false, error: "unsupported_kind" });
  } catch (e: any) {
    return res
      .status(401)
      .json({ ok: false, error: String(e?.message || "unauthorized") });
  }
});

app.post("/wallets/items", async (req, res) => {
  try {
    const {
      profile,
      passphrase,
      kind = "all",
      q = "",
      limit = 50,
      offset = 0,
    } = req.body || {};
    if (!profile || !passphrase)
      return res.status(400).json({ ok: false, error: "missing_fields" });

    const safeProfile = String(profile).trim();
    const walletAgent = await setupAgent(safeProfile, String(passphrase));

    const dids = await walletAgent.didManagerFind();
    const vcs = await walletAgent.dataStoreORMGetVerifiableCredentials();
    const vps = await walletAgent.dataStoreORMGetVerifiablePresentations();

    const items: any[] = [];

    for (const d of dids) {
      items.push({
        kind: "did",
        id: d.did,
        title: d.alias || "DID",
        line1: d.did,
        line2: `Provider: ${d.provider} · Keys: ${d.keys?.length ?? 0}`,
        _sort: 0,
      });
    }

    for (const row of vcs) {
      const vc = row.verifiableCredential;
      const typeArr = Array.isArray(vc?.type)
        ? vc.type
        : [vc?.type].filter(Boolean);
      const mainType =
        typeArr.find((t: string) => t !== "VerifiableCredential") ||
        "VerifiableCredential";

      const subjectId =
        typeof vc?.credentialSubject === "object"
          ? vc?.credentialSubject?.id
          : undefined;

      const issuance = vc?.issuanceDate ? String(vc.issuanceDate) : "";
      const issuedShort = issuance ? issuance.slice(0, 10) : "-";

      items.push({
        kind: "vc",
        id: row.hash,
        title: mainType,
        line1: `Subject: ${subjectId ?? "-"}`,
        line2: `Issued: ${issuedShort}`,
        _sort: issuance ? Date.parse(issuance) || 0 : 0,
      });
    }

    for (const row of vps) {
      const vp = row.verifiablePresentation;
      const holder = vp?.holder ? String(vp.holder) : "-";
      const vcCount = Array.isArray(vp?.verifiableCredential)
        ? vp.verifiableCredential.length
        : 0;

      const created = (vp as any)?.proof?.created
        ? String((vp as any).proof.created)
        : "";
      const createdShort = created ? created.slice(0, 10) : "-";

      items.push({
        kind: "vp",
        id: row.hash,
        title: "VP",
        line1: `Holder: ${holder}`,
        line2: `Created: ${createdShort} · VCs: ${vcCount}`,
        _sort: created ? Date.parse(created) || 0 : 0,
      });
    }

    const k = String(kind);
    let out = items;
    if (k !== "all") out = out.filter((x) => x.kind === k);

    const qq = String(q || "").toLowerCase();
    if (qq) {
      out = out.filter((x) =>
        `${x.kind} ${x.id} ${x.title} ${x.line1} ${x.line2}`
          .toLowerCase()
          .includes(qq),
      );
    }

    out.sort((a, b) => (b._sort ?? 0) - (a._sort ?? 0));

    const lim = Math.max(1, Number(limit) || 50);
    const off = Math.max(0, Number(offset) || 0);

    const page = out.slice(off, off + lim).map(({ _sort, ...x }) => x);

    return res.json({ ok: true, items: page, total: out.length });
  } catch (e: any) {
    console.error("[wallets/items] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "items_failed" });
  }
});

app.get("/wallets/profiles", async (_req, res) => {
  try {
    const d = await ds();
    const rows = await d.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name LIKE 'wallet\\_%'
      ORDER BY schema_name;
    `);
    await d.destroy();

    const profiles = (rows || [])
      .map((r: any) => String(r.schema_name || ""))
      .map((s: string) => s.replace(/^wallet_/, ""))
      .filter((p: string) => p && p !== "issuer");

    return res.json({ ok: true, profiles });
  } catch (e: any) {
    console.error("[wallets/profiles] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "profiles_failed" });
  }
});

app.post("/wallets/backup", async (req, res) => {
  try {
    const { profile, passphrase, backupPassword } = req.body || {};
    if (!profile || !passphrase) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const safeProfile = String(profile).trim();
    const schema = schemaFor(safeProfile);

    const d = await ds(schema);
    const meta = (
      await d.query(
        `SELECT salt, pass_guard FROM "${schema}".wallet_meta LIMIT 1;`,
      )
    )?.[0];

    if (!meta) {
      await d.destroy();
      return res
        .status(400)
        .json({ ok: false, error: "wallet_not_initialized" });
    }

    const saltBuf = toSaltBuffer(meta.salt);
    const guardHex: string = String(meta.pass_guard || "");

    if (guardHex && !verifyWalletPass(String(passphrase), saltBuf, guardHex)) {
      await d.destroy();
      return res.status(401).json({ ok: false, error: "wrong_passphrase" });
    }

    const dump: any = {
      version: 1,
      profile: slug(safeProfile),
      schema,
      createdAt: new Date().toISOString(),
      meta: {
        saltHex: saltBuf.toString("hex"),
        passGuard: guardHex,
        kms: "secretbox+scrypt",
        kdf: { name: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 },
      },
      tables: {} as Record<string, any[]>,
    };

    for (const t of TABLES) {
      dump.tables[t] = await d.query(`SELECT * FROM "${schema}"."${t}";`);
    }
    await d.destroy();

    const exportPass = backupPassword
      ? String(backupPassword)
      : String(passphrase);

    const gz = await gzip(Buffer.from(JSON.stringify(dump), "utf8"));
    const bkpSalt = crypto.randomBytes(16);
    const key = crypto.scryptSync(exportPass, bkpSalt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(gz), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = {
      format: "did-wallet-backup",
      version: 1,
      profile: slug(safeProfile),
      kdf: {
        name: "scrypt",
        saltHex: bkpSalt.toString("hex"),
        N: 16384,
        r: 8,
        p: 1,
        dkLen: 32,
      },
      enc: "aes-256-gcm",
      ivHex: iv.toString("hex"),
      tagHex: tag.toString("hex"),
      ciphertextB64: ciphertext.toString("base64"),
    };

    const filename = `backup_${slug(safeProfile)}_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.wallet.json`;
    const contentB64 = Buffer.from(
      JSON.stringify(payload, null, 2),
      "utf8",
    ).toString("base64");

    console.log("[backup] created");
    return res.json({ ok: true, filename, contentB64 });
  } catch (e: any) {
    console.error("[wallets/backup] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "backup_failed" });
  }
});

app.post("/wallets/dids/create", async (req, res) => {
  try {
    const { profile, passphrase, method, alias } = req.body || {};
    if (!profile || !passphrase) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const safeProfile = String(profile).trim();
    const safeMethod = String(method || "key").trim();

    const provider = safeMethod.startsWith("did:")
      ? safeMethod
      : `did:${safeMethod}`;

    if (!["did:key", "did:ethr"].includes(provider)) {
      return res.status(400).json({ ok: false, error: "unsupported_provider" });
    }

    const walletAgent = await setupAgent(safeProfile, String(passphrase));

    const identifier = await walletAgent.didManagerCreate({
      provider,
      kms: "local",
      alias: alias ? String(alias).trim() : undefined,
    });

    return res.json({
      ok: true,
      did: identifier.did,
      identifier,
    });
  } catch (e: any) {
    console.error("[wallets/dids/create] error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "create_did_failed", message: e?.message });
  }
});

app.post("/wallets/vcs/list", async (req, res) => {
  try {
    const { profile, passphrase } = req.body || {};
    if (!profile || !passphrase)
      return res.status(400).json({ ok: false, error: "missing_fields" });

    const walletAgent = await setupAgent(
      String(profile).trim(),
      String(passphrase),
    );

    const rows = await walletAgent.dataStoreORMGetVerifiableCredentials();

    const vcs = (rows || []).map((row: any) => {
      const vc = row.verifiableCredential;
      const typeArr = Array.isArray(vc?.type)
        ? vc.type
        : [vc?.type].filter(Boolean);
      const mainType =
        typeArr.find((t: string) => t !== "VerifiableCredential") ||
        "VerifiableCredential";
      const subjectId =
        typeof vc?.credentialSubject === "object"
          ? vc?.credentialSubject?.id
          : undefined;
      const issuance = vc?.issuanceDate ? String(vc.issuanceDate) : "";

      return {
        hash: row.hash,
        title: mainType,
        subjectId: subjectId ?? "-",
        issuanceDate: issuance ? issuance.slice(0, 10) : "-",
      };
    });

    return res.json({ ok: true, vcs });
  } catch (e: any) {
    console.error("[wallets/vcs/list] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "vcs_list_failed" });
  }
});

app.post("/wallets/vcs/save", async (req, res) => {
  try {
    const { profile, passphrase, vcJwt } = req.body || {};

    if (!profile || !passphrase || !vcJwt) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const walletAgent = await setupAgent(
      String(profile).trim(),
      String(passphrase),
    );

    const vc = typeof vcJwt === "string" ? vcJwt.trim() : vcJwt;

    try {
      const saved = await walletAgent.dataStoreSaveVerifiableCredential({
        verifiableCredential: vc,
      });

      return res.json({
        ok: true,
        hash: saved?.hash ?? null,
      });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (
        msg.toLowerCase().includes("duplicate") ||
        msg.toLowerCase().includes("unique")
      ) {
        return res.json({ ok: true, hash: null, existed: true });
      }
      throw e;
    }
  } catch (e: any) {
    console.error("[/wallets/vcs/save] error:", e?.stack || e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "save_vc_failed",
      message: String(e?.message || e),
    });
  }
});

app.post("/wallets/vps/create", async (req, res) => {
  try {
    const { profile, passphrase, holderDid, vcHashes } = req.body || {};
    if (
      !profile ||
      !passphrase ||
      !holderDid ||
      !Array.isArray(vcHashes) ||
      vcHashes.length === 0
    ) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const walletAgent = await setupAgent(
      String(profile).trim(),
      String(passphrase),
    );

    const rows = await walletAgent.dataStoreORMGetVerifiableCredentials();
    const byHash = new Map<string, any>();
    for (const r of rows || [])
      byHash.set(String(r.hash), r.verifiableCredential);

    const selected = vcHashes
      .map((h: any) => byHash.get(String(h)))
      .filter(Boolean);

    if (!selected.length) {
      return res.status(400).json({ ok: false, error: "no_vcs_found" });
    }

    const vp = await walletAgent.createVerifiablePresentation({
      presentation: {
        holder: String(holderDid),
        verifiableCredential: selected,
      },
      proofFormat: "jwt",
    });

    const saved = await walletAgent.dataStoreSaveVerifiablePresentation({
      verifiablePresentation: vp,
    });

    return res.json({ ok: true, hash: saved?.hash, vp });
  } catch (e: any) {
    console.error("[wallets/vps/create] error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "vp_create_failed", message: e?.message });
  }
});

app.post("/wallets/restore", async (req, res) => {
  try {
    const {
      backup,
      backupPassword,
      walletPassphrase,
      targetProfile,
      overwrite,
    } = req.body || {};

    if (!backup || !backupPassword) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }
    if (backup.format !== "did-wallet-backup" || backup.version !== 1) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_backup_format" });
    }

    let gz: Buffer;
    try {
      const key = crypto.scryptSync(
        String(backupPassword),
        Buffer.from(String(backup.kdf.saltHex), "hex"),
        32,
      );
      const iv = Buffer.from(String(backup.ivHex), "hex");
      const tag = Buffer.from(String(backup.tagHex), "hex");
      const ciphertext = Buffer.from(String(backup.ciphertextB64), "base64");

      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      gz = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      return res
        .status(401)
        .json({ ok: false, error: "wrong_backup_password_or_corrupted" });
    }

    let dump: any;
    try {
      const raw = await gunzip(gz);
      dump = JSON.parse(raw.toString("utf8"));
    } catch {
      return res
        .status(400)
        .json({ ok: false, error: "corrupted_backup_content" });
    }

    const walletPass = String(walletPassphrase || backupPassword);
    try {
      const salt = Buffer.from(String(dump?.meta?.saltHex || ""), "hex");
      const guardExpected = String(dump?.meta?.passGuard || "");

      const dk = crypto.scryptSync(walletPass, salt, 32);
      const calcGuard = crypto
        .createHmac("sha256", dk)
        .update("kms-guard-v1")
        .digest("hex");

      if (!guardExpected || calcGuard !== guardExpected) {
        return res
          .status(401)
          .json({ ok: false, error: "wrong_wallet_password" });
      }
    } catch {
      return res
        .status(401)
        .json({ ok: false, error: "wrong_wallet_password" });
    }

    const finalProfile = String(
      targetProfile || dump.profile || backup.profile || "default",
    ).trim();
    const schema = schemaFor(finalProfile);

    await ensureSchema(schema);

    const empty = await schemaIsEmpty(schema);
    if (!empty && !overwrite) {
      const d = await ds(schema);
      try {
        const meta = (
          await d.query(
            `SELECT salt, pass_guard FROM "${schema}".wallet_meta LIMIT 1;`,
          )
        )?.[0];

        if (!meta?.salt || !meta?.pass_guard) {
          return res.status(409).json({ ok: false, error: "profile_exists" });
        }

        const ok = verifyWalletPass(
          walletPass,
          toSaltBuffer(meta.salt),
          String(meta.pass_guard),
        );

        if (!ok) {
          return res
            .status(401)
            .json({ ok: false, error: "wrong_wallet_password" });
        }

        return res.json({
          ok: true,
          profile: finalProfile,
          mode: "login_existing",
        });
      } finally {
        await d.destroy();
      }
    }

    const dSync = await ds(schema, true);
    await dSync.synchronize();
    await dSync.destroy();

    const d = await ds(schema);
    try {
      if (!empty && overwrite) {
        const fq = TABLES.map((t) => `"${schema}"."${t}"`).join(", ");
        await d.query(`TRUNCATE TABLE ${fq} RESTART IDENTITY CASCADE;`);
      }

      await d.query(
        `INSERT INTO "${schema}".wallet_meta (id, salt, pass_guard)
         VALUES (TRUE, $1, $2)
         ON CONFLICT (id) DO UPDATE SET salt=EXCLUDED.salt, pass_guard=EXCLUDED.pass_guard;`,
        [
          Buffer.from(String(dump.meta.saltHex), "hex"),
          String(dump.meta.passGuard),
        ],
      );

      for (const t of TABLES) {
        if (t === "wallet_meta") continue;
        const rows: any[] = dump.tables?.[t] || [];
        if (!rows.length) continue;

        const cols = Object.keys(rows[0]);
        const colList = cols.map((c) => `"${c}"`).join(", ");

        for (const r of rows) {
          const vals = cols.map((c) => r[c]);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          await d.query(
            `INSERT INTO "${schema}"."${t}" (${colList})
             VALUES (${placeholders})
             ON CONFLICT DO NOTHING;`,
            vals,
          );
        }
      }

      return res.json({
        ok: true,
        profile: finalProfile,
        mode: empty ? "restored_new" : "restored_overwrite",
      });
    } finally {
      await d.destroy();
    }
  } catch (e: any) {
    console.error("[wallets/restore] error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "restore_failed", message: e?.message });
  }
});

async function ensureVcIssuanceLogTable() {
  const d = await ds();
  try {
    await d.query(`
      CREATE TABLE IF NOT EXISTS public.vc_issuance_log (
        id BIGSERIAL PRIMARY KEY,
        admin_email TEXT,
        issuer_did TEXT NOT NULL,
        subject_did TEXT NOT NULL,
        vc_type TEXT NOT NULL,
        claims JSONB NOT NULL DEFAULT '{}'::jsonb,
        issuance_date TIMESTAMPTZ NOT NULL,
        expiration_date TIMESTAMPTZ,
        vc_hash TEXT NOT NULL,
        vc_jwt TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vc_issuance_log_subject_idx ON public.vc_issuance_log(subject_did);
      CREATE INDEX IF NOT EXISTS vc_issuance_log_created_idx ON public.vc_issuance_log(created_at DESC);
    `);
  } finally {
    await d.destroy();
  }
}

async function ensureVcRequestsTable() {
  const d = await ds();
  try {
    await d.query(`
      CREATE TABLE IF NOT EXISTS public.vc_requests (
        id BIGSERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
        holder_did TEXT NOT NULL,
        subject_did TEXT NOT NULL,
        vc_type TEXT NOT NULL,
        claims JSONB NOT NULL DEFAULT '{}'::jsonb,
        validity_days INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        decided_at TIMESTAMPTZ,
        decided_by TEXT,
        decision_note TEXT,
        issued_vc_hash TEXT,
        issued_vc_jwt TEXT
      );

      CREATE INDEX IF NOT EXISTS vc_requests_status_idx ON public.vc_requests(status);
      CREATE INDEX IF NOT EXISTS vc_requests_holder_idx ON public.vc_requests(holder_did);
      CREATE INDEX IF NOT EXISTS vc_requests_created_idx ON public.vc_requests(created_at DESC);
    `);
  } finally {
    await d.destroy();
  }
}

app.post("/admin/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    const password = String(req.body?.password || "");

    if (!email || !password) return res.status(400).send("missing_fields");

    const d = await ds();
    try {
      const rows = await d.query(
        `SELECT id, email, password_hash, role
         FROM public.admin_users
         WHERE email = $1
         LIMIT 1;`,
        [email],
      );

      const u = rows?.[0];
      if (!u) return res.status(401).send("invalid_credentials");

      const ok = await bcrypt.compare(password, String(u.password_hash));
      if (!ok) return res.status(401).send("invalid_credentials");

      const token = signAdminToken({
        sub: String(u.id),
        email: String(u.email),
        role: String(u.role || "admin"),
      });

      return res.json({ token });
    } finally {
      await d.destroy();
    }
  } catch (e: any) {
    console.error("[/admin/login] error:", e?.message || e);
    return res.status(500).send("server_error");
  }
});

app.get("/admin/issuer", requireAdmin, async (_req, res) => {
  try {
    const ids = await agent.didManagerFind();
    const active = ISSUER_DID;

    const issuerIds = ids
      .filter((i: any) => String(i.alias || "").startsWith("issuer"))
      .map((i: any) => ({
        did: i.did,
        alias: i.alias || null,
        provider: i.provider,
        createdAt: i.createdAt || null,
        keys: (i.keys || []).map((k: any) => ({
          kid: k.kid,
          type: k.type,
          publicKeyHex: k.publicKeyHex?.slice(0, 16) ?? null,
        })),
      }));

    const activeRow = issuerIds.find((x: any) => x.did === active) || null;

    return res.json({
      ok: true,
      activeDid: active,
      active: activeRow,
      all: issuerIds,
    });
  } catch (e: any) {
    console.error("[/admin/issuer] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "issuer_failed" });
  }
});

app.post("/admin/issuer/set-active", requireAdmin, async (req, res) => {
  try {
    const did = String(req.body?.did || "");
    if (!did) return res.status(400).json({ ok: false, error: "missing_did" });

    const ids = await agent.didManagerFind();
    const exists = ids.some((i: any) => i.did === did);
    if (!exists)
      return res.status(404).json({ ok: false, error: "did_not_found" });

    ISSUER_DID = did;
    await setSetting("issuer_did", { did });

    return res.json({ ok: true, activeDid: did });
  } catch (e: any) {
    console.error("[/admin/issuer/set-active] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "set_active_failed" });
  }
});

function issuerAlias(input?: string) {
  const raw = String(input || "").trim();
  const s = slug(raw);

  if (!s) return `issuer-${Date.now()}`;

  if (s.startsWith("issuer")) return s;

  return `issuer-${s}`;
}

app.post("/admin/issuer/create", requireAdmin, async (req, res) => {
  try {
    const provider = String(req.body?.provider || "did:key");
    const alias = issuerAlias(req.body?.alias);

    const created = await agent.didManagerCreate({
      provider,
      kms: "local",
      alias,
    });

    ISSUER_DID = created.did;
    await setSetting("issuer_did", { did: created.did });

    return res.json({
      ok: true,
      created: {
        did: created.did,
        alias: created.alias,
        provider: created.provider,
        keys: created.keys?.length ?? 0,
      },
      activeDid: ISSUER_DID,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/admin/issuer/diddoc", requireAdmin, async (req, res) => {
  try {
    const did = String(req.query?.did || ISSUER_DID);
    const doc = await agent.resolveDid({ didUrl: did });
    return res.json({ ok: true, did, didDoc: doc });
  } catch (e: any) {
    console.error("[/admin/issuer/diddoc] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "diddoc_failed" });
  }
});

function hashVcPayload(vc: any) {
  const raw = typeof vc === "string" ? vc : JSON.stringify(vc);
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

app.post("/admin/vc/issue", requireAdmin, async (req, res) => {
  try {
    const subjectDid = String(req.body?.subjectDid || "").trim();
    const typeIn = req.body?.type;
    const claimsIn = req.body?.claims;

    if (!subjectDid.startsWith("did:")) {
      return res.status(400).json({ ok: false, error: "bad_subject_did" });
    }
    if (!claimsIn || typeof claimsIn !== "object" || Array.isArray(claimsIn)) {
      return res
        .status(400)
        .json({ ok: false, error: "claims_must_be_object" });
    }

    const typeArr = Array.isArray(typeIn) ? typeIn : typeIn ? [typeIn] : [];
    const mainType = String(typeArr[0] || "");
    const policy = VC_POLICY[mainType];
    if (!policy) {
      return res.status(400).json({ ok: false, error: "unsupported_vc_type" });
    }

    let claims = pickClaims(claimsIn, policy.allowedClaims);
    try {
      assertRequired(claims, policy.requiredClaims);
      validateClaims(mainType, claims);
    } catch (e: any) {
      return res
        .status(400)
        .json({ ok: false, error: String(e?.message || e) });
    }

    const validityDays = clampValidityDays(
      req.body?.validityDays,
      policy.maxValidityDays,
    );

    const issuanceDate = new Date().toISOString();
    const expirationDate = new Date(
      Date.now() + validityDays * 86400_000,
    ).toISOString();

    const vc = await agent.createVerifiableCredential({
      credential: {
        issuer: { id: ISSUER_DID },
        issuanceDate,
        expirationDate,
        type: ["VerifiableCredential", mainType],
        credentialSubject: { id: subjectDid, ...claims },
      },
      proofFormat: "jwt",
    });

    const vcHash = hashVcPayload(vc);

    const adminEmail = (req as any).admin?.email || null;

    const vcJwt =
      typeof vc === "string"
        ? vc
        : (vc as any)?.proof?.jwt
        ? String((vc as any).proof.jwt)
        : JSON.stringify(vc);

    const d = await ds();
    try {
      await d.query(
        `INSERT INTO public.vc_issuance_log
         (admin_email, issuer_did, subject_did, vc_type, claims, issuance_date, expiration_date, vc_hash, vc_jwt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          adminEmail,
          ISSUER_DID,
          subjectDid,
          String(mainType),
          JSON.stringify(claims),
          issuanceDate,
          expirationDate || null,
          vcHash,
          vcJwt,
        ],
      );
    } finally {
      await d.destroy();
    }

    return res.json({
      ok: true,
      issuerDid: ISSUER_DID,
      subjectDid,
      vcType: String(mainType),
      issuanceDate,
      expirationDate: expirationDate || null,
      vcHash,
      vc,
    });
  } catch (e: any) {
    console.error("[/admin/vc/issue] error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "issue_failed", message: e?.message });
  }
});

app.get("/admin/vc/issued", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 20)));

    const d = await ds();
    try {
      const rows = await d.query(
        `SELECT id, created_at, admin_email, issuer_did, subject_did, vc_type, vc_hash, issuance_date, expiration_date
         FROM public.vc_issuance_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
      );

      return res.json({ ok: true, items: rows });
    } finally {
      await d.destroy();
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "list_failed" });
  }
});

app.get("/admin/vc/issued/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ ok: false, error: "bad_id" });

  const d = await ds();
  try {
    const rows = await d.query(
      `SELECT id, created_at, admin_email, issuer_did, subject_did, vc_type, claims,
              issuance_date, expiration_date, vc_hash, vc_jwt
       FROM public.vc_issuance_log
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    const row = rows?.[0];
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, item: row });
  } finally {
    await d.destroy();
  }
});

app.get("/admin/me", requireAdmin, (req, res) => {
  res.json({ ok: true, admin: (req as any).admin });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Verifier running on http://0.0.0.0:${PORT}`);
  // console.log(`Circuit: ${CIRCUIT}`);
  // console.log(`Verification key: ${VK_PATH}`);
});
