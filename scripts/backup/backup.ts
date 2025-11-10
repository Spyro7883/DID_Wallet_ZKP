// scripts/backup.ts
import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { DataSource } from "typeorm";
import { randomBytes, scryptSync, createCipheriv } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as zlib from "zlib";
import { createInterface } from "readline";

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

const gzip = (buf: Buffer) =>
  new Promise<Buffer>((res, rej) =>
    zlib.gzip(buf, (e, out) => (e ? rej(e) : res(out)))
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

async function ds(schema?: string): Promise<DataSource> {
  const d = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.POSTGRESQL_USER,
    password: process.env.POSTGRESQL_PASS,
    database: process.env.POSTGRESQL_DB,
    schema, // când citim nu avem nevoie de Entities
    logging: ["warn", "error"],
  });
  if (!d.isInitialized) await d.initialize();
  return d;
}

async function main() {
  const profileArg = getArg("--profile");
  const outArg = getArg("--out");

  const profile = profileArg || (await prompt("Profile (ex: eusebiu): "));
  if (!profile) throw new Error("Profil invalid.");
  const schema = schemaFor(profile);

  const walletPass = await promptHidden(
    "Wallet passphrase (pentru validare): "
  );
  if (!walletPass) throw new Error("Parola goală.");

  // alegem o parolă pentru fișierul de backup (poate fi aceeași, dar recomand diferită)
  const exportPass = await promptHidden(
    "Backup password (pt. criptare fișier): "
  );
  if (!exportPass) throw new Error("Backup password goală.");
  const exportPass2 = await promptHidden("Confirm backup password: ");
  if (exportPass !== exportPass2)
    throw new Error("Backup passwords nu coincid.");

  const d = await ds(schema);

  // wallet_meta (verificăm parola prin guard)
  const metaRow = (
    await d.query(
      `SELECT salt, pass_guard FROM "${schema}".wallet_meta LIMIT 1;`
    )
  )?.[0];
  if (!metaRow) throw new Error(`Wallet "${profile}" nu este inițializat.`);
  const saltBuf: Buffer = Buffer.from(metaRow.salt);
  const guardHex: string = String(metaRow.pass_guard);

  // validare parolă (nu stocăm cheia, doar verificăm guard)
  const dk = scryptSync(walletPass, saltBuf, 32);
  const cryptoGuard = require("crypto")
    .createHmac("sha256", dk)
    .update("kms-guard-v1")
    .digest("hex");
  if (cryptoGuard !== guardHex)
    throw new Error("Parolă greșită pentru acest wallet.");

  // dump tabele
  const dump: any = {
    version: 1,
    profile: slug(profile),
    schema,
    createdAt: new Date().toISOString(),
    meta: {
      saltHex: Buffer.from(saltBuf).toString("hex"),
      passGuard: guardHex,
      kms: "secretbox+scrypt",
      kdf: { name: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 },
    },
    tables: {} as Record<string, any[]>,
  };

  for (const t of TABLES) {
    const rows = await d.query(`SELECT * FROM "${schema}"."${t}";`);
    dump.tables[t] = rows;
  }
  await d.destroy();

  const json = Buffer.from(JSON.stringify(dump));
  const gz = await gzip(json);

  // criptare cu AES-256-GCM; cheie derivată din exportPass
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
  const outPath =
    outArg ||
    path.join(
      outDir,
      `backup_${slug(profile)}_${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.wallet.json`
    );
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Backup salvat: ${outPath}`);
}

main().catch((e) => {
  console.error("❌ Backup failed:", e?.message || e);
  process.exit(1);
});
