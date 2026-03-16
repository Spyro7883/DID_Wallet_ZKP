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
import { DataSource, type DataSourceOptions } from "typeorm";
import { Resolver } from "did-resolver";
import { getResolver as ethrDidResolver } from "ethr-did-resolver";
import { getDidKeyResolver as keyDidResolver } from "@veramo/did-provider-key";
import * as dotenv from "dotenv";
import { randomBytes, scryptSync, createHmac } from "crypto";
import "reflect-metadata";

dotenv.config();

export type TAgent = ReturnType<typeof createAgent>;

export type SetupAgentResult = {
  agent: TAgent;
  dataSource: DataSource;
};

export class WrongPassphraseError extends Error {
  code = "WRONG_PASSPHRASE";
  constructor(profile: string) {
    super(`Wrong password for the wallet "${profile}".`);
  }
}

const slug = (p: string) =>
  (p || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

const schemaFor = (profile: string) => `wallet_${slug(profile)}`;
const deriveSecret = (pw: string, salt: Buffer) => scryptSync(pw, salt, 32);
const guardOf = (dk: Buffer) =>
  createHmac("sha256", dk).update("kms-guard-v1").digest("hex");

function pgBaseOptions(
  extra: Partial<DataSourceOptions> = {},
): DataSourceOptions {
  const useSsl = String(process.env.DB_SSL || "").toLowerCase() === "true";

  return {
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.POSTGRESQL_USER,
    password: process.env.POSTGRESQL_PASS,
    database: process.env.POSTGRESQL_DB,
    logging: ["error", "warn"],
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    ...extra,
  } as DataSourceOptions;
}

async function dsAdmin(): Promise<DataSource> {
  const ds = new DataSource(pgBaseOptions());
  if (!ds.isInitialized) await ds.initialize();
  return ds;
}

async function ensureRegistry(ds: DataSource) {
  await ds.query(`
    CREATE TABLE IF NOT EXISTS public.wallet_registry(
      profile_slug TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function listWalletProfiles(): Promise<string[]> {
  const ds = await dsAdmin();
  try {
    await ensureRegistry(ds);
    const rows = await ds.query(
      `SELECT profile_slug FROM public.wallet_registry ORDER BY profile_slug ASC;`,
    );
    return rows.map((r: any) => r.profile_slug as string);
  } finally {
    await ds.destroy();
  }
}

async function ensureSchema(schema: string) {
  const admin = await dsAdmin();
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    await admin.destroy();
  }
}

async function dsForProfile(schema: string): Promise<DataSource> {
  const ds = new DataSource(
    pgBaseOptions({
      schema,
      entities: Entities as any,
      synchronize: false,
    }),
  );

  if (!ds.isInitialized) {
    await ds.initialize();
  }

  return ds;
}

async function ensureWalletMeta(ds: DataSource, schema: string) {
  await ds.query(`
    CREATE TABLE IF NOT EXISTS "${schema}".wallet_meta (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE,
      salt BYTEA NOT NULL,
      pass_guard TEXT
    );
  `);

  await ds.query(
    `ALTER TABLE "${schema}".wallet_meta ADD COLUMN IF NOT EXISTS pass_guard TEXT;`,
  );
}

export async function ensureWalletSchemaTables(schema: string) {
  const d = new DataSource(
    pgBaseOptions({
      schema,
      entities: Entities as any,
      synchronize: false,
    }),
  );

  if (!d.isInitialized) {
    await d.initialize();
  }

  try {
    const rows = await d.query(
      `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name = 'identifier'
      LIMIT 1
      `,
      [schema],
    );

    if (!rows.length) {
      await d.synchronize();
    }
  } finally {
    await d.destroy();
  }
}

export async function setupAgent(
  profileRaw: string,
  passphrase: string,
): Promise<SetupAgentResult> {
  const profile = slug(profileRaw);
  const schema = schemaFor(profile);

  const reg = await dsAdmin();
  try {
    await ensureRegistry(reg);
    await reg.query(
      `INSERT INTO public.wallet_registry(profile_slug) VALUES ($1) ON CONFLICT DO NOTHING;`,
      [profile],
    );
  } finally {
    await reg.destroy();
  }

  await ensureSchema(schema);
  await ensureWalletSchemaTables(schema);

  const ds = await dsForProfile(schema);

  try {
    await ensureWalletMeta(ds, schema);

    let row = (
      await ds.query(
        `SELECT salt, pass_guard FROM "${schema}".wallet_meta LIMIT 1;`,
      )
    )?.[0];

    if (!row) {
      const salt = randomBytes(16);
      const guard = guardOf(deriveSecret(passphrase, salt));

      await ds.query(
        `INSERT INTO "${schema}".wallet_meta (id, salt, pass_guard)
         VALUES (TRUE, $1, $2)
         ON CONFLICT (id) DO UPDATE SET salt=EXCLUDED.salt, pass_guard=EXCLUDED.pass_guard;`,
        [salt, guard],
      );

      row = { salt, pass_guard: guard };
    } else {
      const salt: Buffer = Buffer.from(row.salt);
      const g = guardOf(deriveSecret(passphrase, salt));

      if (!row.pass_guard) {
        await ds.query(
          `UPDATE "${schema}".wallet_meta SET pass_guard=$1 WHERE id=TRUE;`,
          [g],
        );
      } else if (row.pass_guard !== g) {
        throw new WrongPassphraseError(profile);
      }
    }

    const secret = deriveSecret(passphrase, Buffer.from(row.salt));
    const secretKeyHex = Buffer.from(secret).toString("hex");

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
              new PrivateKeyStore(ds, new SecretBox(secretKeyHex)),
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

    return { agent, dataSource: ds };
  } catch (e) {
    if (ds.isInitialized) {
      await ds.destroy().catch(() => {});
    }
    throw e;
  }
}
