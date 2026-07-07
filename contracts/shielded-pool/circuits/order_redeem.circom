pragma circom 2.2.0;

include "merkleProof.circom";
include "order.circom";

template OrderRedeem(depth) {
    signal input orderRoot;
    signal input recipient;
    signal input winningOutcome;

    signal input amount;
    signal input side;
    signal input secret;
    signal input nullifier;
    signal input pathIndex;
    signal input siblings[depth];

    signal output nullifierHash;
    signal output payout;

    component oc = OrderCommit();
    oc.amount <== amount;
    oc.side <== side;
    oc.secret <== secret;
    oc.nullifier <== nullifier;
    nullifierHash <== oc.nullifierHash;

    component mp = MerkleProof(depth);
    mp.leaf <== oc.commitment;
    mp.leafIndex <== pathIndex;
    mp.siblings <== siblings;
    orderRoot === mp.out;

    side * (1 - side) === 0;
    side === winningOutcome;
    payout <== amount;

    signal recipientSq <== recipient * recipient;
}

component main {public [orderRoot, recipient, winningOutcome]} = OrderRedeem(2);
