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
} from "@veramo/data-store";
import { Entities } from "@veramo/data-store";
import { DataSource } from "typeorm";
import { Resolver } from "did-resolver";
import { getResolver as ethrDidResolver } from "ethr-did-resolver";
import { getDidKeyResolver as keyDidResolver } from "@veramo/did-provider-key";
import * as dotenv from "dotenv";
import "reflect-metadata";

dotenv.config();

export type TAgent = ReturnType<typeof createAgent>;

export async function getDbConnection(): Promise<DataSource> {
  const dbConnection = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.POSTGRESQL_USER,
    password: process.env.POSTGRESQL_PASS,
    database: process.env.POSTGRESQL_DB,
    synchronize: false,
    migrations: [],
    logging: ["error", "warn"],
    entities: Entities,
  });

  if (!dbConnection.isInitialized) {
    await dbConnection.initialize();
    await dbConnection.synchronize();
  }

  return dbConnection;
}

export async function setupAgent(): Promise<TAgent> {
  const dbConnection = await getDbConnection();

  const SECRET_KEY = process.env.DB_ENCRYPTION_KEY;

  const alchemyApiKey = process.env.ALCHEMY_API_KEY || "your-alchemy-api-key";
  const alchemyRpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`;

  const resolver = new Resolver({
    ...ethrDidResolver({
      networks: [
        {
          name: "sepolia",
          rpcUrl: alchemyRpcUrl,
        },
      ],
    }),
    ...keyDidResolver(),
  });

  const agent = createAgent({
    plugins: [
      new KeyManager({
        store: new KeyStore(dbConnection),
        kms: {
          local: new KeyManagementSystem(
            new PrivateKeyStore(dbConnection, new SecretBox(SECRET_KEY!))
          ),
        },
      }),
      new DIDManager({
        store: new DIDStore(dbConnection),
        defaultProvider: "did:key",
        providers: {
          "did:ethr": new EthrDIDProvider({
            defaultKms: "local",
            network: "sepolia",
            rpcUrl: alchemyRpcUrl,
          }),
          "did:key": new KeyDIDProvider({
            defaultKms: "local",
          }),
        },
      }),
      new DIDResolverPlugin({
        resolver,
      }),
      new CredentialPlugin(),
      new DataStore(dbConnection),
      new DataStoreORM(dbConnection),
    ],
  });

  return agent;
}
