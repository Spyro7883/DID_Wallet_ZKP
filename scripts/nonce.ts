import crypto from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const contextId = process.env.CONTEXT_ID || crypto.randomInt(1, 1000000);

const includeNonce = process.env.INCLUDE_NONCE === "true";
const nonce = includeNonce
  ? "0x" + crypto.randomBytes(16).toString("hex")
  : undefined;

const challenge: any = {
  contextId,
  timestamp: new Date().toISOString(),
  exp: Math.floor(Date.now() / 1000) + 600,
};

if (nonce) {
  challenge.nonce = nonce;
}

const outputPath = "rest/challenge.json";
const dir = dirname(outputPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

writeFileSync(outputPath, JSON.stringify(challenge, null, 2), "utf8");

console.log(`challenge.json saved`);
console.log(`Location: ${outputPath}`);
console.log(`   contextId: ${contextId} (mandatory for circuit)`);
if (nonce) {
  console.log(`   nonce: ${nonce} (extra security for VP)`);
} else {
  console.log(`   nonce: is not included`);
}
console.log(`Expires at: ${new Date(challenge.exp * 1000).toISOString()}`);
console.log(
  `\n Use contextId when generating input for circuit:\n   CONTEXT_ID=${contextId} CIRCUIT=aggregate npm run zk:input`
);
console.log(`\n For including nonce:\n   INCLUDE_NONCE=true npm run nonce`);
