pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template CitizenshipVerification() {    
    signal input citizenship; 
    signal input salt;
    signal input expectedCitizenship;

    signal output privHash;
    signal output isEligible;

    component h = Poseidon(2);
    h.inputs[0] <== citizenship;
    h.inputs[1] <== salt;
    privHash <== h.out;

    component eq = IsEqual();
    eq.in[0] <== citizenship;
    eq.in[1] <== expectedCitizenship;
    isEligible <== eq.out;
}