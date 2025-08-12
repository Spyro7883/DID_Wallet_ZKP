import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const incomeRangeModule = buildModule("incomeRangeModule", (m) => {
  const contract = m.contract("incomeRangeVerifier");
  return { contract };
});

export default incomeRangeModule;
