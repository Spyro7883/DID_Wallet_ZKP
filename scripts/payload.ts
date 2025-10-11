import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

type Json = Record<string, any>;
type ProofPack = { proof: any; publicSignals: any };

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

function mustExist(path: string | undefined, label: string) {
  if (!path) throw new Error(`Missing required path for ${label}`);
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs} (${label})`);
  return abs;
}

function readJSON(path: string | undefined, label: string) {
  const abs = mustExist(path, label);
  return JSON.parse(readFileSync(abs, "utf8"));
}

function readVPFlexible(path: string | undefined): any {
  const abs = mustExist(path, "vp");
  const raw = readFileSync(abs, "utf8");
  const ext = extname(abs).toLowerCase();
  return ext === ".json" ? JSON.parse(raw) : raw;
}

const JWT_REGEX = /[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/;
const findJwtInString = (s: string | undefined | null) =>
  typeof s === "string" ? s.match(JWT_REGEX)?.[0] ?? null : null;
const looksLikeJwt = (tok: string) =>
  tok.split(".").length === 3 && tok.split(".")[1].length > 10;

function extractJwtFromVp(obj: any): string {
  if (typeof obj === "string" && looksLikeJwt(obj.trim())) return obj.trim();
  if (obj && typeof obj === "object") {
    if (typeof obj.jwt === "string" && looksLikeJwt(obj.jwt)) return obj.jwt;
    if (typeof obj.proof?.jwt === "string" && looksLikeJwt(obj.proof.jwt))
      return obj.proof.jwt;
    if (Array.isArray(obj.proofs)) {
      const maybe = obj.proofs.find((p: any) => looksLikeJwt(p?.jwt));
      if (maybe) return maybe.jwt;
    }
  }
  throw new Error("Can't find a valid JWT in VP");
}

function loadPack(
  proofPath: string | undefined,
  pubPath: string | undefined
): ProofPack {
  const proof = readJSON(proofPath, "agg-proof");
  const publicSignals = readJSON(pubPath, "agg-public");
  return { proof, publicSignals };
}

function readChallengeFallback(): {
  contextId?: string | number;
  nonce?: string;
} {
  const p = resolve("rest/challenge.json");
  if (!existsSync(p)) return {};
  try {
    const c = JSON.parse(readFileSync(p, "utf8"));
    return {
      contextId: c?.contextId,
      nonce: c?.nonce,
    };
  } catch {
    return {};
  }
}

const same = (a: any, b: any) => String(a) === String(b);

const program = new Command();
program
  .name("build-payload")
  .description(
    "Build payload for aggregate: { vp:{jwt}, contextId, [nonce], zk:{proof,publicSignals} }"
  )
  .requiredOption("--vp <path>", "Path at VP (.json sau .txt)")
  .option("--context-id <id>", "Context ID for circuit")
  .option("--nonce <hex>", "Nonce for VP")
  .requiredOption("--agg-proof <path>", "aggregate proof.json")
  .requiredOption("--agg-public <path>", "aggregate public.json")
  .option("--out <path>", "Fișier ieșire", "access_payload.json")
  .action((opts: any) => {
    console.log("🔨 Build payload-ul...\n");

    const vpSrc = readVPFlexible(opts.vp);
    const vp = { jwt: extractJwtFromVp(vpSrc) };
    console.log("VP JWT extracted");

    const zk = loadPack(opts.aggProof, opts.aggPublic);
    console.log("ZK proof loaded");
    console.log(`publicSignals has ${zk.publicSignals.length} elements`);

    const fallback = readChallengeFallback();
    const contextId = opts.contextId ?? fallback.contextId;
    const nonce = opts.nonce ?? fallback.nonce;

    if (!contextId) {
      throw new Error("contextId missing. Run `npm run nonce`");
    }

    console.log(`\n Challenge:`);
    console.log(`   contextId: ${contextId}`);
    if (nonce) {
      console.log(`   nonce: ${nonce} optional`);
    } else {
      console.log(`   nonce: has not been created`);
    }

    if (Array.isArray(zk.publicSignals)) {
      console.log(`\n🔍 Verify struct publicSignals...`);

      const allValid = zk.publicSignals[IDX.allValid];
      const privHash = zk.publicSignals[IDX.privHash];
      const contextIdPS = zk.publicSignals[IDX.contextId];

      console.log(`   [${IDX.allValid}] allValid: ${allValid}`);
      console.log(`   [${IDX.privHash}] privHash: ${privHash}`);
      console.log(
        `   [${IDX.agePrivHash}] agePrivHash: ${
          zk.publicSignals[IDX.agePrivHash]
        }`
      );
      console.log(
        `   [${IDX.citizenshipPrivHash}] citizenshipPrivHash: ${
          zk.publicSignals[IDX.citizenshipPrivHash]
        }`
      );
      console.log(
        `   [${IDX.incomePrivHash}] incomePrivHash: ${
          zk.publicSignals[IDX.incomePrivHash]
        }`
      );
      console.log(
        `   [${IDX.expectedCitizenship}] expectedCitizenship: ${
          zk.publicSignals[IDX.expectedCitizenship]
        }`
      );
      console.log(`   [${IDX.L}] L (minIncome): ${zk.publicSignals[IDX.L]}`);
      console.log(`   [${IDX.U}] U (maxIncome): ${zk.publicSignals[IDX.U]}`);
      console.log(`   [${IDX.contextId}] contextId: ${contextIdPS}`);

      if (allValid !== "1" && allValid !== 1) {
        throw new Error(`allValid has to be 1, but it's ${allValid}`);
      }
      console.log(` allValid = 1 (validated proof)`);

      if (!same(contextIdPS, contextId)) {
        console.warn(
          `contextId mismatch: expected "${contextId}", got "${contextIdPS}"`
        );
      } else {
        console.log(`contextId match`);
      }
    }

    const outPath = resolve(opts.out ?? "access_payload.json");

    const payload: any = {
      vp,
      contextId,
      zk,
    };

    if (nonce) {
      payload.nonce = nonce;
      console.log(`\n Include payload and nonce for extra VP security`);
    }

    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\n Saved payload in ${outPath}`);
    console.log(`\n Next step: npm run present\n`);
  });

program.parseAsync(process.argv);
