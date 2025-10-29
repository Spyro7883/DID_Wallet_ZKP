// scripts/access.ts
import { readFileSync, existsSync } from "node:fs";

const VERIFIER = process.env.VERIFIER ?? "http://localhost:5501";
const PATH = process.argv[2] ?? "/secret";
const TOKEN_PATH = process.env.TOKEN_PATH ?? "rest/token.txt";

(async () => {
  try {
    if (!existsSync(TOKEN_PATH)) {
      console.error(`No token at ${TOKEN_PATH}. Run present first.`);
      process.exit(1);
    }
    const token = readFileSync(TOKEN_PATH, "utf8").trim();

    const r = await fetch(`${VERIFIER}${PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await r.text();
    if (!r.ok) {
      console.error(`HTTP ${r.status}: ${body}`);
      process.exit(1);
    }
    console.log(body);
  } catch (e) {
    console.error("Call failed:", e);
    process.exit(1);
  }
})();
