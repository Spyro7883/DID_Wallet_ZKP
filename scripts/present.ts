import { readFileSync, writeFileSync, existsSync } from "node:fs";

const VERIFIER = process.env.VERIFIER || "http://localhost:5501";
const PAYLOAD_PATH = process.argv[2] || "access_payload.json";

(async () => {
  if (!existsSync(PAYLOAD_PATH)) {
    console.error(`No payload found: ${PAYLOAD_PATH}`);
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf8"));
  console.log(`Send payload at ${VERIFIER}/present...\n`);

  const res = await fetch(`${VERIFIER}/present`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log("Answer server:\n", text);

  if (res.ok) {
    try {
      const data = JSON.parse(text);
      if (data.token) {
        writeFileSync("token.txt", data.token, "utf8");
        console.log(`\n Token has been saved in token.txt (exp ${data.exp})`);
      } else {
        console.warn("Server has not returned a token");
      }
    } catch {
      console.warn("Answer was not a valid JSON");
    }
  } else {
    console.error("Verification has failed.");
  }
})();
