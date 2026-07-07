pragma circom 2.2.0;

include "merkleProof.circom";
include "comparators.circom";
include "order.circom";

template BatchNet(N, depth) {
    signal input orderRoot;

    signal input amount[N];
    signal input side[N];
    signal input secret[N];
    signal input nullifier[N];
    signal input pathIndex[N];
    signal input siblings[N][depth];

    signal output dQYes;
    signal output dQNo;
    signal output nullifierHashOut[N];

    signal accYes[N + 1];
    signal accNo[N + 1];
    accYes[0] <== 0;
    accNo[0] <== 0;

    component oc[N];
    component mp[N];
    component rng[N];
    signal prodYes[N];

    for (var i = 0; i < N; i++) {
        oc[i] = OrderCommit();
        oc[i].amount <== amount[i];
        oc[i].side <== side[i];
        oc[i].secret <== secret[i];
        oc[i].nullifier <== nullifier[i];

        mp[i] = MerkleProof(depth);
        mp[i].leaf <== oc[i].commitment;
        mp[i].leafIndex <== pathIndex[i];
        mp[i].siblings <== siblings[i];
        orderRoot === mp[i].out;

        side[i] * (1 - side[i]) === 0;

        rng[i] = Num2Bits(64);
        rng[i].in <== amount[i];
        _ <== rng[i].out;

        prodYes[i] <== amount[i] * side[i];
        accYes[i + 1] <== accYes[i] + prodYes[i];
        accNo[i + 1] <== accNo[i] + (amount[i] - prodYes[i]);

        nullifierHashOut[i] <== oc[i].nullifierHash;
    }

    dQYes <== accYes[N];
    dQNo <== accNo[N];
}

component main {public [orderRoot]} = BatchNet(4, 2);
