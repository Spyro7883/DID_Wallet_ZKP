import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const citizenshipModule = buildModule("citizenshipModule", (m) => {
  const contract = m.contract("citizenshipVerifier");
  return { contract };
});

export default citizenshipModule;
