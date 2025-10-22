import { spawn } from "child_process";

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

const extra =
  (process.env.EXTRA_ARGS || "")
    .trim()
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    ?.map((s) => s.replace(/^"(.+)"$/, "$1")) || [];

(async () => {
  await run("tsx", [
    "scripts/generate_input.ts",
    "aggregate",
    "rest/vp_demo.json",
    ...extra,
  ]);
  await run("node", [
    "build/aggregate/aggregate_js/generate_witness.js",
    "build/aggregate/aggregate_js/aggregate.wasm",
    "build/aggregate/aggregate_js/input.json",
    "build/aggregate/witness.wtns",
  ]);
})();
