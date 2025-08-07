import { ethers } from "hardhat";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const contractAddress = process.env.VERIFY_PROOF_ADDRESS!;

  const verifier = await ethers.getContractAt(
    "Groth16Verifier",
    contractAddress
  );

  const [a, b, c, input] = JSON.parse(
    fs.readFileSync("build/calldata.json", "utf8")
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
