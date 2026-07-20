pragma circom 2.2.0;

include "merkleProof.circom";
include "order.circom";
include "bitify.circom";
include "comparators.circom";

template OrderRedeemV3(depth) {
    signal input orderRoot;
    signal input recipient;
    signal input winningOutcome;
    signal input priceYes;
    signal input fee;
    signal input feeBps;
    signal input stakeAmount;

    signal input amount;
    signal input side;
    signal input secret;
    signal input nullifier;
    signal input pathIndex;
    signal input siblings[depth];

    signal output nullifierHash;
    signal output payout;
    signal output commitment;

    var SCALE = 4294967296;

    component oc = OrderCommit();
    oc.amount <== amount;
    oc.side <== side;
    oc.secret <== secret;
    oc.nullifier <== nullifier;
    nullifierHash <== oc.nullifierHash;
    commitment <== oc.commitment;

    component mp = MerkleProof(depth);
    mp.leaf <== oc.commitment;
    mp.leafIndex <== pathIndex;
    mp.siblings <== siblings;
    orderRoot === mp.out;

    side * (1 - side) === 0;
    winningOutcome * (1 - winningOutcome) === 0;

    component ab = Num2Bits(20);
    ab.in <== amount;
    component sb = Num2Bits(20);
    sb.in <== stakeAmount;
    component stakeCheck = LessEqThan(20);
    stakeCheck.in[0] <== amount;
    stakeCheck.in[1] <== stakeAmount;
    stakeCheck.out === 1;

    component feeBpsBits = Num2Bits(14);
    feeBpsBits.in <== feeBps;
    component feeBpsCheck = LessEqThan(14);
    feeBpsCheck.in[0] <== feeBps;
    feeBpsCheck.in[1] <== 10000;
    feeBpsCheck.out === 1;

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
    signal unusedStake;
    unusedStake <== (stakeAmount - amount) * SCALE;
    entitlement <== unusedStake + refund + winnings;

    signal winningProfit;
    winningProfit <== win * refund;
    signal feeNumerator;
    feeNumerator <== winningProfit * feeBps;
    signal feeRemainder;
    feeRemainder <-- feeNumerator % 10000;
    feeNumerator === fee * 10000 + feeRemainder;
    component remainderBits = Num2Bits(14);
    remainderBits.in <== feeRemainder;
    component remainderCheck = LessThan(14);
    remainderCheck.in[0] <== feeRemainder;
    remainderCheck.in[1] <== 10000;
    remainderCheck.out === 1;

    component fchk = LessEqThan(96);
    fchk.in[0] <== fee;
    fchk.in[1] <== entitlement;
    fchk.out === 1;

    payout <== entitlement - fee;

    signal recipientSq <== recipient * recipient;
    signal feeSq <== fee * fee;
}

component main {public [orderRoot, recipient, winningOutcome, priceYes, fee, feeBps, stakeAmount]} = OrderRedeemV3(16);
