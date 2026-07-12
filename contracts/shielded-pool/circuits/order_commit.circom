pragma circom 2.2.0;

include "order.circom";

template OrderCommitMain() {
    signal input amount;
    signal input side;
    signal input secret;
    signal input nullifier;
    signal output commitment;
    signal output nullifierHash;

    component oc = OrderCommit();
    oc.amount <== amount;
    oc.side <== side;
    oc.secret <== secret;
    oc.nullifier <== nullifier;
    commitment <== oc.commitment;
    nullifierHash <== oc.nullifierHash;
}

component main = OrderCommitMain();
