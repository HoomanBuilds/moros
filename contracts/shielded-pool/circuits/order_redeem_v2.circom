pragma circom 2.2.0;

include "merkleProof.circom";
include "order.circom";
include "bitify.circom";
include "comparators.circom";

template OrderRedeemV2(depth) {
    signal input orderRoot;
    signal input recipient;
    signal input winningOutcome;
    signal input priceYes;
    signal input fee;

    signal input amount;
    signal input side;
    signal input secret;
    signal input nullifier;
    signal input pathIndex;
    signal input siblings[depth];

    signal output nullifierHash;
    signal output payout;

    var SCALE = 4294967296;

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
    winningOutcome * (1 - winningOutcome) === 0;

    component ab = Num2Bits(20);
    ab.in <== amount;

    component pr = LessEqThan(34);
    pr.in[0] <== priceYes;
    pr.in[1] <== SCALE;
    pr.out === 1;

    signal a1 <== side * priceYes;
    signal a2 <== (1 - side) * (SCALE - priceYes);
    signal pSide;
    pSide <== a1 + a2;

    signal w1 <== side * winningOutcome;
    signal w2 <== (1 - side) * (1 - winningOutcome);
    signal win;
    win <== w1 + w2;

    signal refund;
    refund <== amount * (SCALE - pSide);
    signal wa <== win * amount;
    signal winnings;
    winnings <== wa * SCALE;

    signal entitlement;
    entitlement <== refund + winnings;

    component fchk = LessEqThan(96);
    fchk.in[0] <== fee;
    fchk.in[1] <== entitlement;
    fchk.out === 1;

    payout <== entitlement - fee;

    signal recipientSq <== recipient * recipient;
    signal feeSq <== fee * fee;
}

component main {public [orderRoot, recipient, winningOutcome, priceYes, fee]} = OrderRedeemV2(16);
