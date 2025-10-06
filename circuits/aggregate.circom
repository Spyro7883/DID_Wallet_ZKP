pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/poseidon.circom";

include "./age.circom";
include "./citizenship.circom";
include "./incomeRange.circom";

template Aggregate() {
  
  signal input age;
  signal input citizenship;
  signal input income;
  signal input salt;
  
  signal input expectedCitizenship;
  signal input L;
  signal input U;
  signal input contextId;
  
  signal output allValid;
  signal output privHash;
  signal output agePrivHash;
  signal output citizenshipPrivHash;
  signal output incomePrivHash;

  component h = Poseidon(5);
  h.inputs[0] <== age;
  h.inputs[1] <== citizenship;
  h.inputs[2] <== income;
  h.inputs[3] <== salt;
  h.inputs[4] <== contextId;
    
  privHash <== h.out; 

  component ageCheck = AgeVerification();
  ageCheck.age <== age;
  ageCheck.salt <== salt;
  agePrivHash <== ageCheck.privHash;
    
  component citizenCheck = CitizenshipVerification();
  citizenCheck.citizenship <== citizenship;
  citizenCheck.salt <== salt;
  citizenCheck.expectedCitizenship <== expectedCitizenship;
  citizenshipPrivHash <== citizenCheck.privHash;
    
  component incomeCheck = IncomeRange();
  incomeCheck.income <== income;
  incomeCheck.salt <== salt;
  incomeCheck.L <== L;
  incomeCheck.U <== U;
  incomePrivHash <== incomeCheck.privHash;

  signal ageAndCitizen;
  ageAndCitizen <== ageCheck.isEligible * citizenCheck.isEligible;
  allValid <== ageAndCitizen * incomeCheck.inRange;

  allValid === 1;

  incomeCheck.policyOk === 1;
}
component main {public [expectedCitizenship, L, U, contextId]} = Aggregate();
