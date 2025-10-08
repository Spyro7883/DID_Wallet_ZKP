// scripts/nonce.ts
import crypto from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// contextId = obligatoriu pentru circuit
const contextId = process.env.CONTEXT_ID || crypto.randomInt(1, 1000000);

// nonce = opțional, pentru securitate extra VP JWT
const includeNonce = process.env.INCLUDE_NONCE === "true";
const nonce = includeNonce
  ? "0x" + crypto.randomBytes(16).toString("hex")
  : undefined;

const challenge: any = {
  contextId,
  timestamp: new Date().toISOString(),
  exp: Math.floor(Date.now() / 1000) + 600, // TTL 10 min
};

if (nonce) {
  challenge.nonce = nonce;
}

// Asigură-te că directorul rest/ există
const outputPath = "rest/challenge.json";
const dir = dirname(outputPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

writeFileSync(outputPath, JSON.stringify(challenge, null, 2), "utf8");

console.log(`✅ challenge.json saved`);
console.log(`📍 Locație: ${outputPath}`);
console.log(`   contextId: ${contextId} (obligatoriu pentru circuit)`);
if (nonce) {
  console.log(`   nonce: ${nonce} (securitate extra pentru VP)`);
} else {
  console.log(`   nonce: nu este inclus`);
}
console.log(`⏰ Expiră la: ${new Date(challenge.exp * 1000).toISOString()}`);
console.log(
  `\n💡 Folosește contextId când generezi input-ul pentru circuit:\n   CONTEXT_ID=${contextId} CIRCUIT=aggregate npm run zk:input`
);
console.log(
  `\n💡 Pentru a include și nonce:\n   INCLUDE_NONCE=true npm run nonce`
);
