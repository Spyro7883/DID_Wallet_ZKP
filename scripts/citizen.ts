import { DataSource } from "typeorm";
import { Entities } from "@veramo/data-store";
import * as zlib from "zlib";
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from "crypto";

import { createInterface } from "readline";
import { setupAgent, type TAgent, listWalletProfiles } from "./agent.ts";
import { base64url } from "jose";
import type { IIdentifier } from "@veramo/core";
import * as fs from "fs/promises";
import * as path from "path";

const STRICT_OPS = (process.env.STRICT_OPS ?? "0") === "1";

let PROFILE = "";
let REST_DIR = "";
let CONN_PATH = "";
let SESSION_PASS = "";

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

const gzip = (b: Buffer) =>
  new Promise<Buffer>((res, rej) =>
    zlib.gzip(b, (e, o) => (e ? rej(e) : res(o)))
  );
const gunzip = (b: Buffer) =>
  new Promise<Buffer>((res, rej) =>
    zlib.gunzip(b, (e, o) => (e ? rej(e) : res(o)))
  );

const slug = (p: string) =>
  (p || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
const schemaFor = (profile: string) => `wallet_${slug(profile)}`;

const BACKUP_RX = /\.(wallet(\.json)?)$/i;

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findBackups(root = "rest"): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: any[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true } as any);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (BACKUP_RX.test(e.name)) out.push(full);
    }
  }
  await walk(root);
  return out.sort().reverse();
}

async function readBackupContainer(file: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(file);
    const txt = raw.toString("utf8").replace(/^\uFEFF/, "");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function ds(schema?: string, withEntities = false): Promise<DataSource> {
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
  } as any);
  if (!d.isInitialized) await d.initialize();
  return d;
}
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

function getArg(name: string) {
  const i = process.argv.findIndex(
    (a) => a === name || a.startsWith(name + "=")
  );
  if (i === -1) return null;
  return process.argv[i].includes("=")
    ? process.argv[i].split("=")[1]
    : process.argv[i + 1];
}

async function chooseProfile(): Promise<string> {
  while (true) {
    const existing = await listWalletProfiles();
    console.log("\nLocal wallets:");
    if (existing.length === 0) console.log("nothing");
    existing.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log(`  ${existing.length + 1}. + Creeate a new wallet`);
    console.log(`  ${existing.length + 2}. ♻️  Restore from backup`);

    const pickRaw = await promptUser("\nChoose #: ");
    const pick = Number(pickRaw);

    if (!Number.isNaN(pick) && pick >= 1 && pick <= existing.length) {
      return existing[pick - 1];
    }

    if (pick === existing.length + 1) {
      const alias = (await promptUser("Name new wallet: ")).trim();
      const sl = alias
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (existing.includes(sl)) {
        console.log("❌ Name has already been used. Choose another.");
        continue;
      }
      return alias;
    }

    if (pick === existing.length + 2) {
      const restored = await restoreWallet();
      if (restored) {
        console.log(`\n✅ Open restored profile: ${restored}`);
        return restored;
      }
      continue;
    }

    console.log("Invalid option.");
  }
}

async function promptHidden(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const out = (rl as any).output as NodeJS.WritableStream;
  (rl as any)._writeToOutput = function (_: string) {
    const len = (rl as any).line?.length ?? 0;
    out.write("\x1b[2K\x1b[200D" + label + "*".repeat(len));
  };
  return new Promise((resolve) =>
    rl.question(label, (ans) => {
      rl.close();
      out.write("\n");
      resolve(ans.trim());
    })
  );
}

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function getPassphraseFromStdinIfFlag(): Promise<string | null> {
  if (!process.argv.includes("--passphrase-stdin")) return null;
  const chunks: Buffer[] = [];
  return await new Promise((resolve) => {
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8").trim())
    );
  });
}

