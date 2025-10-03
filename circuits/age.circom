pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template AgeVerification() {
    signal input age;
    signal input salt;

    signal output privHash;
    signal output isEligible;

    component ageBits = Num2Bits(8);
    ageBits.in <== age;

    component h = Poseidon(2);
    h.inputs[0] <== age;
    h.inputs[1] <== salt;
    privHash <== h.out;

    component cmp = GreaterEqThan(8);
    cmp.in[0] <== age;
    cmp.in[1] <== 18;

    isEligible <== cmp.out;
}