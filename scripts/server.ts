import express from "express";
import crypto from "crypto";
const app = express(),
  PORT = 5501;
app.use(express.json());

const validTokens = new Set<string>();
const same = (a: any, b: any) => String(a) === String(b);
const isPack = (x: any) => x?.proof && typeof x.publicSignals === "object";

app.post("/present", (req, res) => {
  console.log(
    "📩 Payload received at /present:",
    JSON.stringify(req.body, null, 2)
  );

  try {
    const { vp, audience, nonce, zk } = req.body || {};
    if (!audience || !nonce) throw "audience/nonce lipsesc";
    if (![zk?.age, zk?.citizenship, zk?.income].every(isPack))
      throw "zk.age/zk.citizenship/zk.income are missing or have a wrong format";

    const packs = [zk.age, zk.citizenship, zk.income];
    for (const p of packs) {
      if (!same(p.publicSignals.audience, audience)) throw "audience mismatch";
      if (!same(p.publicSignals.nonce, nonce)) throw "nonce mismatch";
    }

    for (const k of ["nullifier", "privHash"])
      if (
        !packs.every(
          (p) =>
            String(p.publicSignals[k] ?? packs[0].publicSignals[k]) ===
            String(packs[0].publicSignals[k])
        )
      )
        throw `${k} mismatch`;

    const token = "tk_" + crypto.randomBytes(16).toString("hex");
    validTokens.add(token);

    console.log(`✅ Valid payload. Emitted token: ${token}`);
    res.json({ token, exp: Date.now() / 1000 + 600, status: "verified" });
  } catch (e: any) {
    console.error("❌ Error at payload processing:", e);
    res.status(400).json({ error: String(e) });
  }
});

app.get("/secret", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token || !validTokens.has(token))
    return res.status(401).json({ error: "Invalid/expired token" });
  res.json({ message: "✅ Access granted" });
});

app.listen(PORT, () => console.log(`Verifier on http://localhost:${PORT}`));
