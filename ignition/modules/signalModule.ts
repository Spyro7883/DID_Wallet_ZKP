import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const SignalsModule = buildModule("SignalsModule", (m) => {
  const owner = m.getAccount(0);
  const signals = m.contract("VerifiableSignals", [owner]);
  return { signals };
});

export default SignalsModule;
