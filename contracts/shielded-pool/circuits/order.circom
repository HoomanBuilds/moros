pragma circom 2.2.0;

include "poseidon255.circom";

template OrderCommit() {
    signal input amount;
    signal input side;
    signal input secret;
    signal input nullifier;

    signal output commitment;
    signal output nullifierHash;

    component nh = Poseidon255(1);
    nh.in[0] <== nullifier;
    nullifierHash <== nh.out;

    component sn = Poseidon255(2);
    sn.in[0] <== secret;
    sn.in[1] <== nullifier;

    component c = Poseidon255(3);
    c.in[0] <== amount;
    c.in[1] <== side;
    c.in[2] <== sn.out;
    commitment <== c.out;
}
