import "dotenv/config";
import { WebSocketProvider, Contract, keccak256, toUtf8Bytes } from "ethers";
import { SIGNALS_ABI } from "./signals-abi.ts";
import { readFile, writeFile } from "fs/promises";
import { spawn } from "child_process";

const WSS = process.env.ALCHEMY_WSS!;
const ADDR = process.env.SIGNALS_ADDR!;
const DID = process.env.HOLDER_DID!;
const SALT = process.env.SALT!;
const BASE = process.env.SERVER_BASE || "http://localhost:5501";

function run(cmd: string, args: string[], env?: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env },
    });
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))
    );
  });
}

async function buildAndPresent(context: any) {
  const extra = `--contextId ${context.contextId} --cit ${context.expectedCitizenship} --L ${context.L} --U ${context.U}`;
  await run("npm", ["run", "zk:input"], { EXTRA_ARGS: extra });

  await run("npm", ["run", "zk:prove"]);

  const vp = JSON.parse(await readFile("rest/vp_demo.json", "utf8"));
  const proof = JSON.parse(
    await readFile("build/aggregate/proof.json", "utf8")
  );
  const publicSignals = JSON.parse(
    await readFile("build/aggregate/public.json", "utf8")
  );

  const ctxIdDec = BigInt(context.contextId).toString();
  const payload = { vp, contextId: ctxIdDec, zk: { proof, publicSignals } };
  const resp = await fetch(`${BASE}/present`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

  console.log("📨 present ->", resp);
  if (resp?.token) {
    await writeFile("rest/token.txt", resp.token);
    console.log("🔑 token saved in rest/token.txt");
  }
}

const saltBytes = Buffer.from(SALT.replace(/^0x/, ""), "hex");

function computeCommit(challengeHash: string) {
  return keccak256(
    new Uint8Array([
      ...toUtf8Bytes(DID),
      ...saltBytes,
      ...toUtf8Bytes(challengeHash),
    ])
  );
}

console.log("👂 Watching PresentationRequested for DID =", DID);

(async () => {
  const p = new WebSocketProvider(WSS);
  const c = new Contract(ADDR, SIGNALS_ABI, p);

  c.on(
    "PresentationRequested",
    async (requestId, verifier, toCommit, challengeHash) => {
      const expectedCommit = computeCommit(String(challengeHash));

      if (String(toCommit).toLowerCase() !== expectedCommit.toLowerCase()) {
        return;
      }

      console.log("\n🎯 Request for me:", {
        requestId,
        verifier,
        challengeHash,
        toCommit,
      });

      let claimed: any;
      for (let i = 0; i < 10; i++) {
        claimed = await fetch(`${BASE}/requests/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeHash, did: DID, salt: SALT }),
        }).then((r) => r.json());
        if (claimed?.ok) break;
        if (claimed?.error !== "unknown_request") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!claimed?.ok) {
        console.log("claim failed:", claimed);
        return;
      }

      const { context } = claimed;
      console.log("✅ Got context:", context);

      try {
        await buildAndPresent(context);
      } catch (e: any) {
        console.error("auto-present failed:", e?.message || e);
      }
    }
  );
})();
