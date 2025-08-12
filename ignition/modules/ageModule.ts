import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ageModule = buildModule("ageModule", (m) => {
  const contract = m.contract("ageVerifier");
  return { contract };
});

export default ageModule;
