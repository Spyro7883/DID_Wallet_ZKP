import * as circomlibjs from "circomlibjs";

let _poseidon: any | null = null;

async function getPoseidon() {
  if (_poseidon) return _poseidon;
  _poseidon = await (circomlibjs as any).buildPoseidon();
  return _poseidon;
}

export async function poseidon2(a: bigint, b: bigint): Promise<string> {
  const p = await getPoseidon();
  const out = p([a, b]);
  return p.F.toString(out);
}
