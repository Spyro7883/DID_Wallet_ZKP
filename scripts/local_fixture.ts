import fs from "fs";
import path from "path";
import * as circomlibjs from "circomlibjs";

async function main() {
  const age = 26n;
  const citizenship = 642n;
  const income = 4500n;

  const saltAge = 111111n;
  const saltCit = 222222n;
  const saltIncome = 333333n;

  const expectedCitizenship = 642n;
  const L = 1000n;
  const U = 5000n;
  const contextId = 12345n;

  const poseidon = await (circomlibjs as any).buildPoseidon();
  const F = poseidon.F;

  const ageCommit = F.toString(poseidon([age, saltAge]));
  const citizenshipCommit = F.toString(poseidon([citizenship, saltCit]));
  const incomeCommit = F.toString(poseidon([income, saltIncome]));

  const input = {
    age: age.toString(),
    citizenship: citizenship.toString(),
    income: income.toString(),

    saltAge: saltAge.toString(),
    saltCit: saltCit.toString(),
    saltIncome: saltIncome.toString(),

    ageCommit,
    citizenshipCommit,
    incomeCommit,

    expectedCitizenship: expectedCitizenship.toString(),
    L: L.toString(),
    U: U.toString(),
    contextId: contextId.toString(),
  };

  const outPath = path.join("build", "aggregate", "aggregate_js", "input.json");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(input, null, 2));

  console.log("Wrote:", outPath);
  console.log(input);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
