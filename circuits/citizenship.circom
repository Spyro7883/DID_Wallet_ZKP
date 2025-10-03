pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template CitizenshipVerification() {    
    signal input citizenship; 
    signal input salt;
    signal input expectedCitizenship;

    signal output privHash;
    signal output isEligible;

       component cBits  = Num2Bits(8); cBits.in  <== citizenship;
    component eBits  = Num2Bits(8); eBits.in  <== expectedCitizenship;

    component h = Poseidon(2);
    h.inputs[0] <== citizenship;
    h.inputs[1] <== salt;
    privHash <== h.out;

    signal diff;
    diff <== citizenship - expectedCitizenship;

    component iz = IsZero();
    iz.in <== diff;

    isEligible <== iz.out;
}