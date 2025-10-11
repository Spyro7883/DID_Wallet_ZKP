import fs from "fs";
import path from "path";
import crypto from "crypto";
import { decodeJwt } from "jose";
import { keccak256, toUtf8Bytes } from "ethers";
import { alpha2ToNumeric } from "./iso3166";

interface CredentialSubject {
  id?: string;
  age?: string | number;
  income?: string | number;
  citizenship?: string;
  [k: string]: unknown;
}
type VCShape =
  | string
  | {
      credentialSubject?: CredentialSubject;
      issuer?: { id?: string };
      proof?: { jwt?: string };
      [k: string]: unknown;
    };
interface VPShape {
  holder?: string;
  verifiableCredential?: VCShape[];
  credentialSubject?: CredentialSubject;
  [k: string]: unknown;
}

interface Policy {
  expectedCitizenship: string;
  L: string;
  U: string;
  contextId: string;
}
type CircuitName = "aggregate" | "age" | "citizenship" | "incomeRange";
interface ArgvMap {
  [k: string]: string | undefined;
}

function parseArgs(): { circuit: CircuitName; vpPath: string; argv: ArgvMap } {
  const [, , c, rel] = process.argv;
  if (!c || !rel) {
    console.error(
      "Usage: tsx scripts/generate_input.ts <circuit> <vpPath> [--policy=rest/policy.json | --L=... --U=... --expectedCitizenship=... --contextId=...] [--anchors=1]"
    );
    process.exit(1);
  }
  const circuit = c as CircuitName;
  const vpPath = path.isAbsolute(rel) ? rel : path.resolve(rel);
  const argv: ArgvMap = {};
  for (const token of process.argv.slice(4)) {
    if (!token.startsWith("--")) continue;
    const [k, v] = token.slice(2).split("=");
    argv[k] = v ?? "1";
  }
  return { circuit, vpPath, argv };
}

function loadPolicy(argv: ArgvMap): Policy {
  const policyPath = argv["policy"];
  if (policyPath) {
    const p = path.isAbsolute(policyPath)
      ? policyPath
      : path.resolve(policyPath);
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const k of ["expectedCitizenship", "L", "U", "contextId"]) {
      if (!(k in parsed)) throw new Error(`Policy file missing key "${k}"`);
    }
    return {
      expectedCitizenship: String(parsed.expectedCitizenship),
      L: String(parsed.L),
      U: String(parsed.U),
      contextId: String(parsed.contextId),
    };
  }

  const L = argv["L"],
    U = argv["U"];
  if (!L || !U) {
    console.error(
      "Need policy: pass --policy=rest/policy.json OR both --L and --U."
    );
    process.exit(1);
  }

  let contextId = argv["contextId"];

  if (!contextId) {
    const challengePath = path.resolve("rest/challenge.json");
    if (fs.existsSync(challengePath)) {
      try {
        const challenge = JSON.parse(fs.readFileSync(challengePath, "utf8"));
        if (challenge.contextId) {
          contextId = String(challenge.contextId);
          console.log(`contextId read from challenge.json: ${contextId}`);
        }
      } catch (e) {
        console.warn(`I can't read challenge.json: ${e}`);
      }
    }
  }

  if (!contextId) {
    console.warn("contextId not found,use default: 1");
    console.warn(
      "Run 'npm run nonce' for generating a challenge with random contextId"
    );
    contextId = "1";
  }

  return {
    expectedCitizenship: argv["expectedCitizenship"] ?? "1",
    L: String(L),
    U: String(U),
    contextId: contextId,
  };
}

function getVcJwt(vcItem: VCShape): string {
  if (typeof vcItem === "string") return vcItem;
  const jwt = vcItem?.proof?.jwt;
  if (!jwt)
    throw new Error("VC item missing proof.jwt (or isn’t a JWT string).");
  return jwt;
}

