import crypto from "node:crypto";

function getNonce(bytes = 16): string {
  return "0x" + crypto.randomBytes(bytes).toString("hex");
}

const nonce = getNonce();
console.log("✅ Nonce generated:", nonce);