async function loadConns(): Promise<Record<string, any>> {
  try {
    return JSON.parse(await fs.readFile(CONN_PATH, "utf8"));
  } catch {
    return {};
  }
}
async function saveConns(obj: Record<string, any>) {
  await fs.mkdir(REST_DIR, { recursive: true });
  await fs.writeFile(CONN_PATH, JSON.stringify(obj, null, 2));
}

async function connectServer(agent: TAgent): Promise<void> {
  const base = await promptUser("Server base (ex: http://localhost:5501): ");

  const ids = await agent.didManagerFind();
  if (ids.length === 0) {
    console.log("You don't have DIDs. Create one first.");
    return;
  }
  ids.forEach((d, i) => console.log(`${i + 1}. ${d.did} (${d.alias || ""})`));
  const idx = Number(await promptUser("Pick DID holder #: ")) - 1;
  const holder = ids[idx];
  if (!holder) return console.log("Invalid section.");
  const holderDid = holder.did;

  const ch = await fetch(`${base}/connect/challenge`).then((r) => r.json());

  const payload = { id: ch.id, challenge: ch.challenge, ts: Date.now() };
  const data = new TextEncoder().encode(JSON.stringify(payload));

  const holderFull = await agent.didManagerGet({ did: holderDid });
  const key = holderFull.keys[0];
  const algorithm = key.type === "Ed25519" ? "EdDSA" : "ES256K";

  let sig = await agent.keyManagerSign({ keyRef: key.kid, data, algorithm });
  let sigB64u: string;
  if (sig instanceof Uint8Array) sigB64u = base64url.encode(sig);
  else if (typeof sig === "string") {
    if (sig.startsWith("0x"))
      sigB64u = base64url.encode(
        Uint8Array.from(Buffer.from(sig.slice(2), "hex"))
      );
    else {
      try {
        base64url.decode(sig);
        sigB64u = sig;
      } catch {
        sigB64u = base64url.encode(Buffer.from(sig, "base64"));
      }
    }
  } else throw new Error("Unknown signature format from keyManagerSign");

  const conf = await fetch(`${base}/connect/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: ch.id,
      holderDid,
      payload,
      sig: sigB64u,
      alg: algorithm,
    }),
  }).then((r) => r.json());

  if (!conf?.token) return console.log("Failed pairing:", conf);

  const conns = await loadConns();
  conns[base] = {
    connectionId: conf.connectionId,
    token: conf.token,
    holderDid: holder.did,
    issuerDid: conf.issuerDid,
  };
  await saveConns(conns);

  console.log(
    `✅ Conected at ${base}\n   Issuer DID: ${conf.issuerDid}\n   Holder DID: ${holder.did}\n   Token saved in ${CONN_PATH}`
  );
}

async function requestVC(agent: TAgent): Promise<void> {
  const conns = await loadConns();
  const bases = Object.keys(conns);
  if (bases.length === 0)
    return console.log(
      "You are not conected at no issuer. First, use 'Connect'."
    );
  bases.forEach((b, i) => console.log(`${i + 1}. ${b}`));
  const bidx = Number(await promptUser("Pick server #: ")) - 1;
  const base = bases[bidx];
  if (!base) return console.log("Invalid selection.");
  const { token, holderDid } = conns[base];

  console.log(
    '\nEnter claims (JSON sau key=value). Ex: {"age":25,"income":9000,"citizenship":"RO"}'
  );
  const first = await promptUser("Claims: ");
  let claims: any = {};
  if (first.trim().startsWith("{")) claims = JSON.parse(first);
  else {
    let cur = first;
    while (cur) {
      const [k, v] = cur.split("=");
      if (k && v) claims[k.trim()] = isNaN(Number(v)) ? v.trim() : Number(v);
      cur = await promptUser("Another claim or Enter: ");
    }
  }

  const type = await promptUser(
    'Type VC (ex: "PersonCredential", Enter pt. none): '
  );
  const validity = await promptUser("Valability (sec, Enter for none): ");

  const resp = await fetch(`${base}/issue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      subjectDid: holderDid,
      claims,
      type: type ? [type] : undefined,
      validitySeconds: validity ? Number(validity) : undefined,
    }),
  }).then((r) => r.json());

  if (!resp?.ok || !resp?.vc) return console.log("Failed emiting:", resp);

  const saved = await agent.dataStoreSaveVerifiableCredential({
    verifiableCredential: resp.vc,
  });
  console.log(`✅ VC received and saved. Hash: ${saved?.hash || "(ok)"}`);
}

