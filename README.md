# DID Wallet — Zero-Knowledge Verifiable Credentials

A self-sovereign identity (SSI) system where users prove facts about themselves —
**age, citizenship, income range** — **without revealing the underlying data**.
Credentials are issued as W3C Verifiable Credentials, held in a mobile wallet, and
proven with **zero-knowledge proofs verified on-chain**.

> Built as my Bachelor's thesis @ Politehnica Bucharest. Circom + Groth16, Veramo/cheqd
> DIDs, Solidity verifier on Ethereum Sepolia, a React Native wallet, and a Next.js issuer console.

https://github.com/user-attachments/assets/600183ac-76a6-4d31-9c9e-3240330d26c9

**Live on Ethereum Sepolia (verified source):**
[`aggregateVerifier`](https://sepolia.etherscan.io/address/0xE7B5c562C321AE2489e3d43d0A19Fd05694306C9)
· [`VerifiableSignals`](https://sepolia.etherscan.io/address/0xAA4a42719C57F7398d7DF05971139e5218610105)

<sub>
0:00 create wallet &amp; identity · 0:40 request a credential — raw values stay on device ·
1:00 issuer approves, only the Poseidon commitment is stored · 1:30 proof request against the verifier's rules ·
1:40 an out-of-range income trips the circuit's assert · 2:00 the verification record and its public constraints
</sub>

---

## Why it matters

Traditional identity checks over-share: to prove you're over 18, you hand over a full ID
with your name, exact birth date, and address. This wallet flips that — you prove **only
the predicate that's asked** (`age ≥ 18`, `citizenship == RO`, `income ∈ [L, U]`) and
nothing else. The verifier checks a ZK proof on-chain and never sees the raw claim.

## How it works

```
Issuer (admin-panel)                Holder (mobile wallet)               Verifier
─────────────────────               ──────────────────────               ────────
issues a Verifiable         ──▶     stores VC, derives                   requests a proof
Credential (Veramo/cheqd)           Poseidon-committed secrets           of a predicate
                                              │
                                              ▼
                                    generates a ZK proof locally  ──▶     Groth16 verifier
                                    (age / citizenship / income)          on Ethereum Sepolia
                                    — raw data never leaves device        returns valid / invalid
```

A single **aggregate circuit** combines the individual predicates into one proof, so a
verifier can require several conditions at once while the holder submits a single call.

## Components

| Part | Stack | What it does |
|---|---|---|
| **`circuits/`** | circom + snarkjs (Groth16) | `age`, `citizenship`, `incomeRange`, and an `aggregate` circuit that combines them |
| **`contracts/VerifiableSignals.sol`** | Solidity + Hardhat (Ignition) | On-chain Groth16 verifier, deployed & verified on Sepolia |
| **`did-wallet-mobile/`** | React Native (Expo) | Holder wallet: create DID, receive VCs, generate proofs locally, proof history, encrypted backup/restore |
| **`admin-panel/`** | Next.js (App Router) | Issuer/verifier console: issue VCs, manage DIDs, review verification requests, audit log |
| **`agent.yml` + `scripts/`** | Veramo + cheqd + ethers | DID creation, VC issuance/verification, proof generation and on-chain verification |

## Tech highlights

- **Zero-knowledge predicates** with circom + Groth16; Poseidon commitments generated
  on-device so the raw attribute is never exposed.
- **On-chain verification** — proofs are checked by a Solidity verifier on Ethereum Sepolia.
- **Standards-based identity** — W3C DIDs/VCs via Veramo, anchored on the cheqd network.
- **Full holder experience** — a real mobile wallet with credential storage, proof requests,
  history, and encrypted backups, not just a script.

---

## Development

Requires Node, `circom`, `snarkjs`, and a `.env` (see `.env.example`).

<details>
<summary>ZK circuit lifecycle</summary>

```bash
npm run zk:compile          # compile circuits (circom → r1cs/wasm)
npm run zk:ptau             # powers-of-tau ceremony
npm run zk:setup            # Groth16 trusted setup → proving/verification keys
npm run zk:export-verifier  # export the Solidity verifier
npm run zk:prove            # generate + locally verify a proof
```
</details>

<details>
<summary>Deploy & verify on Sepolia</summary>

```bash
npx hardhat compile
npx hardhat ignition deploy ignition/modules/VerifierModule.ts --network sepolia --verify
npx hardhat run scripts/verify.ts --network sepolia
```
</details>

<details>
<summary>DID & Verifiable Credentials (Veramo / cheqd)</summary>

```bash
npx veramo config check -f agent.yml                                   # validate agent config
npx veramo execute -m cheqdCreateIdentifier --argsFile payload.json    # create a DID
npx veramo credential create --json                                    # issue a VC
npx veramo credential verify --raw "<jwt>"                             # verify a VC
npx veramo did resolve "<did>"                                         # resolve a DID document
```
</details>

<details>
<summary>Generate proof inputs</summary>

```bash
CIRCUIT=incomeRange EXTRA_ARGS="--L=8000 --U=15000" npm run zk:input
EXTRA_ARGS="--L=8000 --U=17000 --expectedCitizenship=RO" npm run zk:input
```
</details>
