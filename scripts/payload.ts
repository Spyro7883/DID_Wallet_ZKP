import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

type Json = Record<string, any>;
type ProofPack = { proof: any; publicSignals: Json };

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

function findJwtInString(s: string | undefined | null): string | null {
  if (typeof s !== "string") return null;
  const m = s.match(JWT_REGEX);
  return m ? m[0] : null;
}

function looksLikeJwt(tok: string): boolean {
  const p = tok.split(".");
  return p.length === 3 && p[1].length > 10;
}

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

function toVpJwt(vp: any): { jwt: string } {
  if (typeof vp === "string") {
    const direct = findJwtInString(vp);
    if (direct) return { jwt: direct };

    const t = vp.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        const obj = JSON.parse(t);
        return toVpJwt(obj);
      } catch {}
    }
  }

  if (vp && typeof vp === "object") {
    if (typeof vp.jwt === "string") {
      const fromJwtField =
        findJwtInString(vp.jwt) ??
        ((): string | null => {
          const s = vp.jwt.trim();
          if (s.startsWith("{") || s.startsWith("[")) {
            try {
              const inner = JSON.parse(s);
              return (
                findJwtInString(inner?.proof?.jwt) ??
                (Array.isArray(inner?.proofs)
                  ? findJwtInString(inner.proofs[0]?.jwt)
                  : null)
              );
            } catch {}
          }
          return null;
        })();
      if (fromJwtField) return { jwt: fromJwtField };
    }
    const fromProof =
      findJwtInString(vp?.proof?.jwt) ??
      (Array.isArray(vp?.proofs) ? findJwtInString(vp.proofs[0]?.jwt) : null);
    if (fromProof) return { jwt: fromProof };

    const nested = toMaybeJwt(vp?.vp) ?? toMaybeJwt(vp?.presentation);
    if (nested) return { jwt: nested };
  }

  throw new Error(
    "VP doesn't contain a valid JWT (accept: {jwt}, string JWT, VP JSON with proof.jwt)."
  );
}

function toMaybeJwt(x: any): string | null {
  if (!x) return null;
  if (typeof x === "string") return findJwtInString(x);
  if (typeof x === "object") {
    return (
      findJwtInString(x?.jwt) ||
      findJwtInString(x?.proof?.jwt) ||
      (Array.isArray(x?.proofs) ? findJwtInString(x.proofs[0]?.jwt) : null)
    );
  }
  return null;
}

function augment(ps: Json, audience: string, nonce: string) {
  const out = { ...ps };
  if (!("audience" in out)) out.audience = audience;
  if (!("nonce" in out)) out.nonce = nonce;
  return out;
}
const same = (a: any, b: any) => String(a) === String(b);

function loadPack(
  proofPath: string | undefined,
  pubPath: string | undefined,
  labels: [string, string]
): ProofPack {
  const proof = readJSON(proofPath, labels[0]);
  const publicSignals = readJSON(pubPath, labels[1]);
  return { proof, publicSignals };
}

const program = new Command();
program
  .name("build-payload")
  .description(
    "Build { vp:{jwt}, zk:{age,citizenship,income}, audience, nonce }"
  )
  .requiredOption("--vp <path>", "Path la VP (.json sau .txt)")
  .requiredOption("--audience <str>", "Audience (ex: service:demo)")
  .requiredOption("--nonce <hex>", "Nonce (ex: 0x...)")
  .requiredOption("--age-proof <path>", "age proof.json")
  .requiredOption("--age-public <path>", "age public.json")
  .requiredOption("--cit-proof <path>", "citizenship proof.json")
  .requiredOption("--cit-public <path>", "citizenship public.json")
  .requiredOption("--inc-proof <path>", "incomeRange proof.json")
  .requiredOption("--inc-public <path>", "incomeRange public.json")
  .option("--augment", "Inject audience/nonce in publicSignals", false)
  .option("--out <path>", "Fișier ieșire", "access_payload.json")
  .action((opts: any) => {
    const vpSrc = readVPFlexible(opts.vp);
    const vp = { jwt: extractJwtFromVp(vpSrc) };

    const age = loadPack(opts.ageProof, opts.agePublic, [
      "age-proof",
      "age-public",
    ]);
    const cit = loadPack(opts.citProof, opts.citPublic, [
      "cit-proof",
      "cit-public",
    ]);
    const inc = loadPack(opts.incProof, opts.incPublic, [
      "inc-proof",
      "inc-public",
    ]);

    if (opts.augment) {
      age.publicSignals = augment(age.publicSignals, opts.audience, opts.nonce);
      cit.publicSignals = augment(cit.publicSignals, opts.audience, opts.nonce);
      inc.publicSignals = augment(inc.publicSignals, opts.audience, opts.nonce);
      console.warn("⚠️ Injected audience/nonce in publicSignals.");
    }

    const checkAud = (label: string, ps: Json) => {
      if (!same(ps?.audience, opts.audience))
        throw new Error(
          `audience mismatch (${label}): expected "${opts.audience}", got ${ps?.audience}`
        );
    };
    const checkNon = (label: string, ps: Json) => {
      if (!same(ps?.nonce, opts.nonce))
        throw new Error(
          `nonce mismatch (${label}): expected "${opts.nonce}", got ${ps?.nonce}`
        );
    };
    checkAud("age", age.publicSignals);
    checkAud("citizenship", cit.publicSignals);
    checkAud("income", inc.publicSignals);
    checkNon("age", age.publicSignals);
    checkNon("citizenship", cit.publicSignals);
    checkNon("income", inc.publicSignals);

    for (const k of ["nullifier", "privHash"] as const) {
      const av = age.publicSignals?.[k],
        cv = cit.publicSignals?.[k],
        iv = inc.publicSignals?.[k];
      if (av !== undefined || cv !== undefined || iv !== undefined) {
        if (!(same(av, cv) && same(av, iv))) {
          throw new Error(`${k} mismatch between proofs`);
        }
      }
    }

    const outPath = resolve(opts.out ?? "access_payload.json");
    const payload = {
      vp,
      audience: opts.audience,
      nonce: opts.nonce,
      zk: { age, citizenship: cit, income: inc },
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`✅ Payload saved in ${outPath}`);
  });

program.parseAsync(process.argv);
