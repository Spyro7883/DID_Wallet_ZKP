pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template Citizenship_Verification() {    
    signal input citizenship; 
    signal input salt;
    signal input privHash;
    signal output isEligible;

    component h = Poseidon(2);
    h.inputs[0] <== citizenship;
    h.inputs[1] <== salt;
    privHash === h.out;

    isEligible <== 1;
}