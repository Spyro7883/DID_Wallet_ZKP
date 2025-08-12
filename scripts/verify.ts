import { ethers } from "hardhat";
import * as fs from "fs";
import path from "path";

async function main() {
  const contractKey = process.env.CIRCUIT;
  if (!contractKey) {
    console.error("❌ Specify the contract.");
    process.exit(1);
  }
  const { chainId } = await ethers.provider.getNetwork();
  const deployedPath = path.join(
    "ignition",
    "deployments",
    `chain-${chainId}`,
    "deployed_addresses.json"
  );

  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  const contractAddress: string =
    deployed[`${contractKey}Module#${contractKey}Verifier`] ??
    Object.values(deployed)[0];

  if (typeof contractAddress !== "string") {
    throw new Error(
      "❌ Contract's address has not been found in deployed_addresses.json"
    );
  }

  const verifier = await ethers.getContractAt(
    `${contractKey}Verifier`,
    contractAddress
  );

  const [a, b, c, input] = JSON.parse(
    fs.readFileSync(`build/${contractKey}/calldata.json`, "utf8")
  );
  const isValid = await verifier.verifyProof(
    a as [string, string],
    b as [[string, string], [string, string]],
    c as [string, string],
    [input[0]] as [string]
  );

  console.log("Result:", isValid);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
