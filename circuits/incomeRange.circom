pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template IncomeRange() {
  
  signal input income;
  signal input salt;

  signal input L;
  signal input U;
  
  signal output privHash;
  signal output inRange;

  component incBits = Num2Bits(64); incBits.in <== income;
  component lBits   = Num2Bits(64); lBits.in   <== L;
  component uBits   = Num2Bits(64); uBits.in   <== U;

  component h = Poseidon(2);
  h.inputs[0] <== income;
  h.inputs[1] <== salt;
  privHash <== h.out;

  component ltLU = LessThan(64);
  ltLU.in[0] <== L;
  ltLU.in[1] <== U;
  ltLU.out === 1;

  component geL = GreaterEqThan(64);
  geL.in[0] <== income;
  geL.in[1] <== L;

  component ltU = LessThan(64);
  ltU.in[0] <== income;
  ltU.in[1] <== U;

  inRange <== geL.out * ltU.out;
}