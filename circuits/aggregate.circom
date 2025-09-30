pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

include "./age.circom";
include "./citizenship.circom";
include "./incomeRange.circom";

template Aggregate() {
  
  signal input age;
  signal input citizenship;
  signal input income;
  signal input salt;

  signal input privHash;
  signal input L;
  signal input U;
  
  signal output ok;

  component ageCheck = Age_Verification();
  component citizenshipCheck = Citizenship_Verification();
  component incomeRangeCheck = Income_Range();

  ageCheck.age <== age;

  citizenshipCheck.citizenship <== citizenship;

  incomeRangeCheck.income <== income;
  incomeRangeCheck.L      <== L;
  incomeRangeCheck.U      <== U;

  component h = Poseidon(4);
  h.inputs[0] <== age;
  h.inputs[1] <== citizenship;
  h.inputs[2] <== income;
  h.inputs[3] <== salt;
    
  privHash === h.out; 

  ok <== ageCheck.ok * citizenshipCheck.ok * incomeRangeCheck.ok;
}
component main = Aggregate();
