import { createInterface } from "readline";
import { setupAgent, type TAgent } from "./agent.ts";
import { base64url } from "jose";
import type {
  IIdentifier,
  VerifiableCredential,
  VerifiablePresentation,
} from "@veramo/core";
import * as fs from "fs/promises";
import * as path from "path";

const REST_DIR = "rest";
const CONN_PATH = path.join(REST_DIR, "connections.json");

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

  // alege DID holder
  const ids = await agent.didManagerFind();
  if (ids.length === 0) {
    console.log("Nu ai DID-uri. Creează unul întâi.");
    return;
  }
  ids.forEach((d, i) => console.log(`${i + 1}. ${d.did} (${d.alias || ""})`));
  const idx = Number(await promptUser("Alege DID holder #: ")) - 1;
  const holder = ids[idx];
  if (!holder) return console.log("Selecție invalidă.");

  // alege DID holder (ai deja codul tău)
  const holderDid = holder.did;

  // 1) cere challenge
  const ch = await fetch(`${base}/connect/challenge`).then((r) => r.json());

  // 2) pregătește payload-ul
  const payload = { id: ch.id, challenge: ch.challenge, ts: Date.now() };
  const data = new TextEncoder().encode(JSON.stringify(payload));

  // 3) ia o cheie a DID-ului și semnează
  const holderFull = await agent.didManagerGet({ did: holderDid });
  const key = holderFull.keys[0];
  const algorithm = key.type === "Ed25519" ? "EdDSA" : "ES256K";

  let sig = await agent.keyManagerSign({ keyRef: key.kid, data, algorithm });

  let sigB64u: string;
  if (sig instanceof Uint8Array) {
    sigB64u = base64url.encode(sig); // raw bytes -> b64u
  } else if (typeof sig === "string") {
    if (sig.startsWith("0x")) {
      // hex -> bytes -> b64u
      const bytes = Uint8Array.from(Buffer.from(sig.slice(2), "hex"));
      sigB64u = base64url.encode(bytes);
    } else {
      // e deja base64/base64url; încearcă direct ca base64url
      try {
        base64url.decode(sig); // ok ca b64u
        sigB64u = sig;
      } catch {
        // e base64 clasic -> b64u
        const bytes = Buffer.from(sig, "base64");
        sigB64u = base64url.encode(bytes);
      }
    }
  } else {
    throw new Error("Unknown signature format from keyManagerSign");
  }

  // 4) confirmă pairing-ul
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

  if (!conf?.token) {
    console.log("Pairing eșuat:", conf);
    return;
  }

  if (!conf?.token) return console.log("Pairing eșuat:", conf);

  const conns = await loadConns();
  conns[base] = {
    connectionId: conf.connectionId,
    token: conf.token,
    holderDid: holder.did,
    issuerDid: conf.issuerDid,
  };
  await saveConns(conns);

  console.log(
    `✅ Conectat la ${base}\n   Issuer DID: ${conf.issuerDid}\n   Holder DID: ${holder.did}\n   Token salvat în ${CONN_PATH}`
  );
}

