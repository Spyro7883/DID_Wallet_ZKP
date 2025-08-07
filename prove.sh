set -e

circom circuits/Age_Verification.circom --r1cs --wasm --sym -o build -l circomlib/circuits

snarkjs powersoftau new bn128 12 build/pot12_0000.ptau -v
snarkjs powersoftau contribute build/pot12_0000.ptau build/pot12_0001.ptau --name="first" -v
snarkjs powersoftau prepare phase2 build/pot12_0001.ptau build/pot12_final.ptau -v

snarkjs groth16 setup build/Age_Verification.r1cs build/pot12_final.ptau build/circuit_0000.zkey
snarkjs zkey contribute build/circuit_0000.zkey build/circuit_final.zkey --name="1st contributor" -v
snarkjs zkey export verificationkey build/circuit_final.zkey build/verification_key.json

node scripts/generate_input.js
node build/Age_Verification_js/generate_witness.js build/Age_Verification_js/Age_Verification.wasm build/input.json build/witness.wtns

snarkjs groth16 prove build/circuit_final.zkey build/witness.wtns build/proof.json build/public.json

snarkjs groth16 verify build/verification_key.json build/public.json build/proof.json

snarkjs zkey export solidityverifier build/circuit_final.zkey contracts/verifier.sol
