import { DataSource } from "typeorm";
import { createInterface } from "readline";
import * as fs from "fs/promises";
import * as path from "path";
import { setupAgent, type TAgent, listWalletProfiles } from "./agent.ts";
import type { IIdentifier } from "@veramo/core";

let PROFILE = "";
let REST_DIR = "";
let SESSION_PASS = "";

function getArg(name: string) {
  const i = process.argv.findIndex(
    (a) => a === name || a.startsWith(name + "=")
  );
  if (i === -1) return null;
  return process.argv[i].includes("=")
    ? process.argv[i].split("=")[1]
    : process.argv[i + 1];
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

async function getPassphraseFromUser(): Promise<string> {
  const stdinPw = await getPassphraseFromStdinIfFlag();
  const passphrase = stdinPw ?? (await promptHidden("Wallet pass: "));
  if (!passphrase) {
    console.error("Empty pass.");
    process.exit(1);
  }
  return passphrase;
}

const slug = (p: string) =>
  (p || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

const schemaFor = (profile: string) => `wallet_${slug(profile)}`;

async function ds(schema?: string): Promise<DataSource> {
  const d = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.POSTGRESQL_USER,
    password: process.env.POSTGRESQL_PASS,
    database: process.env.POSTGRESQL_DB,
    schema,
    synchronize: false,
    logging: ["warn", "error"],
  } as any);
  if (!d.isInitialized) await d.initialize();
  return d;
}

async function ensureSchema(schema: string) {
  const d = await ds();
  try {
    await d.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    await d.destroy();
  }
}

async function chooseProfile(): Promise<string> {
  while (true) {
    const existing = await listWalletProfiles();
    console.log("\nLocal institution wallets:");
    if (existing.length === 0) console.log("  (none)");
    existing.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log(`  ${existing.length + 1}. + Create a new wallet`);

    const pickRaw = await promptUser("\nChoose #: ");
    const pick = Number(pickRaw);

    if (!Number.isNaN(pick) && pick >= 1 && pick <= existing.length) {
      return existing[pick - 1];
    }

    if (pick === existing.length + 1) {
      const alias = (await promptUser("Name new wallet: ")).trim();
      const sl = slug(alias);
      if (!sl) {
        console.log("❌ Invalid name.");
        continue;
      }
      if (existing.includes(sl)) {
        console.log("❌ Name already used. Choose another.");
        continue;
      }
      return alias;
    }

    console.log("Invalid option.");
  }
}

async function listDIDs(agent: TAgent): Promise<void> {
  console.log("\n DIDs available for institution:");
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
  console.log("\n Create new DID for institution");
  console.log("═".repeat(80));
  const providerChoice = await promptUser("Provider (1=did:key, 2=did:ethr): ");
  const provider = providerChoice === "2" ? "did:ethr" : "did:key";
  const alias = await promptUser(
    "Alias (optional, Enter for auto-generation): "
  );
  try {
    const identifier = await agent.didManagerCreate({
      alias: alias || `institution-${Date.now()}`,
      provider,
      kms: "local",
    });
    console.log("\n DID created successfully!");
    console.log(
      ` DID: ${identifier.did}\n Alias: ${identifier.alias}\n Keys: ${identifier.keys.length}`
    );
  } catch (e: any) {
    console.error("\n Error creating DID:", e?.message || e);
  }
}

