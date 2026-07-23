pragma circom 2.2.3;

include "./position_action.circom";

template PrivateBatch() {
    signal input networkDomain[2];
    signal input vault[2];
    signal input market[2];
    signal input epoch;
    signal input acceptedRoot;
    signal input acceptedCount;
    signal input firstSequence;
    signal input lastSequence;
    signal input committeeEpoch;
    signal input committeeConfigHash[2];
    signal input committeePublicKey[2];
    signal input aggregateCiphertext[4];
    signal input decryptionProofHash[2];
    signal input committeeStatementHash[2];
    signal input allocationRoot;
    signal input includedRoot;
    signal input lotSize;
    signal input quote[18];

    signal input committeeSecret;
    signal input actionId[8][2];
    signal input positionCommitment[8];
    signal input ciphertext[8][4];

    acceptedCount === 8;
    quote[1] === 8;
    lastSequence === firstSequence + 7;
    quote[2] + quote[3] === 8;

    component epochRange = Num2Bits(64);
    epochRange.in <== epoch;
    component firstSequenceRange = Num2Bits(64);
    firstSequenceRange.in <== firstSequence;
    component lastSequenceRange = Num2Bits(64);
    lastSequenceRange.in <== lastSequence;
    component committeeEpochRange = Num2Bits(64);
    committeeEpochRange.in <== committeeEpoch;
    component stateVersionRange = Num2Bits(64);
    stateVersionRange.in <== quote[0];
    component countRanges[4];
    countRanges[0] = Num2Bits(7);
    countRanges[0].in <== acceptedCount;
    countRanges[1] = Num2Bits(7);
    countRanges[1].in <== quote[1];
    countRanges[2] = Num2Bits(7);
    countRanges[2].in <== quote[2];
    countRanges[3] = Num2Bits(7);
    countRanges[3].in <== quote[3];
    component lotRange = Num2Bits(60);
    lotRange.in <== lotSize;
    component lotZero = IsZero();
    lotZero.in <== lotSize;
    lotZero.out === 0;
    component priceRanges[4];
    for (var index = 0; index < 4; index++) {
        priceRanges[index] = Num2Bits(33);
        priceRanges[index].in <== quote[4 + index];
    }
    component amountRanges[10];
    for (var index = 0; index < 10; index++) {
        amountRanges[index] = Num2Bits(60);
        amountRanges[index].in <== quote[8 + index];
    }
    component limbRanges[18];
    for (var index = 0; index < 2; index++) {
        limbRanges[index] = Num2Bits(128);
        limbRanges[index].in <== networkDomain[index];
        limbRanges[2 + index] = Num2Bits(128);
        limbRanges[2 + index].in <== vault[index];
        limbRanges[4 + index] = Num2Bits(128);
        limbRanges[4 + index].in <== market[index];
        limbRanges[6 + index] = Num2Bits(128);
        limbRanges[6 + index].in <== committeeConfigHash[index];
        limbRanges[8 + index] = Num2Bits(128);
        limbRanges[8 + index].in <== decryptionProofHash[index];
        limbRanges[10 + index] = Num2Bits(128);
        limbRanges[10 + index].in <== committeeStatementHash[index];
    }
    component decryptionHashZero[2];
    component statementHashZero[2];
    for (var index = 0; index < 2; index++) {
        decryptionHashZero[index] = IsZero();
        decryptionHashZero[index].in <== decryptionProofHash[index];
        statementHashZero[index] = IsZero();
        statementHashZero[index].in <== committeeStatementHash[index];
    }
    decryptionHashZero[0].out * decryptionHashZero[1].out === 0;
    statementHashZero[0].out * statementHashZero[1].out === 0;

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    var SUBORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041;
    component secretBits = Num2Bits(252);
    secretBits.in <== committeeSecret;
    component secretBound = LessThan(252);
    secretBound.in[0] <== committeeSecret;
    secretBound.in[1] <== SUBORDER;
    secretBound.out === 1;
    component secretZero = IsZero();
    secretZero.in <== committeeSecret;
    secretZero.out === 0;
    component publicKey = EscalarMulFix(252, BASE8);
    for (var bit = 0; bit < 252; bit++) {
        publicKey.e[bit] <== secretBits.out[bit];
    }
    publicKey.out[0] === committeePublicKey[0];
    publicKey.out[1] === committeePublicKey[1];

    component acceptedLeaves[8];
    component includedLeaves[8];
    component allocationLeaves[8];
    component shared[8];
    component sharedDouble0[8];
    component sharedDouble1[8];
    component sharedDouble2[8];
    component plaintext[8];
    component sideBits[8];
    signal side[8];
    signal charge[8];
    var yesTotal = 0;
    component payout = PositionCeilDivConstant(4294967296, 84, 33);
    payout.numerator <== lotSize * 10000000;

    for (var index = 0; index < 8; index++) {
        acceptedLeaves[index] = AcceptedOrderLeaf();
        acceptedLeaves[index].market[0] <== market[0];
        acceptedLeaves[index].market[1] <== market[1];
        acceptedLeaves[index].epoch <== epoch;
        acceptedLeaves[index].sequence <== firstSequence + index;
        acceptedLeaves[index].actionId[0] <== actionId[index][0];
        acceptedLeaves[index].actionId[1] <== actionId[index][1];
        acceptedLeaves[index].positionCommitment <== positionCommitment[index];
        for (var field = 0; field < 4; field++) {
            acceptedLeaves[index].ciphertext[field] <== ciphertext[index][field];
        }
        acceptedLeaves[index].committeeEpoch <== committeeEpoch;

        shared[index] = EscalarMulAny(252);
        for (var bit = 0; bit < 252; bit++) {
            shared[index].e[bit] <== secretBits.out[bit];
        }
        shared[index].p[0] <== ciphertext[index][0];
        shared[index].p[1] <== ciphertext[index][1];
        sharedDouble0[index] = BabyDbl();
        sharedDouble0[index].x <== shared[index].out[0];
        sharedDouble0[index].y <== shared[index].out[1];
        sharedDouble1[index] = BabyDbl();
        sharedDouble1[index].x <== sharedDouble0[index].xout;
        sharedDouble1[index].y <== sharedDouble0[index].yout;
        sharedDouble2[index] = BabyDbl();
        sharedDouble2[index].x <== sharedDouble1[index].xout;
        sharedDouble2[index].y <== sharedDouble1[index].yout;
        plaintext[index] = BabyAdd();
        plaintext[index].x1 <== ciphertext[index][2];
        plaintext[index].y1 <== ciphertext[index][3];
        plaintext[index].x2 <== -sharedDouble2[index].xout;
        plaintext[index].y2 <== sharedDouble2[index].yout;
        side[index] <-- plaintext[index].xout == 0 ? 0 : 1;
        sideBits[index] = Num2Bits(1);
        sideBits[index].in <== side[index];
        plaintext[index].xout === side[index] * BASE8[0];
        plaintext[index].yout === 1 + side[index] * (BASE8[1] - 1);
        yesTotal += side[index];

        charge[index] <== quote[12] + side[index] * (quote[11] - quote[12]);
        allocationLeaves[index] = AllocationLeaf();
        allocationLeaves[index].market[0] <== market[0];
        allocationLeaves[index].market[1] <== market[1];
        allocationLeaves[index].epoch <== epoch;
        allocationLeaves[index].sequence <== firstSequence + index;
        allocationLeaves[index].positionCommitment <== positionCommitment[index];
        allocationLeaves[index].side <== side[index];
        allocationLeaves[index].charge <== charge[index];
        allocationLeaves[index].fee <== quote[14];
        allocationLeaves[index].payout <== payout.result;

        includedLeaves[index] = IncludedPositionLeaf();
        includedLeaves[index].market[0] <== market[0];
        includedLeaves[index].market[1] <== market[1];
        includedLeaves[index].epoch <== epoch;
        includedLeaves[index].sequence <== firstSequence + index;
        includedLeaves[index].positionCommitment <== positionCommitment[index];
    }
    quote[2] === yesTotal;
    quote[3] === 8 - yesTotal;

    signal acceptedTreeLeaves[64];
    signal allocationTreeLeaves[64];
    signal includedTreeLeaves[64];
    for (var index = 0; index < 64; index++) {
        if (index < 8) {
            acceptedTreeLeaves[index] <== acceptedLeaves[index].out;
            allocationTreeLeaves[index] <== allocationLeaves[index].out;
            includedTreeLeaves[index] <== includedLeaves[index].out;
        } else {
            acceptedTreeLeaves[index] <== 0;
            allocationTreeLeaves[index] <== 0;
            includedTreeLeaves[index] <== 0;
        }
    }
    component acceptedTree = FixedMerkle64();
    component allocationTree = FixedMerkle64();
    component includedTree = FixedMerkle64();
    for (var index = 0; index < 64; index++) {
        acceptedTree.leaves[index] <== acceptedTreeLeaves[index];
        allocationTree.leaves[index] <== allocationTreeLeaves[index];
        includedTree.leaves[index] <== includedTreeLeaves[index];
    }
    acceptedTree.root === acceptedRoot;
    allocationTree.root === allocationRoot;
    includedTree.root === includedRoot;

    component c1Adds[7];
    component c2Adds[7];
    signal c1Aggregate[8][2];
    signal c2Aggregate[8][2];
    c1Aggregate[0][0] <== ciphertext[0][0];
    c1Aggregate[0][1] <== ciphertext[0][1];
    c2Aggregate[0][0] <== ciphertext[0][2];
    c2Aggregate[0][1] <== ciphertext[0][3];
    for (var index = 1; index < 8; index++) {
        c1Adds[index - 1] = BabyAdd();
        c1Adds[index - 1].x1 <== c1Aggregate[index - 1][0];
        c1Adds[index - 1].y1 <== c1Aggregate[index - 1][1];
        c1Adds[index - 1].x2 <== ciphertext[index][0];
        c1Adds[index - 1].y2 <== ciphertext[index][1];
        c1Aggregate[index][0] <== c1Adds[index - 1].xout;
        c1Aggregate[index][1] <== c1Adds[index - 1].yout;

        c2Adds[index - 1] = BabyAdd();
        c2Adds[index - 1].x1 <== c2Aggregate[index - 1][0];
        c2Adds[index - 1].y1 <== c2Aggregate[index - 1][1];
        c2Adds[index - 1].x2 <== ciphertext[index][2];
        c2Adds[index - 1].y2 <== ciphertext[index][3];
        c2Aggregate[index][0] <== c2Adds[index - 1].xout;
        c2Aggregate[index][1] <== c2Adds[index - 1].yout;
    }
    aggregateCiphertext[0] === c1Aggregate[7][0];
    aggregateCiphertext[1] === c1Aggregate[7][1];
    aggregateCiphertext[2] === c2Aggregate[7][0];
    aggregateCiphertext[3] === c2Aggregate[7][1];

    signal yesCollected;
    signal noCollected;
    yesCollected <== quote[11] * quote[2];
    noCollected <== quote[12] * quote[3];
    signal yesRemainder;
    signal noRemainder;
    yesRemainder <== quote[9] - yesCollected;
    noRemainder <== quote[10] - noCollected;
    component yesRemainderRange = Num2Bits(4);
    yesRemainderRange.in <== yesRemainder;
    component noRemainderRange = Num2Bits(4);
    noRemainderRange.in <== noRemainder;
    component yesRemainderBound = LessThan(4);
    yesRemainderBound.in[0] <== yesRemainder;
    yesRemainderBound.in[1] <== quote[2];
    yesRemainderBound.out === 1;
    component noRemainderBound = LessThan(4);
    noRemainderBound.in[0] <== noRemainder;
    noRemainderBound.in[1] <== quote[3];
    noRemainderBound.out === 1;
    quote[8] === quote[9] + quote[10];
    quote[13] === yesRemainder + noRemainder;
    quote[15] === quote[14] * 8;
    quote[16] + quote[17] + quote[13] === quote[15];
}

component main { public [
    networkDomain,
    vault,
    market,
    epoch,
    acceptedRoot,
    acceptedCount,
    firstSequence,
    lastSequence,
    committeeEpoch,
    committeeConfigHash,
    committeePublicKey,
    aggregateCiphertext,
    decryptionProofHash,
    committeeStatementHash,
    allocationRoot,
    includedRoot,
    lotSize,
    quote
] } = PrivateBatch();
