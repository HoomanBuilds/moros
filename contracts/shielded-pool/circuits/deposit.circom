pragma circom 2.2.0;

include "commitment.circom";
include "comparators.circom";

template Deposit() {
    signal input cap;

    signal input value;
    signal input label;
    signal input nullifier;
    signal input secret;
    signal input side;

    signal output commitment;

    component ch = CommitmentHasher();
    ch.value <== value;
    ch.label <== label;
    ch.secret <== secret;
    ch.nullifier <== nullifier;
    ch.side <== side;
    commitment <== ch.commitment;

    side * (1 - side) === 0;

    component le = LessEqThan(64);
    le.in[0] <== value;
    le.in[1] <== cap;
    le.out === 1;

    component nz = IsZero();
    nz.in <== value;
    nz.out === 0;
}

component main {public [cap]} = Deposit();