async function exportDID(agent: TAgent): Promise<void> {
  const ids = await agent.didManagerFind();
  if (ids.length === 0)
    return console.log("\n There are no DIDs to export for institution.");
  await listDIDs(agent);
  const index = await promptUser("\nChoose DID number to export: ");
  const selected = ids[parseInt(index) - 1];
  if (!selected) return console.log(" Wrong option!");
  const filename = `did_${selected.alias || "institution"}_${Date.now()}.json`;
  const filepath = path.join(REST_DIR, filename);
  await fs.mkdir(REST_DIR, { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(selected, null, 2));
  console.log(`\n DID exported at: ${filepath}`);
}

type VerificationLogInput = {
  kind: "vc" | "vp";
  ref: string;
  subjectDid: string | null;
  holderDid: string | null;
  issuerDid: string | null;
  ok: boolean;
  policy?: string | null;
};

async function ensureVerificationLogTable(schema: string) {
  const d = await ds();
  try {
    await d.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".verification_log (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL, -- 'vc' | 'vp'
        ref TEXT,
        subject_did TEXT,
        holder_did TEXT,
        issuer_did TEXT,
        ok BOOLEAN NOT NULL,
        policy TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } finally {
    await d.destroy();
  }
}

async function logVerification(schema: string, v: VerificationLogInput) {
  const d = await ds(schema);
  try {
    await d.query(
      `INSERT INTO "${schema}".verification_log
       (kind, ref, subject_did, holder_did, issuer_did, ok, policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7);`,
      [
        v.kind,
        v.ref,
        v.subjectDid,
        v.holderDid,
        v.issuerDid,
        v.ok,
        v.policy || null,
      ]
    );
  } finally {
    await d.destroy();
  }
}

async function listRecentVerifications(schema: string): Promise<void> {
  const d = await ds(schema);
  try {
    const rows = await d.query(
      `SELECT id, created_at, kind, ref, subject_did, holder_did, issuer_did, ok, policy
       FROM "${schema}".verification_log
       ORDER BY created_at DESC
       LIMIT 20;`
    );
    console.log("\n🧾 Recent verifications:");
    console.log("═".repeat(80));
    if (rows.length === 0) {
      console.log("  (none)");
      return;
    }
    for (const r of rows) {
      console.log(
        `#${r.id} [${String(r.kind).toUpperCase()}] ${r.ok ? "✅" : "❌"} ${
          r.created_at
        }`
      );
      if (r.subject_did) console.log(`   subject: ${r.subject_did}`);
      if (r.holder_did) console.log(`   holder : ${r.holder_did}`);
      if (r.issuer_did) console.log(`   issuer : ${r.issuer_did}`);
      if (r.policy) console.log(`   policy : ${r.policy}`);
      if (r.ref) console.log(`   ref    : ${r.ref}`);
    }
  } finally {
    await d.destroy();
  }
}

async function searchBySubjectDid(schema: string): Promise<void> {
  const did = await promptUser("Subject DID: ");
  if (!did) return;

  const d = await ds(schema);
  try {
    const rows = await d.query(
      `SELECT id, created_at, kind, ok, policy, holder_did, issuer_did, ref
       FROM "${schema}".verification_log
       WHERE subject_did = $1
       ORDER BY created_at DESC;`,
      [did]
    );
    console.log(`\n🔍 Verifications for subject: ${did}`);
    console.log("═".repeat(80));
    if (rows.length === 0) {
      console.log("  (none)");
      return;
    }
    for (const r of rows) {
      console.log(
        `#${r.id} [${String(r.kind).toUpperCase()}] ${r.ok ? "✅" : "❌"} ${
          r.created_at
        }`
      );
      if (r.policy) console.log(`   policy: ${r.policy}`);
      if (r.holder_did) console.log(`   holder: ${r.holder_did}`);
      if (r.issuer_did) console.log(`   issuer: ${r.issuer_did}`);
      if (r.ref) console.log(`   ref   : ${r.ref}`);
    }
  } finally {
    await d.destroy();
  }
}

async function readJsonFilePrompt(label: string): Promise<any | null> {
  const filePath = await promptUser(label);
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e: any) {
    console.error("❌ Cannot read/parse JSON:", e?.message || e);
    return null;
  }
}