function assertDefined<T>(v: T, name: string): asserts v is NonNullable<T> {
  if (v === undefined || v === null || v === "") {
    throw new Error(`Missing required value: ${name}`);
  }
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

(function main() {
  const { circuit, vpPath, argv } = parseArgs();
  const vp: VPShape = JSON.parse(fs.readFileSync(vpPath, "utf8"));
  const policy = loadPolicy(argv);
  const wantAnchors = argv["anchors"] === "1";
  const expectedCitizenshipNum = alpha2ToNumeric(
    policy.expectedCitizenship
  ).toString();

  const vcs = vp.verifiableCredential ?? [];
  if (!Array.isArray(vcs) || vcs.length === 0) {
    throw new Error("VP malformed: verifiableCredential[] missing");
  }

  let didHash: string | null = null;
  let holderDid: string | undefined = vp.holder;

  let age: bigint | undefined;
  let income: bigint | undefined;
  let citizenship: bigint | undefined;

  let credHash_age = "",
    credHash_inc = "",
    credHash_cit = "";

  for (const item of vcs) {
    const jwt = getVcJwt(item);
    const payload: any = decodeJwt(jwt);
    const now = Math.floor(Date.now() / 1000);
    if (payload?.nbf && payload.nbf > now)
      throw new Error("VC not yet valid (nbf)");
    if (payload?.exp && payload.exp < now) throw new Error("VC expired (exp)");

    const issuerDid: string =
      payload?.iss ??
      payload?.vc?.issuer?.id ??
      (typeof item !== "string" ? item?.issuer?.id : undefined);
    assertDefined(issuerDid, "issuer DID");

    const thisDidHash = keccak256(toUtf8Bytes(issuerDid));
    if (!didHash) didHash = thisDidHash;
    else if (didHash !== thisDidHash)
      throw new Error("Mixed issuers in VP (not allowed in this demo)");

    const cs: any =
      payload?.vc?.credentialSubject ??
      (typeof item !== "string" ? item?.credentialSubject : undefined) ??
      {};

    if (!holderDid && cs?.id) holderDid = String(cs.id);
    if (holderDid && cs?.id && String(cs.id) !== holderDid) {
      throw new Error(
        `credentialSubject.id != holder: ${cs.id} vs ${holderDid}`
      );
    }

    if (cs.age !== undefined && age === undefined) {
      age = BigInt(String(cs.age));
      if (wantAnchors) credHash_age = keccak256(toUtf8Bytes(jwt));
    }
    if (cs.income !== undefined && income === undefined) {
      income = BigInt(String(cs.income));
      if (wantAnchors) credHash_inc = keccak256(toUtf8Bytes(jwt));
    }
    if (cs.citizenship !== undefined && citizenship === undefined) {
      citizenship = alpha2ToNumeric(cs.citizenship);
      if (wantAnchors) credHash_cit = keccak256(toUtf8Bytes(jwt));
    }
  }

  if ((!age || !income || !citizenship) && vp.credentialSubject) {
    const cs = vp.credentialSubject;
    if (!age && cs.age !== undefined) age = BigInt(String(cs.age));
    if (!income && cs.income !== undefined) income = BigInt(String(cs.income));
    if (!citizenship && cs.citizenship !== undefined)
      citizenship = alpha2ToNumeric(cs.citizenship);
  }

  assertDefined(age, "age");
  assertDefined(income, "income");
  assertDefined(citizenship, "citizenship");
  assertDefined(didHash, "didHash");

  function ensureFits(v: bigint, bits: number, name: string) {
    const max = 1n << BigInt(bits);
    if (v < 0n || v >= max)
      throw new Error(`${name}=${v} exceeds ${bits} bits`);
  }
  ensureFits(citizenship, 16, "citizenship");
  ensureFits(income, 32, "income");
  ensureFits(age, 8, "age");

  const salt = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const L = BigInt(policy.L);
  const U = BigInt(policy.U);
  if (!(L < U)) throw new Error("Policy invalid: L must be < U");

  const fails: string[] = [];
  if (citizenship!.toString() !== expectedCitizenshipNum)
    fails.push("citizenship≠expected");
  if (age! < 18n) fails.push("age<18");
  if (!(income! >= L && income! < U)) fails.push(`income∉[${L},${U})`);

  if (fails.length) {
    console.error("Eligibility failed:", fails.join(", "));
    process.exit(2);
  }

  const lc = circuit.toLowerCase();
  const baseOut: Record<string, string> = {};

  let input: Record<string, string>;
  if (lc === "aggregate") {
    input = {
      ...baseOut,
      age: age.toString(),
      income: income.toString(),
      citizenship: citizenship.toString(),
      salt: salt.toString(),
      expectedCitizenship: expectedCitizenshipNum,
      L: L.toString(),
      U: U.toString(),
      contextId: BigInt(policy.contextId).toString(),
    };
  } else if (lc === "age") {
    input = { age: age.toString(), salt: salt.toString() };
  } else if (lc === "citizenship") {
    input = {
      citizenship: citizenship.toString(),
      salt: salt.toString(),
      expectedCitizenship: policy.expectedCitizenship,
    };
  } else if (lc === "incomerange") {
    input = {
      income: income.toString(),
      salt: salt.toString(),
      L: L.toString(),
      U: U.toString(),
    };
  } else {
    throw new Error(`Unknown circuit: ${circuit}`);
  }

  if (wantAnchors) {
    input.didHash = didHash!;
    if (credHash_age) input.credHash_age = credHash_age;
    if (credHash_cit) input.credHash_cit = credHash_cit;
    if (credHash_inc) input.credHash_inc = credHash_inc;
  }

  const outDir = path.join("build", circuit, `${circuit}_js`);
  ensureDir(outDir);
  const outPath = path.join(outDir, "input.json");
  fs.writeFileSync(outPath, JSON.stringify(input, null, 2));
  console.log(`💾 Wrote ${outPath}`);
})();