async function listDIDs(agent: TAgent): Promise<void> {
  console.log("\n DIDs available:");
  console.log("═".repeat(80));
  const identifiers = await agent.didManagerFind();
  if (identifiers.length === 0) console.log("There are no DIDs created.");
  else
    identifiers.forEach((id: IIdentifier, index: number) => {
      console.log(`\n${index + 1}. 🆔 ${id.did}`);
      console.log(` Provider: ${id.provider}`);
      console.log(` Alias: ${id.alias || "N/A"}`);
      console.log(` Keys: ${id.keys.length}`);
      id.keys.forEach((key, kidx) =>
        console.log(
          `      ${kidx + 1}. Type: ${key.type}, KID: ${key.kid.substring(
            0,
            20
          )}...`
        )
      );
    });
  console.log("═".repeat(80));
}

async function createDID(agent: TAgent): Promise<void> {
  console.log("\n Create new DID");
  console.log("═".repeat(80));
  const providerChoice = await promptUser("Provider (1=did:key, 2=did:ethr): ");
  const provider = providerChoice === "2" ? "did:ethr" : "did:key";
  const alias = await promptUser(
    "Alias (optional, Enter for auto-generation): "
  );
  try {
    const identifier = await agent.didManagerCreate({
      alias: alias || `citizen-${Date.now()}`,
      provider,
      kms: "local",
    });
    console.log("\n DID created with success!");
    console.log(
      ` DID: ${identifier.did}\n Alias: ${identifier.alias}\n Keys: ${identifier.keys.length}`
    );
  } catch (e: any) {
    console.error("\n Error at DID creation:", e?.message || e);
  }
}

