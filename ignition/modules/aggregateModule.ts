import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ageModule = buildModule("aggregateModule", (m) => {
  const contract = m.contract("aggregateVerifier");
  return { contract };
});

export default ageModule;
