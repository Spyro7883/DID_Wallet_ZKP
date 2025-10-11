import { readFileSync, existsSync } from "node:fs";

const VERIFIER = process.env.VERIFIER || "http://localhost:5501";
const PATH = process.argv[2] || "/secret";

(async () => {
  if (!existsSync("token.txt")) {
    console.error("No token, run present first.");
    process.exit(1);
  }
  const token = readFileSync("token.txt", "utf8").trim();
  const r = await fetch(`${VERIFIER}${PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  console.log(text);
})();
