// scripts/restore.ts
import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { DataSource } from "typeorm";
import { scryptSync, createDecipheriv, createHmac } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as zlib from "zlib";
import { createInterface } from "readline";
import { Entities } from "@veramo/data-store";

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

const gunzip = (buf: Buffer) =>
  new Promise<Buffer>((res, rej) =>
    zlib.gunzip(buf, (e, out) => (e ? rej(e) : res(out)))
  );

const slug = (p: string) =>
  (p || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
const schemaFor = (profile: string) => `wallet_${slug(profile)}`;

function getArg(name: string) {
  const i = process.argv.findIndex(
    (a) => a === name || a.startsWith(name + "=")
  );
  if (i === -1) return null;
  return process.argv[i].includes("=")
    ? process.argv[i].split("=")[1]
    : process.argv[i + 1];
}
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(question, (ans) => {
      rl.close();
      res(ans.trim());
    })
  );
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

async function ds(schema?: string, withEntities = false): Promise<DataSource> {
  const d = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.POSTGRESQL_USER,
    password: process.env.POSTGRESQL_PASS,
    database: process.env.POSTGRESQL_DB,
    schema,
    entities: withEntities ? Entities : undefined,
    synchronize: false,
    logging: ["warn", "error"],
  } as any);
  if (!d.isInitialized) await d.initialize();
  return d;
}

async function ensureSchema(schema: string) {
  const admin = await ds();
  await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await admin.destroy();
}

// verificăm dacă schema e “goală” (fără rânduri reale)
async function schemaIsEmpty(schema: string): Promise<boolean> {
  const d = await ds(schema);
  try {
    for (const t of TABLES) {
      const c = await d
        .query(`SELECT 1 FROM "${schema}"."${t}" LIMIT 1;`)
        .catch(() => []);
      if (Array.isArray(c) && c.length > 0) return false;
    }
    return true;
  } finally {
    await d.destroy();
  }
}

async function main() {
  const fileArg = getArg("--file");
  const asArg = getArg("--as"); // profil nou (opțional)
  const force = process.argv.includes("--force");

  const filePath = fileArg || (await prompt("Backup file path: "));
  const raw = await fs.readFile(filePath, "utf8");
  const container = JSON.parse(raw);

  if (container.format !== "did-wallet-backup" || container.version !== 1)
    throw new Error("Format backup invalid sau versiune nesuportată.");

  const backupPass = await promptHidden("Backup password: ");
  const kdf = container.kdf || {
    name: "scrypt",
    N: 16384,
    r: 8,
    p: 1,
    dkLen: 32,
  };
  const key = scryptSync(
    backupPass,
    Buffer.from(container.kdf.saltHex, "hex"),
    kdf.dkLen
  );
  const iv = Buffer.from(container.ivHex, "hex");
  const tag = Buffer.from(container.tagHex, "hex");
  const ciphertext = Buffer.from(container.ciphertextB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const gz = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const json = await gunzip(gz);
  const dump = JSON.parse(json.toString("utf8"));

  const targetProfile = slug(asArg || dump.profile);
  const schema = schemaFor(targetProfile);

  // validare parola wallet (din backup) — nu importăm dacă parola e greșită
  const walletPass = await promptHidden(
    "Wallet passphrase (același cu cel original): "
  );
  const salt = Buffer.from(dump.meta.saltHex, "hex");
  const guard = createHmac("sha256", scryptSync(walletPass, salt, 32))
    .update("kms-guard-v1")
    .digest("hex");
  if (guard !== dump.meta.passGuard) {
    throw new Error("Parolă wallet invalidă pentru acest backup.");
  }

  // pregătim schema țintă
  await ensureSchema(schema);

  if (!force && !(await schemaIsEmpty(schema))) {
    throw new Error(
      `Schema "${schema}" are deja date. Rulează cu --force doar dacă știi ce faci (sau alege --as alt profil).`
    );
  }

  // creează structura de tabele (Entities) dacă lipsesc
  const dSync = await ds(schema, true);
  await dSync.synchronize(); // creează tabelele veramo în schema
  await dSync.destroy();

  const d = await ds(schema);

  // 1) wallet_meta
  await d.query(
    `INSERT INTO "${schema}".wallet_meta (id, salt, pass_guard)
     VALUES (TRUE, $1, $2)
     ON CONFLICT (id) DO UPDATE SET salt=EXCLUDED.salt, pass_guard=EXCLUDED.pass_guard;`,
    [Buffer.from(dump.meta.saltHex, "hex"), dump.meta.passGuard]
  );

  // 2) restul tabelelor
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
        `INSERT INTO "${schema}"."${t}" (${colList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING;`,
        vals
      );
    }
  }

  await d.destroy();

  const outDir = path.join("rest", targetProfile);
  await fs.mkdir(outDir, { recursive: true });
  console.log(
    `\n✅ Restore complet în profilul "${targetProfile}" (schema: ${schema}).`
  );
  console.log(
    `   Poți porni citizen cu:  npx tsx scripts/citizen.ts --profile ${targetProfile}`
  );
}

main().catch((e) => {
  console.error("❌ Restore failed:", e?.message || e);
  process.exit(1);
});
