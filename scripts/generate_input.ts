import fs from "fs";
import path from "path";
import crypto from "crypto";
import { decodeJwt } from "jose";
import { alpha2ToNumeric } from "./iso3166";

interface CredentialSubject {
  id?: string;
  ageCommit?: string;
  citizenshipCommit?: string;
  incomeCommit?: string;
  currency?: string;
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

type CircuitName = "aggregate" | "age" | "citizenship" | "incomeRange";
type ArgvMap = Record<string, string>;

function parseFlags(argv: string[]): ArgvMap {
  const out: ArgvMap = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const eq = t.indexOf("=");
    if (eq >= 0) {
      const k = t.slice(2, eq);
      const v = t.slice(eq + 1);
      out[k] = v;
    } else {
      const k = t.slice(2);
      const v =
        argv[i + 1] && !argv[i + 1].startsWith("--") ? (i++, argv[i]) : "1";
      out[k] = v;
    }
  }
  return out;
}

function assertDefined<T>(v: T, name: string): asserts v is NonNullable<T> {
  if (v === undefined || v === null || v === "") {
    throw new Error(`Missing required value: ${name}`);
  }
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function getVcJwt(vcItem: VCShape): string {
  if (typeof vcItem === "string") return vcItem;
  const jwt = vcItem?.proof?.jwt;
  if (!jwt) {
    throw new Error("VC item missing proof.jwt");
  }
  return jwt;
}

function parseFieldElement(name: string, value: any): string {
  const s = String(value ?? "").trim();
  if (!/^\d+$/.test(s)) throw new Error(`Bad field element: ${name}`);
  return s;
}

function parseBig(name: string, value: any): bigint {
  const s = String(value ?? "").trim();
  if (!/^\d+$/.test(s)) throw new Error(`Bad bigint: ${name}`);
  return BigInt(s);
}

function ensureFits(v: bigint, bits: number, name: string) {
  const max = 1n << BigInt(bits);
  if (v < 0n || v >= max) {
    throw new Error(`${name}=${v} exceeds ${bits} bits`);
  }
}

(function main() {
  const [, , c, rel, ...rest] = process.argv;
  if (!c || !rel) {
    console.error(
      "Usage: tsx scripts/generate_input.ts <circuit> <vpPath> --age <n> --income <n> --cit <RO> --saltAge <n> --saltCit <n> --saltIncome <n> --L <min> --U <max> [--contextId <n>|--policy <json>]",
    );
    process.exit(1);
  }

  const circuit = c as CircuitName;
  const vpPath = path.isAbsolute(rel) ? rel : path.resolve(rel);
  const flags = parseFlags(rest);

  let contextId = flags.contextId || process.env.CONTEXT_ID || "";

  if (flags.policy) {
    const p = path.isAbsolute(flags.policy)
      ? flags.policy
      : path.resolve(flags.policy);
    const pol = JSON.parse(fs.readFileSync(p, "utf8"));
    contextId = pol.contextId ?? contextId;

    if (pol.expectedCitizenship || pol.cit) pol.expectedCitizenship ??= pol.cit;
    if (pol.expectedCitizenship) (flags as any).cit = pol.expectedCitizenship;
    if (pol.L !== undefined) (flags as any).L = String(pol.L);
    if (pol.U !== undefined) (flags as any).U = String(pol.U);
  }

  const cit = String(
    flags.cit || flags.citizenship || process.env.CITIZENSHIP || "",
  )
    .toUpperCase()
    .trim();

  const Ls = flags.L || process.env.L;
  const Us = flags.U || process.env.U;

  assertDefined(cit, "citizenship (--cit RO)");
  assertDefined(Ls, "L (--L 2000)");
  assertDefined(Us, "U (--U 10000)");
  assertDefined(flags.age, "age");
  assertDefined(flags.income, "income");
  assertDefined(flags.saltAge, "saltAge");
  assertDefined(flags.saltCit, "saltCit");
  assertDefined(flags.saltIncome, "saltIncome");

  if (!contextId) {
    throw new Error(
      "Missing contextId. Pass --contextId <n> or provide --policy <json>.",
    );
  }

  const expectedCitizenshipNum = alpha2ToNumeric(cit).toString();

  const age = parseBig("age", flags.age);
  const income = parseBig("income", flags.income);
  const citizenship = alpha2ToNumeric(cit);

  const saltAge = parseBig("saltAge", flags.saltAge);
  const saltCit = parseBig("saltCit", flags.saltCit);
  const saltIncome = parseBig("saltIncome", flags.saltIncome);

  const L = BigInt(Ls!);
  const U = BigInt(Us!);
  if (!(L < U)) throw new Error("Policy invalid: L must be < U");

  ensureFits(age, 8, "age");
  ensureFits(citizenship, 16, "citizenship");
  ensureFits(income, 32, "income");

  const vp: VPShape = JSON.parse(fs.readFileSync(vpPath, "utf8"));
  const vcs = vp.verifiableCredential ?? [];
  if (!Array.isArray(vcs) || vcs.length === 0) {
    throw new Error("VP malformed: verifiableCredential[] missing");
  }

  let ageCommit: string | undefined;
  let citizenshipCommit: string | undefined;
  let incomeCommit: string | undefined;

  for (const item of vcs) {
    const jwt = getVcJwt(item);
    const payload: any = decodeJwt(jwt);
    const now = Math.floor(Date.now() / 1000);

    if (payload?.nbf && payload.nbf > now) {
      throw new Error("VC not yet valid (nbf)");
    }
    if (payload?.exp && payload.exp < now) {
      throw new Error("VC expired (exp)");
    }

    const cs: any =
      payload?.vc?.credentialSubject ??
      (typeof item !== "string" ? item?.credentialSubject : undefined) ??
      {};

    if (cs.ageCommit !== undefined && ageCommit === undefined) {
      ageCommit = parseFieldElement("ageCommit", cs.ageCommit);
    }
    if (cs.citizenshipCommit !== undefined && citizenshipCommit === undefined) {
      citizenshipCommit = parseFieldElement(
        "citizenshipCommit",
        cs.citizenshipCommit,
      );
    }
    if (cs.incomeCommit !== undefined && incomeCommit === undefined) {
      incomeCommit = parseFieldElement("incomeCommit", cs.incomeCommit);
    }
  }

  assertDefined(ageCommit, "ageCommit in VC");
  assertDefined(citizenshipCommit, "citizenshipCommit in VC");
  assertDefined(incomeCommit, "incomeCommit in VC");

  let input: Record<string, string>;

  switch (circuit.toLowerCase()) {
    case "aggregate":
      input = {
        age: age.toString(),
        citizenship: citizenship.toString(),
        income: income.toString(),

        saltAge: saltAge.toString(),
        saltCit: saltCit.toString(),
        saltIncome: saltIncome.toString(),

        ageCommit,
        citizenshipCommit,
        incomeCommit,

        expectedCitizenship: expectedCitizenshipNum,
        L: L.toString(),
        U: U.toString(),
        contextId: BigInt(contextId).toString(),
      };
      break;

    case "age":
      input = {
        age: age.toString(),
        saltAge: saltAge.toString(),
        ageCommit,
      };
      break;

    case "citizenship":
      input = {
        citizenship: citizenship.toString(),
        saltCit: saltCit.toString(),
        citizenshipCommit,
        expectedCitizenship: expectedCitizenshipNum,
      };
      break;

    case "incomerange":
      input = {
        income: income.toString(),
        saltIncome: saltIncome.toString(),
        incomeCommit,
        L: L.toString(),
        U: U.toString(),
      };
      break;

    default:
      throw new Error(`Unknown circuit: ${circuit}`);
  }

  const outDir = path.join("build", circuit, `${circuit}_js`);
  ensureDir(outDir);
  const outPath = path.join(outDir, "input.json");
  fs.writeFileSync(outPath, JSON.stringify(input, null, 2));
  console.log(`Wrote ${outPath}`);
})();