async function verifyVCFromFile(agent: TAgent, schema: string): Promise<void> {
  console.log("\n🔎 Verify Verifiable Credential from file");
  console.log("═".repeat(80));

  const vc = await readJsonFilePrompt("VC JSON path: ");
  if (!vc) return;

  try {
    const result = await agent.verifyCredential({ credential: vc as any });
    const ok = result.verified === true;

    const issuer =
      typeof vc.issuer === "string" ? vc.issuer : vc.issuer?.id || "";
    const subject = vc.credentialSubject?.id || "";

    console.log("\nResult:", ok ? "✅ VALID" : "❌ INVALID");
    if (!ok && (result as any).error)
      console.log("Error:", (result as any).error);

    const policy = await promptUser(
      "Policy/context label (ex: 'access_service_a', Enter for none): "
    );

    await logVerification(schema, {
      kind: "vc",
      ref: vc.id || "(no-id)",
      subjectDid: subject || null,
      holderDid: null,
      issuerDid: issuer || null,
      ok,
      policy: policy || null,
    });
  } catch (e: any) {
    console.error("❌ Verification error:", e?.message || e);
  }
}

async function verifyVPFromFile(agent: TAgent, schema: string): Promise<void> {
  console.log("\n🔎 Verify Verifiable Presentation from file");
  console.log("═".repeat(80));

  const vp = await readJsonFilePrompt("VP JSON path: ");
  if (!vp) return;

  try {
    const result = await agent.verifyPresentation({
      presentation: vp as any,
    });
    const ok = result.verified === true;

    const holder = vp.holder || "";
    let subject = "";
    let issuer = "";
    const creds = Array.isArray(vp.verifiableCredential)
      ? vp.verifiableCredential
      : [];
    if (creds[0]) {
      const c = creds[0];
      subject = c.credentialSubject?.id || "";
      issuer = typeof c.issuer === "string" ? c.issuer : c.issuer?.id || "";
    }

    console.log("\nResult:", ok ? "✅ VALID" : "❌ INVALID");
    if (!ok && (result as any).error)
      console.log("Error:", (result as any).error);

    const policy = await promptUser(
      "Policy/context label (ex: 'office_entry', Enter for none): "
    );

    await logVerification(schema, {
      kind: "vp",
      ref: vp.id || "(no-id)",
      subjectDid: subject || null,
      holderDid: holder || null,
      issuerDid: issuer || null,
      ok,
      policy: policy || null,
    });
  } catch (e: any) {
    console.error("❌ Verification error:", e?.message || e);
  }
}

async function showAdminMenu(): Promise<void> {
  console.clear();
  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║           🏛️  INSTITUTION ADMIN - VC/VP Verifier            ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );
  console.log("\n📍 DIDs (institution):");
  console.log("  1. 📋 List DIDs");
  console.log("  2. ➕ Create new DID");
  console.log("  3. 📤 Export DID");
  console.log("\n✅ Verification:");
  console.log("  4. 🔎 Verify VC from file");
  console.log("  5. 🔎 Verify VP from file");
  console.log("\n📊 Logs & Search:");
  console.log("  6. 🧾 List recent verifications");
  console.log("  7. 🔍 Search verifications by subject DID");
  console.log("\n❌ 0. Exit");
  console.log(
    "════════════════════════════════════════════════════════════════"
  );
}

async function initInstitutionAgent(): Promise<TAgent> {
  console.log("Initialize Institution Veramo Agent...");
  const arg = getArg("--profile");
  PROFILE = arg || (await chooseProfile());
  if (!PROFILE) {
    console.error("Invalid profile.");
    process.exit(1);
  }

  SESSION_PASS = await getPassphraseFromUser();

  REST_DIR = path.join("rest", PROFILE);
  await fs.mkdir(REST_DIR, { recursive: true });

  const agent = await setupAgent(PROFILE, SESSION_PASS);
  console.log(`✅ Institution wallet ready for "${PROFILE}"\n`);
  return agent;
}

async function main(): Promise<void> {
  try {
    const agent = await initInstitutionAgent();
    const schema = schemaFor(PROFILE);

    await ensureSchema(schema);
    await ensureVerificationLogTable(schema);

    let running = true;
    while (running) {
      await showAdminMenu();
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
          await verifyVCFromFile(agent, schema);
          break;
        case "5":
          await verifyVPFromFile(agent, schema);
          break;
        case "6":
          await listRecentVerifications(schema);
          break;
        case "7":
          await searchBySubjectDid(schema);
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
    console.error("\n Error:", error?.message || error);
    console.error(error?.stack);
    process.exit(1);
  }
}

main();
