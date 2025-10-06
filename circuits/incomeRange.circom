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
  signal output policyOk;

  component incBits = Num2Bits(32); incBits.in <== income;
  component lBits   = Num2Bits(32); lBits.in   <== L;
  component uBits   = Num2Bits(32); uBits.in   <== U;

  component h = Poseidon(2);
  h.inputs[0] <== income;
  h.inputs[1] <== salt;
  privHash <== h.out;

  component ltLU = LessThan(32);
  ltLU.in[0] <== L;
  ltLU.in[1] <== U;
  policyOk <== ltLU.out;

  component geL = GreaterEqThan(32);
  geL.in[0] <== income;
  geL.in[1] <== L;

  component ltU = LessThan(32);
  ltU.in[0] <== income;
  ltU.in[1] <== U;

  inRange <== geL.out * ltU.out;
}