async function requestVC(agent: TAgent): Promise<void> {
  const conns = await loadConns();
  const bases = Object.keys(conns);
  if (bases.length === 0) {
    console.log(
      "Nu ești conectat la niciun issuer. Folosește întâi 'Connect'."
    );
    return;
  }

  bases.forEach((b, i) => console.log(`${i + 1}. ${b}`));
  const bidx = Number(await promptUser("Alege server #: ")) - 1;
  const base = bases[bidx];
  if (!base) return console.log("Selecție invalidă.");
  const { token, holderDid } = conns[base];

  // claims – JSON sau perechi key=value
  console.log(
    '\nIntrodu claims pentru VC (JSON sau perechi key=value). Exemplu: {"age":25,"income":9000,"citizenship":"RO"}'
  );
  const first = await promptUser("Claims: ");
  let claims: any = {};
  if (first.trim().startsWith("{")) {
    claims = JSON.parse(first);
  } else {
    let cur = first;
    while (cur) {
      const [k, v] = cur.split("=");
      if (k && v) claims[k.trim()] = isNaN(Number(v)) ? v.trim() : Number(v);
      cur = await promptUser("Alt claim (key=value) sau Enter: ");
    }
  }

  const type = await promptUser(
    'Type VC (ex: "PersonCredential", Enter pt. none): '
  );
  const validity = await promptUser("Valability (sec, Enter pt. none): ");

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

  if (!resp?.ok || !resp?.vc) {
    console.log("Emitere eșuată:", resp);
    return;
  }

  // salvează VC în wallet (DataStore)
  const saved = await agent.dataStoreSaveVerifiableCredential({
    verifiableCredential: resp.vc,
  });
  console.log(`✅ VC primit și salvat. Hash: ${saved?.hash || "(ok)"}`);
}

function promptUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function listDIDs(agent: TAgent): Promise<void> {
  console.log("\n DIDs available:");
  console.log("═".repeat(80));

  const identifiers = await agent.didManagerFind();

  if (identifiers.length === 0) {
    console.log("There are no DIDs created.");
  } else {
    identifiers.forEach((id: IIdentifier, index: number) => {
      console.log(`\n${index + 1}. 🆔 ${id.did}`);
      console.log(` Provider: ${id.provider}`);
      console.log(` Alias: ${id.alias || "N/A"}`);
      console.log(` Keys: ${id.keys.length}`);
      if (id.keys.length > 0) {
        id.keys.forEach((key, kidx) => {
          console.log(
            `      ${kidx + 1}. Type: ${key.type}, KID: ${key.kid.substring(
              0,
              20
            )}...`
          );
        });
      }
    });
  }
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
    console.log("\n Start DID creation ");

    const identifier = await agent.didManagerCreate({
      alias: alias || `citizen-${Date.now()}`,
      provider: provider,
      kms: "local",
    });

    console.log("\n DID created with success!");
    console.log(` DID: ${identifier.did}`);
    console.log(` Alias: ${identifier.alias}`);
    console.log(` Keys: ${identifier.keys.length}`);
  } catch (error: any) {
    console.error("\n Error at DID creation:", error.message);
  }
}

