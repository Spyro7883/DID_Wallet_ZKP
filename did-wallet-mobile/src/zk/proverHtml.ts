export const PROVER_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1"
    />
    <title>ZK Prover</title>
    <script src="https://cdn.jsdelivr.net/npm/snarkjs@0.7.5/build/snarkjs.min.js"></script>
  </head>
  <body>
    <script>
      function emit(msg) {
        const raw = JSON.stringify(msg);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(raw);
          return;
        }
        console.log(raw);
      }

      async function handleMessage(raw) {
        try {
          const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (!msg || msg.type !== "PROVE") return;

          const id = msg.id;
          const input = msg.input;
          const wasmUrl = msg.wasmUrl;
          const zkeyUrl = msg.zkeyUrl;

          if (!window.snarkjs || !window.snarkjs.groth16) {
            throw new Error("snarkjs_not_loaded");
          }

          const result = await window.snarkjs.groth16.fullProve(
            input,
            wasmUrl,
            zkeyUrl
          );

          emit({
            type: "PROVED",
            id,
            proof: result.proof,
            publicSignals: result.publicSignals,
          });
        } catch (err) {
          emit({
            type: "ERROR",
            id: null,
            error: err && err.message ? err.message : String(err),
          });
        }
      }

      document.addEventListener("message", function (event) {
        handleMessage(event.data);
      });

      window.addEventListener("message", function (event) {
        handleMessage(event.data);
      });

      window.addEventListener("load", function () {
        emit({ type: "READY" });
      });
    </script>
  </body>
</html>
`;
