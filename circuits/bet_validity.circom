pragma circom 2.0.0;

include "comparators.circom";
include "poseidon.circom";

// Proves a hidden bet: knowledge of a private (amount, side, secret) whose
// commitment is the public output, with 0 < amount <= cap and side in {0,1}.
template BetValidity() {
    signal input amount;
    signal input side;
    signal input secret;
    signal input cap;
    signal output commitment;

    side * (side - 1) === 0;

    component within = LessThan(64);
    within.in[0] <== amount;
    within.in[1] <== cap + 1;
    within.out === 1;

    component positive = LessThan(64);
    positive.in[0] <== 0;
    positive.in[1] <== amount;
    positive.out === 1;

    component h = Poseidon(3);
    h.inputs[0] <== amount;
    h.inputs[1] <== side;
    h.inputs[2] <== secret;
    commitment <== h.out;
}

component main {public [cap]} = BetValidity();
