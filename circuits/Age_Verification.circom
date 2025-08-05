pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template Age_Verification() {    
    signal input age;
    signal input salt;
    
    signal input privHash;
    signal input threshold;

    signal output isEligible;

    component h = Poseidon(2);
    h.inputs[0] <== age;
    h.inputs[1] <== salt;
    
    privHash === h.out;

    component cmp = GreaterEqThan(64);
    cmp.in[0] <== age;
    cmp.in[1] <== threshold;

    isEligible <== cmp.out;
}

component main = Age_Verification();