async function exportDID(agent: TAgent): Promise<void> {
  const ids = await agent.didManagerFind();
  if (ids.length === 0) return console.log("\n There are no DIDs to export.");
  await listDIDs(agent);
  const index = await promptUser("\nChoose DID number to export: ");
  const selected = ids[parseInt(index) - 1];
  if (!selected) return console.log(" Wrong option!");
  const filename = `did_${selected.alias || "export"}_${Date.now()}.json`;
  const filepath = path.join(REST_DIR, filename);
  await fs.mkdir(REST_DIR, { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(selected, null, 2));
  console.log(`\n DID exported in: ${filepath}`);
}

async function listVCs(agent: TAgent): Promise<void> {
  console.log("\n📜 Verifiable Credentials:");
  console.log("═".repeat(80));
  const credentials = await agent.dataStoreORMGetVerifiableCredentials();
  if (credentials.length === 0) console.log("There are no emitted VCs yet.");
  else
    credentials.forEach((vc, index) => {
      const cred = vc.verifiableCredential;
      console.log(`\n${index + 1}. VC Hash: ${vc.hash}`);
      console.log(
        ` Issuer: ${
          typeof cred.issuer === "string" ? cred.issuer : cred.issuer.id
        }`
      );
      console.log(` Subject: ${cred.credentialSubject.id || "N/A"}`);
      console.log(
        ` Type: ${Array.isArray(cred.type) ? cred.type.join(", ") : cred.type}`
      );
      console.log(` Issued: ${cred.issuanceDate}`);
      console.log(` Claims:`, JSON.stringify(cred.credentialSubject, null, 2));
    });
  console.log("═".repeat(80));
}

async function createVC(agent: TAgent): Promise<void> {
  console.log("\n Create Verifiable Credential");
  console.log("═".repeat(80));
  const ids = await agent.didManagerFind();
  if (ids.length === 0)
    return console.log("\n U have to create at least one DID!");
  ids.forEach((id, idx) => console.log(`${idx + 1}. ${id.did} (${id.alias})`));
  const issuerIdx = await promptUser("\nPick number for Issuer DID: ");
  const subjectIdx = await promptUser("Pick number for Subject DID: ");
  const issuerDID = ids[parseInt(issuerIdx) - 1]?.did;
  const subjectDID = ids[parseInt(subjectIdx) - 1]?.did;
  if (!issuerDID || !subjectDID) return console.log("Wrong choice!");
  const claimsInput = await promptUser("Claims: ");
  let claims: any = {};
  if (claimsInput.startsWith("{")) claims = JSON.parse(claimsInput);
  else {
    let current = claimsInput;
    while (current) {
      const [k, v] = current.split("=");
      if (k && v) claims[k.trim()] = isNaN(Number(v)) ? v.trim() : Number(v);
      current = await promptUser("Add more claims: ");
    }
  }
  try {
    const issuer = await agent.didManagerGet({ did: issuerDID });
    const vcProofFormat = issuer.provider === "did:ethr" ? "jwt" : "lds";
    const vc = await agent.createVerifiableCredential({
      credential: {
        issuer: { id: issuerDID },
        credentialSubject: { id: subjectDID, ...claims },
        type: ["VerifiableCredential"],
      },
      proofFormat: vcProofFormat,
    });
    const filename = `vc_${Date.now()}.json`;
    const filepath = path.join(REST_DIR, filename);
    await fs.mkdir(REST_DIR, { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(vc, null, 2));
    console.log("\n VC created & saved:", filepath);
  } catch (e: any) {
    console.error("\n Error at VC creation:", e?.message || e);
  }
}

async function listVPs(agent: TAgent): Promise<void> {
  console.log("\n Verifiable Presentations:");
  console.log("═".repeat(80));
  const presentations = await agent.dataStoreORMGetVerifiablePresentations();
  if (presentations.length === 0) console.log(" There are no VPs created yet.");
  else
    presentations.forEach((vp, index) => {
      const pres = vp.verifiablePresentation;
      console.log(`\n${index + 1}. VP Hash: ${vp.hash}`);
      console.log(` Holder: ${pres.holder}`);
      console.log(
        ` Credentials: ${
          Array.isArray(pres.verifiableCredential)
            ? pres.verifiableCredential.length
            : 0
        }`
      );
      console.log(
        ` Type: ${Array.isArray(pres.type) ? pres.type.join(", ") : pres.type}`
      );
    });
  console.log("═".repeat(80));
}

async function createVP(agent: TAgent): Promise<void> {
  console.log("\n Create Verifiable Presentation");
  console.log("═".repeat(80));
  const credentials = await agent.dataStoreORMGetVerifiableCredentials();
  if (credentials.length === 0)
    return console.log("\n You have to create at least one VC!");
  const ids = await agent.didManagerFind();
  if (ids.length === 0)
    return console.log("\n You have to create at least one DID!");
  ids.forEach((id, idx) => console.log(`${idx + 1}. ${id.did} (${id.alias})`));
  const holderIdx = await promptUser("\nChoose number for Holder DID: ");
  const holderDID = ids[parseInt(holderIdx) - 1]?.did;
  if (!holderDID) return console.log("Invalid option!");

  credentials.forEach((vc, idx) => {
    const issuer =
      typeof vc.verifiableCredential.issuer === "string"
        ? vc.verifiableCredential.issuer
        : vc.verifiableCredential.issuer.id;
    console.log(
      `${idx + 1}. ${vc.hash.substring(0, 16)}... (Issuer: ${issuer.substring(
        0,
        30
      )}...)`
    );
  });
  const vcIndices = (await promptUser("\nChoose VC numbers: "))
    .split(",")
    .map((s) => parseInt(s.trim()) - 1);

  const selectedVCs = vcIndices
    .map((i) => credentials[i])
    .filter(Boolean)
    .map((x) => x.verifiableCredential);
  if (selectedVCs.length === 0)
    return console.log("You've picked no available VC!");

  try {
    const holder = await agent.didManagerGet({ did: holderDID });
    const vpProofFormat = holder.provider === "did:ethr" ? "jwt" : "lds";
    const vp = await agent.createVerifiablePresentation({
      presentation: { holder: holderDID, verifiableCredential: selectedVCs },
      proofFormat: vpProofFormat,
    });
    const filename = `vp_${Date.now()}.json`;
    const filepath = path.join(REST_DIR, filename);
    await fs.mkdir(REST_DIR, { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(vp, null, 2));
    console.log(`Saved VP at: ${filepath}`);
  } catch (e: any) {
    console.error("\n Error at VP creation:", e?.message || e);
  }
}

async function exportVC(agent: TAgent): Promise<void> {
  const credentials = await agent.dataStoreORMGetVerifiableCredentials();
  if (credentials.length === 0)
    return console.log("\n There are no VCs to export.");
  await listVCs(agent);
  const index = await promptUser("\nPick VC number to export: ");
  const selectedVC = credentials[parseInt(index) - 1];
  if (!selectedVC) return console.log(" Invalid option!");
  const filename = `vc_${selectedVC.hash.substring(0, 8)}_${Date.now()}.json`;
  const filepath = path.join(REST_DIR, filename);
  await fs.mkdir(REST_DIR, { recursive: true });
  await fs.writeFile(
    filepath,
    JSON.stringify(selectedVC.verifiableCredential, null, 2)
  );
  console.log(`\n VC exported in: ${filepath}`);
}

async function exportVP(agent: TAgent): Promise<void> {
  const presentations = await agent.dataStoreORMGetVerifiablePresentations();
  if (presentations.length === 0)
    return console.log("\n There are no VPs to export.");
  await listVPs(agent);
  const index = await promptUser(
    "\nPick the number of the VP that will be exported: "
  );
  const selectedVP = presentations[parseInt(index) - 1];
  if (!selectedVP) return console.log("Wrong choice!");
  const filename = `vp_demo.json`;
  const filepath = path.join(REST_DIR, filename);
  await fs.mkdir(REST_DIR, { recursive: true });
  await fs.writeFile(
    filepath,
    JSON.stringify(selectedVP.verifiablePresentation, null, 2)
  );
  console.log(`\n Exported VP in: ${filepath}`);
}

async function backupWallet(profile: string): Promise<void> {
  const schema = schemaFor(profile);

  const d = await ds(schema);
  const meta = (
    await d.query(
      `SELECT salt, pass_guard FROM "${schema}".wallet_meta LIMIT 1;`
    )
  )?.[0];

  if (!meta) {
    await d.destroy();
    return console.log(`❌ Wallet "${profile}" has not been initialized.`);
  }

  const saltBuf: Buffer = Buffer.from(meta.salt);
  const guardHex: string = String(meta.pass_guard || "");

  if (STRICT_OPS) {
    const rePass = await promptHidden("Reenter wallet's password: ");
    const dk = scryptSync(rePass, saltBuf, 32);
    const calcGuard = createHmac("sha256", dk)
      .update("kms-guard-v1")
      .digest("hex");
    if (guardHex && calcGuard !== guardHex) {
      await d.destroy();
      return console.log("❌ Wrong password. Canceled backup.");
    }
  }

  const dump: any = {
    version: 1,
    profile: slug(profile),
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

  let exportPass = SESSION_PASS;
  const useSame =
    (
      await promptUser("Encrypt backup with wallet's pass? (Y/n): ")
    ).toLowerCase() !== "n";
  if (!useSame) {
    const p1 = await promptHidden("Backup password: ");
    const p2 = await promptHidden("Confirm backup password: ");
    if (!p1 || p1 !== p2)
      return console.log("❌ Backup passwords do not coincide.");
    exportPass = p1;
  }

  const gz = await gzip(Buffer.from(JSON.stringify(dump)));
  const bkpSalt = randomBytes(16);
  const key = scryptSync(exportPass, bkpSalt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(gz), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    format: "did-wallet-backup",
    version: 1,
    profile: slug(profile),
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

  const outDir = path.join("rest", slug(profile));
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `backup_${slug(profile)}_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.wallet.json`
  );
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Backup saved: ${outPath}`);
}

async function restoreWallet(): Promise<string | null> {
  const candidates = await findBackups();
  let chosenPath = "";

  if (candidates.length === 0) {
    console.log("ℹ️  Haven't found backups in 'rest' folder.");
    chosenPath = (await promptUser("Backup file path: ")).trim();
  } else {
    console.log("\n📦 Found backups:");
    candidates.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log(`  ${candidates.length + 1}. ✍️  Enter manual path`);

    const pick = Number(await promptUser("\nPick #: "));
    if (pick === candidates.length + 1) {
      chosenPath = (await promptUser("Backup file path: ")).trim();
    } else {
      chosenPath = candidates[pick - 1] || "";
    }
  }

  if (!chosenPath) {
    console.log("↩️  Canceled.");
    return null;
  }
  if (!(await fileExists(chosenPath))) {
    console.log("❌ File doesn't exist, verify path.");
    return null;
  }

  const container = await readBackupContainer(chosenPath);
  if (!container) {
    console.log("❌ Couldn't read/parse backup file.");
    return null;
  }
  if (container.format !== "did-wallet-backup" || container.version !== 1) {
    console.log("❌ Backup format invalid or unsupported version.");
    return null;
  }

  const backupPass = await promptHidden("Backup password: ");
  let gz: Buffer;
  try {
    const key = scryptSync(
      backupPass,
      Buffer.from(container.kdf.saltHex, "hex"),
      32
    );
    const iv = Buffer.from(container.ivHex, "hex");
    const tag = Buffer.from(container.tagHex, "hex");
    const ciphertext = Buffer.from(container.ciphertextB64, "base64");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    gz = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    console.log("❌ Backup password wrong or corrupted file.");
    return null;
  }

  let dump: any;
  try {
    dump = JSON.parse((await gunzip(gz)).toString("utf8"));
  } catch {
    console.log("❌ Backup content is corrupted.");
    return null;
  }

  const walletPass = await promptHidden("Wallet passphrase: ");
  const salt = Buffer.from(dump.meta.saltHex, "hex");
  const guard = createHmac("sha256", scryptSync(walletPass, salt, 32))
    .update("kms-guard-v1")
    .digest("hex");
  if (guard !== dump.meta.passGuard) {
    console.log("❌ Wrong password for backup.");
    return null;
  }

  const target =
    (
      await promptUser(`Restore as profile [Enter = ${dump.profile}]: `)
    ).trim() || dump.profile;
  const schema = schemaFor(target);

  await ensureSchema(schema);

  if (!(await schemaIsEmpty(schema))) {
    const ok = (
      await promptUser(
        `Schema "${schema}" already has data. Overwrite? (y/N): `
      )
    )
      .toLowerCase()
      .startsWith("y");
    if (!ok) {
      console.log("↩️ Canceled.");
      return null;
    }
  }

  const dSync = await ds(schema, true);
  await dSync.synchronize();
  await dSync.destroy();

  const d = await ds(schema);
  await d.query(
    `INSERT INTO "${schema}".wallet_meta (id, salt, pass_guard)
     VALUES (TRUE, $1, $2)
     ON CONFLICT (id) DO UPDATE SET salt=EXCLUDED.salt, pass_guard=EXCLUDED.pass_guard;`,
    [Buffer.from(dump.meta.saltHex, "hex"), dump.meta.passGuard]
  );

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

  for (const t of TABLES) {
    if (t === "wallet_meta") continue;
    const rows: any[] = dump.tables[t] || [];
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    for (const r of rows) {
      const vals = cols.map((c) => r[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      await d.query(
        `INSERT INTO "${schema}"."${t}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`,
        vals
      );
    }
  }

  await d.destroy();
  console.log(
    `\n✅ Complet restore in profile "${target}" (schema: ${schema}).`
  );
  return target;
}

async function getPassphraseFromUser(): Promise<string> {
  const stdinPw = await getPassphraseFromStdinIfFlag();
  const passphrase = stdinPw ?? (await promptHidden("Wallet pass: "));
  if (!passphrase) {
    console.error("Empty pass.");
    process.exit(1);
  }
  return passphrase;
}

async function showMenu(): Promise<void> {
  console.clear();
  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║           🏛️  CITIZEN - DID/VC/VP Manager                   ║"
  );
  console.log(
    "║              Zero-Knowledge Proof Wallet                     ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );
  console.log("\n📍 DID Management:");
  console.log("  1. 📋 List DIDs");
  console.log("  2. ➕ Create new DID ");
  console.log("  3. 📤 Export DID");
  console.log("\n📜 Verifiable Credentials:");
  console.log("  4. 📋 List VC-uri");
  console.log("  5. ➕ Create new VC");
  console.log("  6. 📤 Export VC");
  console.log("\n🎭 Verifiable Presentations:");
  console.log("  7. 📋 List VPs");
  console.log("  8. ➕ Create new VP");
  console.log("  9. 📤 Export VP");
  console.log("\n🔗 Connections:");
  console.log(" 10. 🔐 Connect to issuer/verifier");
  console.log("\n📥 Issuer:");
  console.log(" 11. 📩 Request VC from issuer");
  console.log("\n🧰 Backup & Restore:");
  console.log(" 12. 💾 Backup wallet");
  console.log(" 13. ♻️  Restore wallet from file");
  console.log("\n❌ 0. Exit");
  console.log(
    "════════════════════════════════════════════════════════════════"
  );
}

async function main(): Promise<void> {
  console.log("Initialize Veramo Agent...");
  try {
    const arg = getArg("--profile");
    PROFILE = arg || (await chooseProfile());
    if (!PROFILE) {
      console.error("Profil invalid.");
      process.exit(1);
    }

    SESSION_PASS = await getPassphraseFromUser();

    REST_DIR = path.join("rest", PROFILE);
    CONN_PATH = path.join(REST_DIR, "connections.json");
    await fs.mkdir(REST_DIR, { recursive: true });

    const agent = await setupAgent(PROFILE, SESSION_PASS);
    console.log(`✅ Wallet ready for "${PROFILE}"\n`);

    let running = true;
    while (running) {
      await showMenu();
      const choice = await promptUser("\n Pick an option: ");
      switch (choice) {
        case "1":
          await listDIDs(agent);
          break;
        case "2":
          await createDID(agent);
          break;
        case "3":
          await exportDID(agent);
          break;
        case "4":
          await listVCs(agent);
          break;
        case "5":
          await createVC(agent);
          break;
        case "6":
          await exportVC(agent);
          break;
        case "7":
          await listVPs(agent);
          break;
        case "8":
          await createVP(agent);
          break;
        case "9":
          await exportVP(agent);
          break;
        case "10":
          await connectServer(agent);
          break;
        case "11":
          await requestVC(agent);
          break;
        case "12":
          await backupWallet(PROFILE);
          break;
        case "13":
          await restoreWallet();
          break;
        case "0":
          console.log("\n Goodbye!");
          running = false;
          break;
        default:
          console.log("\n Wrong option!");
      }
      if (running) await promptUser("\n⏎ Click Enter to continue...");
    }
    process.exit(0);
  } catch (error: any) {
    console.error("\n Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