async function exportDID(agent: TAgent): Promise<void> {
  const identifiers = await agent.didManagerFind();
  if (identifiers.length === 0) {
    console.log("\n There are no DIDs to export.");
    return;
  }

  console.log("\n Export DID");
  await listDIDs(agent);

  const index = await promptUser("\nChoose DID number to export: ");
  const selectedDID = identifiers[parseInt(index) - 1];

  if (!selectedDID) {
    console.log(" Wrong option!");
    return;
  }

  const filename = `did_${selectedDID.alias || "export"}_${Date.now()}.json`;
  const filepath = path.join("rest", filename);

  await fs.mkdir("rest", { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(selectedDID, null, 2));

  console.log(`\n DID exportat în: ${filepath}`);
}

async function listVCs(agent: TAgent): Promise<void> {
  console.log("\n📜 Verifiable Credentials:");
  console.log("═".repeat(80));

  const credentials = await agent.dataStoreORMGetVerifiableCredentials();

  if (credentials.length === 0) {
    console.log("There are no emitted VCs yet.");
  } else {
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
  }
  console.log("═".repeat(80));
}

async function createVC(agent: TAgent): Promise<void> {
  console.log("\n Create Verifiable Credential");
  console.log("═".repeat(80));

  const identifiers = await agent.didManagerFind();
  if (identifiers.length === 0) {
    console.log("\n U have to create at least one DID!");
    return;
  }

  console.log("\n Available DIDs:");
  identifiers.forEach((id, idx) => {
    console.log(`${idx + 1}. ${id.did} (${id.alias})`);
  });

  const issuerIdx = await promptUser("\nPick number for Issuer DID: ");
  const issuerDID = identifiers[parseInt(issuerIdx) - 1]?.did;

  const subjectIdx = await promptUser("Pick number for Subject DID: ");
  const subjectDID = identifiers[parseInt(subjectIdx) - 1]?.did;

  if (!issuerDID || !subjectDID) {
    console.log("Wrong choice!");
    return;
  }

  console.log("\n Enter claims");

  const claimsInput = await promptUser("Claims: ");

  let claims: any = {};
  if (claimsInput.startsWith("{")) {
    claims = JSON.parse(claimsInput);
  } else {
    let currentClaim = claimsInput;
    while (currentClaim) {
      const [key, value] = currentClaim.split("=");
      if (key && value) {
        claims[key.trim()] = isNaN(Number(value))
          ? value.trim()
          : Number(value);
      }
      currentClaim = await promptUser("Add more claims: ");
    }
  }

  try {
    console.log("\n VC gets created...");

    const issuer = await agent.didManagerGet({ did: issuerDID });
    const vcProofFormat = issuer.provider === "did:ethr" ? "jwt" : "lds";

    const verifiableCredential = await agent.createVerifiableCredential({
      credential: {
        issuer: { id: issuerDID },
        credentialSubject: {
          id: subjectDID,
          ...claims,
        },
        type: ["VerifiableCredential"],
      },
      proofFormat: vcProofFormat,
    });

    console.log("\n VC created with succes!");
    console.log(
      `VC JWT: ${verifiableCredential.proof.jwt?.substring(0, 80)}...`
    );

    const filename = `vc_${Date.now()}.json`;
    const filepath = path.join("rest", filename);
    await fs.mkdir("rest", { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(verifiableCredential, null, 2));
    console.log(`VC saved in: ${filepath}`);
  } catch (error: any) {
    console.error("\n Error at VC creation:", error.message);
  }
}

async function exportVC(agent: TAgent): Promise<void> {
  const credentials = await agent.dataStoreORMGetVerifiableCredentials();
  if (credentials.length === 0) {
    console.log("\n There are no VCs to export.");
    return;
  }

  console.log("\n Export VC");
  await listVCs(agent);

  const index = await promptUser("\nPick VC number to export: ");
  const selectedVC = credentials[parseInt(index) - 1];

  if (!selectedVC) {
    console.log(" Invalid option!");
    return;
  }

  const filename = `vc_${selectedVC.hash.substring(0, 8)}_${Date.now()}.json`;
  const filepath = path.join("rest", filename);

  await fs.mkdir("rest", { recursive: true });
  await fs.writeFile(
    filepath,
    JSON.stringify(selectedVC.verifiableCredential, null, 2)
  );

  console.log(`\n VC exported in: ${filepath}`);
}

async function listVPs(agent: TAgent): Promise<void> {
  console.log("\n Verifiable Presentations:");
  console.log("═".repeat(80));

  const presentations = await agent.dataStoreORMGetVerifiablePresentations();

  if (presentations.length === 0) {
    console.log(" There are no VPs created yet.");
  } else {
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
  }
  console.log("═".repeat(80));
}

async function createVP(agent: TAgent): Promise<void> {
  console.log("\n Create Verifiable Presentation");
  console.log("═".repeat(80));

  const credentials = await agent.dataStoreORMGetVerifiableCredentials();
  if (credentials.length === 0) {
    console.log("\n You have to create at least one VC!");
    return;
  }

  const identifiers = await agent.didManagerFind();
  if (identifiers.length === 0) {
    console.log("\n You have to create at least one DID!");
    return;
  }

  console.log("\n Available DIDs for Holder:");
  identifiers.forEach((id, idx) => {
    console.log(`${idx + 1}. ${id.did} (${id.alias})`);
  });

  const holderIdx = await promptUser("\nChoose number for Holder DID: ");
  const holderDID = identifiers[parseInt(holderIdx) - 1]?.did;

  if (!holderDID) {
    console.log("Invalid option!");
    return;
  }

  console.log("\n Available VCs:");
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

  const vcIndicesInput = await promptUser("\nChoose VC numbers: ");
  const vcIndices = vcIndicesInput
    .split(",")
    .map((s) => parseInt(s.trim()) - 1);

  const selectedVCs = vcIndices
    .map((idx) => credentials[idx])
    .filter((vc) => vc !== undefined)
    .map((vc) => vc.verifiableCredential);

  if (selectedVCs.length === 0) {
    console.log("You've picked no available VC!");
    return;
  }

  try {
    console.log("\n VP gets created...");

    const holder = await agent.didManagerGet({ did: holderDID });
    const vpProofFormat = holder.provider === "did:ethr" ? "jwt" : "lds";

    const verifiablePresentation = await agent.createVerifiablePresentation({
      presentation: {
        holder: holderDID,
        verifiableCredential: selectedVCs,
      },
      proofFormat: vpProofFormat,
    });

    console.log("\n VP created with succes!");
    console.log(`Holder: ${verifiablePresentation.holder}`);
    console.log(`Included Credentials: ${selectedVCs.length}`);

    const filename = `vp_${Date.now()}.json`;
    const filepath = path.join("rest", filename);
    await fs.mkdir("rest", { recursive: true });
    await fs.writeFile(
      filepath,
      JSON.stringify(verifiablePresentation, null, 2)
    );
    console.log(`Saved VP at: ${filepath}`);
  } catch (error: any) {
    console.error("\n Error at VP creation:", error.message);
  }
}

async function exportVP(agent: TAgent): Promise<void> {
  const presentations = await agent.dataStoreORMGetVerifiablePresentations();
  if (presentations.length === 0) {
    console.log("\n There are no VPs to export.");
    return;
  }

  console.log("\n Export VP");
  await listVPs(agent);

  const index = await promptUser(
    "\nPick the number of the VP that will be exported: "
  );
  const selectedVP = presentations[parseInt(index) - 1];

  if (!selectedVP) {
    console.log("Wrong choice!");
    return;
  }

  const filename = `vp_demo.json`;
  const filepath = path.join("rest", filename);

  await fs.mkdir("rest", { recursive: true });
  await fs.writeFile(
    filepath,
    JSON.stringify(selectedVP.verifiablePresentation, null, 2)
  );

  console.log(`\n Exported VP in: ${filepath}`);
}

async function showMenu(): Promise<void> {
  console.clear();
  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║           🏛️  CITIZEN - DID/VC/VP Manager                     ║"
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
  console.log("\n❌ 0. Exit");
  console.log(
    "════════════════════════════════════════════════════════════════"
  );
}

async function main(): Promise<void> {
  console.log("Initialize Veramo Agent...");

  try {
    const agent = await setupAgent();
    console.log("Initialized agent with succes!\n");

    let running = true;

    while (running) {
      await showMenu();
      const choice = await promptUser("\n Pick an option: ");

      switch (choice) {
        case "1":
          await listDIDs(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "2":
          await createDID(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "3":
          await exportDID(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "4":
          await listVCs(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "5":
          await createVC(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "6":
          await exportVC(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "7":
          await listVPs(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "8":
          await createVP(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "9":
          await exportVP(agent);
          await promptUser("\n⏎ Click Enter to continue...");
          break;

        case "10":
          await connectServer(agent);
          await promptUser("\n⏎ Enter pentru a continua...");
          break;
        case "11":
          await requestVC(agent);
          await promptUser("\n⏎ Enter pentru a continua...");
          break;

        case "0":
          console.log("\n Goodbye!");
          running = false;
          break;

        default:
          console.log("\n Wrong option!");
          await promptUser("\n⏎ Click Enter to continue...");
      }
    }

    process.exit(0);
  } catch (error: any) {
    console.error("\n Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
