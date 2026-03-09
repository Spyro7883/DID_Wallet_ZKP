pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/poseidon.circom";

include "./age.circom";
include "./citizenship.circom";
include "./incomeRange.circom";

template Aggregate() {
  
  signal input age;
  signal input citizenship;
  signal input income;
  
  signal input saltAge;
  signal input saltCit;
  signal input saltIncome;

  signal input ageCommit;
  signal input citizenshipCommit;
  signal input incomeCommit;
  
  signal input expectedCitizenship;
  signal input L;
  signal input U;
  signal input contextId;
  
  signal output allValid;
  signal output privHash;
  signal output agePrivHash;
  signal output citizenshipPrivHash;
  signal output incomePrivHash;

  component h = Poseidon(7);
  h.inputs[0] <== age;
  h.inputs[1] <== citizenship;
  h.inputs[2] <== income;
  h.inputs[3] <== saltAge;
  h.inputs[4] <== saltCit;
  h.inputs[5] <== saltIncome;
  h.inputs[6] <== contextId;
    
  privHash <== h.out; 

  component ageCheck = AgeVerification();
  ageCheck.age <== age;
  ageCheck.saltAge <== saltAge;
  ageCheck.ageCommit <== ageCommit;
  agePrivHash <== ageCheck.agePrivHash;
    
  component citizenCheck = CitizenshipVerification();
  citizenCheck.citizenship <== citizenship;
  citizenCheck.saltCit <== saltCit;
  citizenCheck.citizenshipCommit <== citizenshipCommit;
  citizenCheck.expectedCitizenship <== expectedCitizenship;
  citizenshipPrivHash <== citizenCheck.citizenshipPrivHash;
    
  component incomeCheck = IncomeRange();
  incomeCheck.income <== income;
  incomeCheck.saltIncome <== saltIncome;
  incomeCheck.incomeCommit <== incomeCommit;
  incomeCheck.L <== L;
  incomeCheck.U <== U;
  incomePrivHash <== incomeCheck.incomePrivHash;

  signal ageAndCitizen;
  ageAndCitizen <== ageCheck.isEligible * citizenCheck.isEligible;
  allValid <== ageAndCitizen * incomeCheck.inRange;

  allValid === 1;

  incomeCheck.policyOk === 1;
}
component main {public [ageCommit, citizenshipCommit, incomeCommit, expectedCitizenship, L, U, contextId]} = Aggregate();
