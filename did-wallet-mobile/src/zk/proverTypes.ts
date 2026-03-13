export type AggregateZkInput = {
  age: string;
  citizenship: string;
  income: string;

  saltAge: string;
  saltCit: string;
  saltIncome: string;

  ageCommit: string;
  citizenshipCommit: string;
  incomeCommit: string;

  expectedCitizenship: string;
  L: string;
  U: string;
  contextId: string;
};

export type AggregateProofResult = {
  proof: any;
  publicSignals: string[];
};
