import { createAgent } from "@veramo/core";
import { DIDManager } from "@veramo/did-manager";
import { EthrDIDProvider } from "@veramo/did-provider-ethr";
import { KeyDIDProvider } from "@veramo/did-provider-key";
import { DIDResolverPlugin } from "@veramo/did-resolver";
import { KeyManager } from "@veramo/key-manager";
import { KeyManagementSystem, SecretBox } from "@veramo/kms-local";
import { CredentialPlugin } from "@veramo/credential-w3c";
import {
  DataStore,
  DataStoreORM,
  DIDStore,
  KeyStore,
  PrivateKeyStore,
  Entities,
} from "@veramo/data-store";
import { DataSource } from "typeorm";
import { Resolver } from "did-resolver";
import { getResolver as ethrDidResolver } from "ethr-did-resolver";
import { getDidKeyResolver as keyDidResolver } from "@veramo/did-provider-key";
import * as dotenv from "dotenv";
import { randomBytes, scryptSync, createHmac } from "crypto";
import "reflect-metadata";

dotenv.config();

export type TAgent = ReturnType<typeof createAgent>;
type SetupIntent = "auto" | "signup" | "login";

// ── utils ──────────────────────────────────────────────────────────────────────
function slugifyProfile(p: string) {
  return (p || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function tablePrefixFor(profile: string) {
  return `w_${slugifyProfile(profile)}_`;
}
function deriveSecret(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase, salt, 32); // 32B pentru SecretBox
}
function computeGuard(derivedKey: Buffer) {
  return createHmac("sha256", derivedKey).update("kms-guard-v1").digest("hex");
}

async function connectDB(
  entityPrefix?: string,
  doSync = false
): Promise<DataSource> {
  const ds = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.POSTGRESQL_USER,
    password: process.env.POSTGRESQL_PASS,
    database: process.env.POSTGRESQL_DB,
    entities: Entities, // nu se creează dacă synchronize=false
    entityPrefix,
    synchronize: false,
    logging: ["error", "warn"],
  });
  if (!ds.isInitialized) {
    await ds.initialize();
    if (doSync) await ds.synchronize();
  }
  return ds;
}

async function ensureGlobalRegistry(ds: DataSource) {
  await ds.query(`
    CREATE TABLE IF NOT EXISTS wallet_registry (
      profile_slug TEXT PRIMARY KEY,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function ensureWalletMeta(ds: DataSource, prefix: string) {
  await ds.query(`
    CREATE TABLE IF NOT EXISTS ${prefix}wallet_meta (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE,
      salt BYTEA NOT NULL,
      pass_guard TEXT
    );
  `);
  await ds.query(
    `ALTER TABLE ${prefix}wallet_meta ADD COLUMN IF NOT EXISTS pass_guard TEXT;`
  );
}

// ── public API ─────────────────────────────────────────────────────────────────
export async function setupAgent(
  profileRaw: string,
  passphrase: string,
  opts: { intent?: SetupIntent } = {}
): Promise<TAgent> {
  const profile = slugifyProfile(profileRaw);
  const intent = opts.intent ?? "auto";

  // 1) registru global (fără prefix)
  const reg = await connectDB(undefined, false);
  await ensureGlobalRegistry(reg);

  const exists =
    (
      await reg.query(
        `SELECT 1 FROM wallet_registry WHERE profile_slug=$1 LIMIT 1;`,
        [profile]
      )
    ).length > 0;

  if (intent === "signup" && exists)
    throw new Error(`Profile "${profile}" already exists.`);
  if (intent === "login" && !exists)
    throw new Error(`Profile "${profile}" does not exist.`);
  if (!exists) {
    await reg.query(
      `INSERT INTO wallet_registry (profile_slug) VALUES ($1) ON CONFLICT DO NOTHING;`,
      [profile]
    );
  }

  // 2) wallet DS cu prefix (creează tabelele prefixed)
  const prefix = tablePrefixFor(profile);
  const ds = await connectDB(prefix, true);
  await ensureWalletMeta(ds, prefix);

  // 3) ia salt/guard și validează parola (sau setează la prima inițializare)
  let row = (
    await ds.query(`SELECT salt, pass_guard FROM ${prefix}wallet_meta LIMIT 1;`)
  )?.[0];

  if (!row) {
    if (intent === "login")
      throw new Error(`Profile "${profile}" not initialized yet.`);
    const salt = randomBytes(16);
    const derived = deriveSecret(passphrase, salt);
    const guard = computeGuard(derived);
    await ds.query(
      `INSERT INTO ${prefix}wallet_meta (id, salt, pass_guard)
       VALUES (TRUE, $1, $2)
       ON CONFLICT (id) DO UPDATE SET salt=EXCLUDED.salt, pass_guard=EXCLUDED.pass_guard;`,
      [salt, guard]
    );
    row = { salt, pass_guard: guard };
  } else {
    const salt: Buffer = Buffer.from(row.salt);
    const derived = deriveSecret(passphrase, salt);
    const guard = computeGuard(derived);
    if (!row.pass_guard || row.pass_guard !== guard) {
      throw new Error(`Wrong passphrase for profile "${profile}".`);
    }
  }

  const secretKeyHex = deriveSecret(passphrase, Buffer.from(row.salt)).toString(
    "hex"
  );

  const alchemyApiKey = process.env.ALCHEMY_API_KEY || "your-alchemy-api-key";
  const alchemyRpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`;

  const resolver = new Resolver({
    ...ethrDidResolver({
      networks: [{ name: "sepolia", rpcUrl: alchemyRpcUrl }],
    }),
    ...keyDidResolver(),
  });

  const agent = createAgent({
    plugins: [
      new KeyManager({
        store: new KeyStore(ds),
        kms: {
          local: new KeyManagementSystem(
            new PrivateKeyStore(ds, new SecretBox(secretKeyHex))
          ),
        },
      }),
      new DIDManager({
        store: new DIDStore(ds),
        defaultProvider: "did:key",
        providers: {
          "did:ethr": new EthrDIDProvider({
            defaultKms: "local",
            network: "sepolia",
            rpcUrl: alchemyRpcUrl,
          }),
          "did:key": new KeyDIDProvider({ defaultKms: "local" }),
        },
      }),
      new DIDResolverPlugin({ resolver }),
      new CredentialPlugin(),
      new DataStore(ds),
      new DataStoreORM(ds),
    ],
  });

  return agent;
}
