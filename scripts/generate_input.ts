import fs from "fs";
import path from "path";
import crypto from "crypto";

interface CredentialSubject {
  id?: string;
  age?: string | number;
  income?: string | number;
  citizenship?: string;
  [k: string]: unknown;
}

interface VerifiableCredential {
  credentialSubject?: CredentialSubject;
  [k: string]: unknown;
}

interface VerifiablePresentation {
  verifiableCredential?: VerifiableCredential[];
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

const CITIZENSHIP_MAP: Record<string, number> = {
  RO: 1,
  ROU: 1,
  ROMANIA: 1,
  DE: 2,
  DEU: 2,
  GERMANY: 2,
  FR: 3,
  FRA: 3,
  FRANCE: 3,
  US: 4,
  USA: 4,
  "UNITED STATES": 4,
  UK: 5,
  GBR: 5,
  "UNITED KINGDOM": 5,
  IT: 6,
  ITA: 6,
  ITALY: 6,
  ES: 7,
  ESP: 7,
  SPAIN: 7,
};

function parseArgs(): { circuit: CircuitName; vpPath: string; argv: ArgvMap } {
  const [, , c, rel] = process.argv;
  if (!c || !rel) {
    console.error(
      "Usage: tsx scripts/generate_input.ts <circuit> <vpPath> [--policy=rest/policy.json | --L=... --U=... --expectedCitizenship=... --contextId=...]"
    );
    process.exit(1);
  }
  const circuit = c as CircuitName;
  const vpPath = path.isAbsolute(rel) ? rel : path.resolve(rel);

  const argv: ArgvMap = {};
  for (const token of process.argv.slice(4)) {
    if (!token.startsWith("--")) continue;
    const [k, v] = token.slice(2).split("=");
    argv[k] = v;
  }
  return { circuit, vpPath, argv };
}

function loadPolicy(argv: ArgvMap): Policy {
  const policyPath = argv["policy"];
  if (policyPath) {
    const p = path.isAbsolute(policyPath)
      ? policyPath
      : path.resolve(policyPath);
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    const required = ["expectedCitizenship", "L", "U", "contextId"];
    for (const k of required) {
      if (!(k in parsed)) {
        throw new Error(`Policy file missing key "${k}"`);
      }
    }
    return {
      expectedCitizenship: String(parsed.expectedCitizenship),
      L: String(parsed.L),
      U: String(parsed.U),
      contextId: String(parsed.contextId),
    };
  }

  const L = argv["L"];
  const U = argv["U"];
  if (!L || !U) {
    console.error(
      "❌ Need policy: pass --policy=rest/policy.json OR both --L and --U."
    );
    process.exit(1);
  }
  const expectedCitizenship = argv["expectedCitizenship"] ?? "1";
  const contextId = argv["contextId"] ?? "1";

  return { expectedCitizenship, L, U, contextId };
}

function extractFromVP(vp: VerifiablePresentation): {
  age?: bigint;
  income?: bigint;
  citizenship?: bigint;
} {
  const out: { age?: bigint; income?: bigint; citizenship?: bigint } = {};

  const vcs = vp.verifiableCredential ?? [];
  for (const vc of vcs) {
    const cs = vc.credentialSubject ?? {};
    if (cs.age !== undefined && out.age === undefined)
      out.age = BigInt(String(cs.age));
    if (cs.income !== undefined && out.income === undefined)
      out.income = BigInt(String(cs.income));
    if (cs.citizenship !== undefined && out.citizenship === undefined) {
      const key = String(cs.citizenship).toUpperCase().trim();
      if (CITIZENSHIP_MAP[key] === undefined) {
        throw new Error(`Unknown citizenship in VC: ${cs.citizenship}`);
      }
      out.citizenship = BigInt(CITIZENSHIP_MAP[key]);
    }
  }

  if (!vcs.length) {
    const cs = vp.credentialSubject ?? {};
    if (cs.age !== undefined && out.age === undefined)
      out.age = BigInt(String(cs.age));
    if (cs.income !== undefined && out.income === undefined)
      out.income = BigInt(String(cs.income));
    if (cs.citizenship !== undefined && out.citizenship === undefined) {
      const key = String(cs.citizenship).toUpperCase().trim();
      if (CITIZENSHIP_MAP[key] === undefined) {
        throw new Error(`Unknown citizenship: ${cs.citizenship}`);
      }
      out.citizenship = BigInt(CITIZENSHIP_MAP[key]);
    }
  }

  return out;
}

function assertDefined<T>(v: T, name: string): asserts v is NonNullable<T> {
  if (v === undefined || v === null) {
    throw new Error(`Missing required value: ${name}`);
  }
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

(async () => {
  const { circuit, vpPath, argv } = parseArgs();

  const vp: VerifiablePresentation = JSON.parse(
    fs.readFileSync(vpPath, "utf8")
  );

  const policy = loadPolicy(argv);

  const data = extractFromVP(vp);

  const salt = BigInt("0x" + crypto.randomBytes(31).toString("hex"));

  const lc = circuit.toLowerCase();
  let input: Record<string, string>;

  if (lc === "aggregate") {
    assertDefined(data.age, "age");
    assertDefined(data.citizenship, "citizenship");
    assertDefined(data.income, "income");

    const L = BigInt(policy.L);
    const U = BigInt(policy.U);
    if (!(L < U)) throw new Error("Policy invalid: L must be < U");

    input = {
      age: data.age.toString(),
      citizenship: data.citizenship.toString(),
      income: data.income.toString(),
      salt: salt.toString(),
      expectedCitizenship: policy.expectedCitizenship,
      L: L.toString(),
      U: U.toString(),
      contextId: BigInt(policy.contextId).toString(),
    };
  } else if (lc === "age") {
    assertDefined(data.age, "age");
    input = { age: data.age.toString(), salt: salt.toString() };
  } else if (lc === "citizenship") {
    assertDefined(data.citizenship, "citizenship");
    input = {
      citizenship: data.citizenship.toString(),
      salt: salt.toString(),
      expectedCitizenship: policy.expectedCitizenship,
    };
  } else if (lc === "incomerange") {
    assertDefined(data.income, "income");
    const L = BigInt(policy.L);
    const U = BigInt(policy.U);
    if (!(L < U)) throw new Error("Policy invalid: L must be < U");
    input = {
      income: data.income.toString(),
      salt: salt.toString(),
      L: L.toString(),
      U: U.toString(),
    };
  } else {
    throw new Error(`Unknown circuit: ${circuit}`);
  }

  const outDir = path.join("build", circuit, `${circuit}_js`);
  ensureDir(outDir);
  const outPath = path.join(outDir, "input.json");
  fs.writeFileSync(outPath, JSON.stringify(input, null, 2));
  console.log(`💾 Wrote ${outPath}`);
})();
