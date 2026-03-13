import type { AggregateProofResult, AggregateZkInput } from "./proverTypes";

type AggregateRunner = (
  input: AggregateZkInput,
) => Promise<AggregateProofResult>;

let aggregateRunner: AggregateRunner | null = null;

export function bindAggregateProver(runner: AggregateRunner) {
  aggregateRunner = runner;
}

export function unbindAggregateProver() {
  aggregateRunner = null;
}

export async function runAggregateProof(
  input: AggregateZkInput,
): Promise<AggregateProofResult> {
  if (!aggregateRunner) {
    throw new Error("prover_not_bound");
  }
  return await aggregateRunner(input);
}
