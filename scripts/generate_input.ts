// scripts/generate_input.ts
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

(function main() {
  // poziționale: <circuit> <vpPath>
  const [, , c, rel, ...rest] = process.argv;
  if (!c || !rel) {
    console.error(
      "Usage: tsx scripts/generate_input.ts <circuit> <vpPath> [--contextId <hex>|--policy rest/policy.json] --cit <RO> --L <min> --U <max> [--anchors 1]"
    );
    process.exit(1);
  }
  const circuit = c as CircuitName;
  const vpPath = path.isAbsolute(rel) ? rel : path.resolve(rel);

  const flags = parseFlags(rest);

  // 1) policy / parametri de verificare
  let contextId =
    flags.contextId ||
    process.env.CONTEXT_ID ||
    (() => {
      const p = path.resolve("rest/challenge.json");
      if (fs.existsSync(p)) {
        try {
          const j = JSON.parse(fs.readFileSync(p, "utf8"));
          if (j?.contextId) return String(j.contextId);
        } catch {}
      }
      return "";
    })();

  const cit = (flags.cit || flags.citizenship || process.env.CITIZENSHIP || "")
    .toUpperCase()
    .trim();
  const Ls = flags.L || process.env.L;
  const Us = flags.U || process.env.U;

  // dacă a fost dat un fișier policy, îl încărcăm (poate suprascrie contextId/L/U/cit)
  if (flags.policy) {
    const p = path.isAbsolute(flags.policy)
      ? flags.policy
      : path.resolve(flags.policy);
    const pol = JSON.parse(fs.readFileSync(p, "utf8"));
    contextId = pol.contextId ?? contextId;
    // acceptăm atât expectedCitizenship cât și cit
    if (pol.expectedCitizenship || pol.cit) pol.expectedCitizenship ??= pol.cit;
    if (pol.expectedCitizenship) (flags as any).cit = pol.expectedCitizenship;
    if (pol.L !== undefined) (flags as any).L = String(pol.L);
    if (pol.U !== undefined) (flags as any).U = String(pol.U);
  }

  assertDefined(
    cit || flags.cit || flags.citizenship,
    "citizenship (--cit RO)"
  );
  assertDefined(Ls || flags.L, "L (--L 2000)");
  assertDefined(Us || flags.U, "U (--U 10000)");
  if (!contextId) {
    throw new Error(
      "Missing contextId. Pass --contextId <hex> or provide rest/challenge.json or set CONTEXT_ID."
    );
  }

  const expectedCitizenshipNum = alpha2ToNumeric(
    (flags.cit || flags.citizenship || cit)!
  ).toString();
  const L = BigInt(flags.L || Ls!);
  const U = BigInt(flags.U || Us!);
  if (!(L < U)) throw new Error("Policy invalid: L must be < U");

  const wantAnchors = (flags.anchors ?? "0") === "1";

  // 2) încărcăm VP și extragem atributele
  const vp: VPShape = JSON.parse(fs.readFileSync(vpPath, "utf8"));
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

  function getVcJwt(vcItem: VCShape): string {
    if (typeof vcItem === "string") return vcItem;
    const jwt = vcItem?.proof?.jwt;
    if (!jwt)
      throw new Error("VC item missing proof.jwt (or isn’t a JWT string).");
    return jwt;
  }

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
      citizenship = alpha2ToNumeric(String(cs.citizenship));
      if (wantAnchors) credHash_cit = keccak256(toUtf8Bytes(jwt));
    }
  }

  if ((!age || !income || !citizenship) && vp.credentialSubject) {
    const cs = vp.credentialSubject;
    if (!age && cs.age !== undefined) age = BigInt(String(cs.age));
    if (!income && cs.income !== undefined) income = BigInt(String(cs.income));
    if (!citizenship && cs.citizenship !== undefined)
      citizenship = alpha2ToNumeric(String(cs.citizenship));
  }

  assertDefined(age, "age");
  assertDefined(income, "income");
  assertDefined(citizenship, "citizenship");
  assertDefined(didHash, "didHash");

  // 3) validări de dimensiune (circuit constraints)
  function ensureFits(v: bigint, bits: number, name: string) {
    const max = 1n << BigInt(bits);
    if (v < 0n || v >= max)
      throw new Error(`${name}=${v} exceeds ${bits} bits`);
  }
  ensureFits(citizenship, 16, "citizenship");
  ensureFits(income, 32, "income");
  ensureFits(age, 8, "age");

  // 4) pregătim inputul pentru circuit
  const salt = BigInt("0x" + crypto.randomBytes(31).toString("hex"));

  let input: Record<string, string>;
  switch (circuit.toLowerCase()) {
    case "aggregate":
      input = {
        age: age.toString(),
        income: income.toString(),
        citizenship: citizenship.toString(),
        salt: salt.toString(),
        expectedCitizenship: expectedCitizenshipNum,
        L: L.toString(),
        U: U.toString(),
        contextId: BigInt(contextId).toString(),
      };
      break;
    case "age":
      input = { age: age.toString(), salt: salt.toString() };
      break;
    case "citizenship":
      input = {
        citizenship: citizenship.toString(),
        salt: salt.toString(),
        expectedCitizenship: expectedCitizenshipNum,
      };
      break;
    case "incomerange":
      input = {
        income: income.toString(),
        salt: salt.toString(),
        L: L.toString(),
        U: U.toString(),
      };
      break;
    default:
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
