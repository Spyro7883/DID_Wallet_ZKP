import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetch } from "undici";

const VERIFIER = process.env.VERIFIER ?? "http://localhost:5501";
const INPUT = process.argv[2] ?? "access_payload.json";

function readJSON<T = any>(p: string): T {
  const abs = resolve(p);
  if (!existsSync(abs)) throw new Error(`Missing file: ${abs}`);
  return JSON.parse(readFileSync(abs, "utf8"));
}

async function main() {
  console.log(`→ Loading payload from ${INPUT}`);
  const payload = readJSON(INPUT);

  console.log(`→ Posting to ${VERIFIER}/present ...`);
  const r = await fetch(`${VERIFIER}/present`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!r.ok) {
    console.error("❌ Present failed:", body);
    process.exit(2);
  }

  if (!body?.token) {
    console.error("❌ No token returned:", body);
    process.exit(3);
  }

  writeFileSync("token.txt", body.token, "utf8");
  console.log("✅ Access token saved to token.txt");
  if (body.exp) console.log("ℹ️  exp:", body.exp);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
