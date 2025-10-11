import express from "express";
import cors from "cors";
import crypto from "crypto";
import { readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";

const app = express();
const PORT = 5501;

const CIRCUIT = process.env.CIRCUIT || "aggregate";
const VK_PATH = `./build/${CIRCUIT}/verification_key.json`;

const VERIFICATION_KEY = JSON.parse(readFileSync(VK_PATH, "utf8"));

app.use(cors());
app.use(express.json());

type ProofPack = { proof: any; publicSignals: any[] | Record<string, any> };

const isPack = (x: any): x is ProofPack =>
  x && typeof x === "object" && x.proof && x.publicSignals;

const same = (a: any, b: any) => String(a) === String(b);

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

setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  let cleaned = 0;
  for (const [token, exp] of TOKENS.entries()) {
    if (exp < now) {
      TOKENS.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(` Cleaned ${cleaned} expired token(s)`);
  }
}, 60000);

app.post("/present", async (req, res) => {
  console.log("\n Payload received @/present");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const { vp, contextId, nonce, zk } = req.body || {};

    if (contextId === undefined || contextId === null) {
      throw new Error("contextId is missing");
    }
    if (!isPack(zk)) {
      throw new Error("zk pack invalid (proof/publicSignals)");
    }

    if (nonce) {
      console.log(`Nonce received: ${nonce} (extra security VP)`);
    }

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

    if (!ok) {
      console.error("ZK proof verification failed!");
      throw new Error("zk verification failed");
    }
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

    if (allValid === undefined) {
      throw new Error("allValid is missing from publicSignals");
    }

    if (allValid !== "1" && allValid !== 1) {
      throw new Error(`allValid has to be 1, but it's ${allValid}`);
    }
    console.log("allValid = 1 (all verifications from circuit have passed)");

    if (contextIdPS === undefined) {
      throw new Error("contextId is missing from publicSignals");
    }

    if (!same(contextIdPS, contextId)) {
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

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    circuit: CIRCUIT,
    activeTokens: TOKENS.size,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`\nVerifier running on http://localhost:${PORT}`);
  console.log(`Circuit: ${CIRCUIT}`);
  console.log(`Verification key: ${VK_PATH}`);
});
