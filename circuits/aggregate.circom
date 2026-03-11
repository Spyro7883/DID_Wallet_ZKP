pragma circom 2.0.0;

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

  component ageCheck = AgeVerification();
  ageCheck.age <== age;
  ageCheck.saltAge <== saltAge;
  ageCheck.ageCommit <== ageCommit;

  component citizenCheck = CitizenshipVerification();
  citizenCheck.citizenship <== citizenship;
  citizenCheck.saltCit <== saltCit;
  citizenCheck.citizenshipCommit <== citizenshipCommit;
  citizenCheck.expectedCitizenship <== expectedCitizenship;

  component incomeCheck = IncomeRange();
  incomeCheck.income <== income;
  incomeCheck.saltIncome <== saltIncome;
  incomeCheck.incomeCommit <== incomeCommit;
  incomeCheck.L <== L;
  incomeCheck.U <== U;

  signal ageAndCitizen;
  ageAndCitizen <== ageCheck.isEligible * citizenCheck.isEligible;
  allValid <== ageAndCitizen * incomeCheck.inRange;

  allValid === 1;
  incomeCheck.policyOk === 1;
}

component main {public [ageCommit, citizenshipCommit, incomeCommit, expectedCitizenship, L, U, contextId]} = Aggregate();