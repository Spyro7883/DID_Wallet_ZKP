import { poseidon } from "@noble/curves/abstract/poseidon.js";
import * as modular from "@noble/curves/abstract/modular.js";
import poseidonConstants from "./poseidon_constants.json";

type PoseidonConstants = {
  C: string[][];
  M: string[][][];
};

const CONSTANTS = poseidonConstants as PoseidonConstants;

const SNARK_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

const PARTIAL_ROUNDS = [
  56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68,
];

let poseidon2Runner: ((inputs: bigint[]) => bigint) | null = null;

function buildPoseidon2Runner() {
  const t = 3;
  const roundsFull = 8;
  const roundsPartial = PARTIAL_ROUNDS[t - 2];
  const sboxPower = 5;

  const rawC = CONSTANTS.C[t - 2];
  const rawM = CONSTANTS.M[t - 2];

  if (!rawC || !rawM) {
    throw new Error("poseidon_constants_missing_t3");
  }

  const roundConstants: bigint[][] = [];
  for (let i = 0; i < rawC.length; i += t) {
    roundConstants.push(rawC.slice(i, i + t).map((x) => BigInt(x)));
  }

  const mds: bigint[][] = rawM.map((row) => row.map((x) => BigInt(x)));

  const Fp = modular.Field(SNARK_FIELD);

  const permute = poseidon({
    Fp,
    t,
    roundsFull,
    roundsPartial,
    sboxPower,
    mds,
    roundConstants,
  });

  return (inputs: bigint[]) => {
    if (inputs.length !== 2) {
      throw new Error("poseidon2_expected_2_inputs");
    }

    const state = [0n, inputs[0], inputs[1]];
    const out = permute(state);
    return out[0];
  };
}

function getPoseidon2Runner() {
  if (!poseidon2Runner) {
    poseidon2Runner = buildPoseidon2Runner();
  }
  return poseidon2Runner;
}

export async function poseidon2(a: bigint, b: bigint): Promise<string> {
  const run = getPoseidon2Runner();
  return run([a, b]).toString();
}
