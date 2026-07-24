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
    signal input aggregateCiphertext[8];
    signal input decryptionProofHash[2];
    signal input committeeStatementHash[2];
    signal input allocationRoot;
    signal input includedRoot;
    signal input lotSize;
    signal input quote[18];

    signal input committeeSecret;
    signal input actionId[8][2];
    signal input positionCommitment[8];
    signal input ciphertext[8][8];
    signal input yesAmount[8];
    signal input noAmount[8];

    component acceptedCountZero = IsZero();
    acceptedCountZero.in <== acceptedCount;
    acceptedCountZero.out === 0;
    component acceptedCountBound = LessThan(4);
    acceptedCountBound.in[0] <== acceptedCount;
    acceptedCountBound.in[1] <== 9;
    acceptedCountBound.out === 1;
    lastSequence === firstSequence + acceptedCount - 1;
    quote[1] === quote[2] + quote[3];

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
    countRanges[1] = Num2Bits(14);
    countRanges[1].in <== quote[1];
    countRanges[2] = Num2Bits(14);
    countRanges[2].in <== quote[2];
    countRanges[3] = Num2Bits(14);
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
    component yesShared[8];
    component yesSharedDouble0[8];
    component yesSharedDouble1[8];
    component yesSharedDouble2[8];
    component noShared[8];
    component noSharedDouble0[8];
    component noSharedDouble1[8];
    component noSharedDouble2[8];
    component yesPlaintext[8];
    component noPlaintext[8];
    component yesAmountBits[8];
    component noAmountBits[8];
    component yesAmountBound[8];
    component noAmountBound[8];
    component yesMessage[8];
    component noMessage[8];
    component yesAmountZero[8];
    component noAmountZero[8];
    component slotActive[8];
    signal active[8];
    signal side[8];
    signal quantity[8];
    signal chargePerUnit[8];
    signal charge[8];
    signal fee[8];
    signal positionPayout[8];
    var yesTotal = 0;
    var noTotal = 0;
    component payout = PositionCeilDivConstant(4294967296, 84, 33);
    payout.numerator <== lotSize * 10000000;

    for (var index = 0; index < 8; index++) {
        slotActive[index] = LessThan(4);
        slotActive[index].in[0] <== index;
        slotActive[index].in[1] <== acceptedCount;
        active[index] <== slotActive[index].out;
        actionId[index][0] * (1 - active[index]) === 0;
        actionId[index][1] * (1 - active[index]) === 0;
        positionCommitment[index] * (1 - active[index]) === 0;

        acceptedLeaves[index] = AcceptedOrderLeaf();
        acceptedLeaves[index].market[0] <== market[0];
        acceptedLeaves[index].market[1] <== market[1];
        acceptedLeaves[index].epoch <== epoch;
        acceptedLeaves[index].sequence <== firstSequence + index;
        acceptedLeaves[index].actionId[0] <== actionId[index][0];
        acceptedLeaves[index].actionId[1] <== actionId[index][1];
        acceptedLeaves[index].positionCommitment <== positionCommitment[index];
        for (var field = 0; field < 8; field++) {
            acceptedLeaves[index].ciphertext[field] <== ciphertext[index][field];
        }
        acceptedLeaves[index].committeeEpoch <== committeeEpoch;

        yesShared[index] = EscalarMulAny(252);
        noShared[index] = EscalarMulAny(252);
        for (var bit = 0; bit < 252; bit++) {
            yesShared[index].e[bit] <== secretBits.out[bit];
            noShared[index].e[bit] <== secretBits.out[bit];
        }
        yesShared[index].p[0] <== ciphertext[index][0];
        yesShared[index].p[1] <== ciphertext[index][1];
        noShared[index].p[0] <== ciphertext[index][4];
        noShared[index].p[1] <== ciphertext[index][5];
        yesSharedDouble0[index] = BabyDbl();
        yesSharedDouble0[index].x <== yesShared[index].out[0];
        yesSharedDouble0[index].y <== yesShared[index].out[1];
        yesSharedDouble1[index] = BabyDbl();
        yesSharedDouble1[index].x <== yesSharedDouble0[index].xout;
        yesSharedDouble1[index].y <== yesSharedDouble0[index].yout;
        yesSharedDouble2[index] = BabyDbl();
        yesSharedDouble2[index].x <== yesSharedDouble1[index].xout;
        yesSharedDouble2[index].y <== yesSharedDouble1[index].yout;
        noSharedDouble0[index] = BabyDbl();
        noSharedDouble0[index].x <== noShared[index].out[0];
        noSharedDouble0[index].y <== noShared[index].out[1];
        noSharedDouble1[index] = BabyDbl();
        noSharedDouble1[index].x <== noSharedDouble0[index].xout;
        noSharedDouble1[index].y <== noSharedDouble0[index].yout;
        noSharedDouble2[index] = BabyDbl();
        noSharedDouble2[index].x <== noSharedDouble1[index].xout;
        noSharedDouble2[index].y <== noSharedDouble1[index].yout;
        yesPlaintext[index] = BabyAdd();
        yesPlaintext[index].x1 <== ciphertext[index][2];
        yesPlaintext[index].y1 <== ciphertext[index][3];
        yesPlaintext[index].x2 <== -yesSharedDouble2[index].xout;
        yesPlaintext[index].y2 <== yesSharedDouble2[index].yout;
        noPlaintext[index] = BabyAdd();
        noPlaintext[index].x1 <== ciphertext[index][6];
        noPlaintext[index].y1 <== ciphertext[index][7];
        noPlaintext[index].x2 <== -noSharedDouble2[index].xout;
        noPlaintext[index].y2 <== noSharedDouble2[index].yout;

        yesAmountBits[index] = Num2Bits(10);
        noAmountBits[index] = Num2Bits(10);
        yesAmountBits[index].in <== yesAmount[index];
        noAmountBits[index].in <== noAmount[index];
        yesAmountBound[index] = LessThan(10);
        yesAmountBound[index].in[0] <== yesAmount[index];
        yesAmountBound[index].in[1] <== 1001;
        yesAmountBound[index].out === 1;
        noAmountBound[index] = LessThan(10);
        noAmountBound[index].in[0] <== noAmount[index];
        noAmountBound[index].in[1] <== 1001;
        noAmountBound[index].out === 1;
        yesMessage[index] = EscalarMulFix(10, BASE8);
        noMessage[index] = EscalarMulFix(10, BASE8);
        for (var bit = 0; bit < 10; bit++) {
            yesMessage[index].e[bit] <== yesAmountBits[index].out[bit];
            noMessage[index].e[bit] <== noAmountBits[index].out[bit];
        }
        yesPlaintext[index].xout === yesMessage[index].out[0];
        yesPlaintext[index].yout === yesMessage[index].out[1];
        noPlaintext[index].xout === noMessage[index].out[0];
        noPlaintext[index].yout === noMessage[index].out[1];
        yesAmountZero[index] = IsZero();
        noAmountZero[index] = IsZero();
        yesAmountZero[index].in <== yesAmount[index];
        noAmountZero[index].in <== noAmount[index];
        yesAmountZero[index].out + noAmountZero[index].out === 2 - active[index];
        side[index] <== active[index] * (1 - yesAmountZero[index].out);
        quantity[index] <== yesAmount[index] + noAmount[index];
        yesTotal += yesAmount[index];
        noTotal += noAmount[index];

        chargePerUnit[index] <== quote[12]
            + side[index] * (quote[11] - quote[12]);
        charge[index] <== chargePerUnit[index] * quantity[index];
        fee[index] <== quote[14] * quantity[index];
        positionPayout[index] <== payout.result * quantity[index];
        allocationLeaves[index] = AllocationLeaf();
        allocationLeaves[index].market[0] <== market[0];
        allocationLeaves[index].market[1] <== market[1];
        allocationLeaves[index].epoch <== epoch;
        allocationLeaves[index].sequence <== firstSequence + index;
        allocationLeaves[index].positionCommitment <== positionCommitment[index];
        allocationLeaves[index].side <== side[index];
        allocationLeaves[index].charge <== charge[index];
        allocationLeaves[index].fee <== fee[index];
        allocationLeaves[index].payout <== positionPayout[index];

        includedLeaves[index] = IncludedPositionLeaf();
        includedLeaves[index].market[0] <== market[0];
        includedLeaves[index].market[1] <== market[1];
        includedLeaves[index].epoch <== epoch;
        includedLeaves[index].sequence <== firstSequence + index;
        includedLeaves[index].positionCommitment <== positionCommitment[index];
    }
    quote[2] === yesTotal;
    quote[3] === noTotal;

    signal acceptedTreeLeaves[64];
    signal allocationTreeLeaves[64];
    signal includedTreeLeaves[64];
    for (var index = 0; index < 64; index++) {
        if (index < 8) {
            acceptedTreeLeaves[index] <== active[index] * acceptedLeaves[index].out;
            allocationTreeLeaves[index] <== active[index] * allocationLeaves[index].out;
            includedTreeLeaves[index] <== active[index] * includedLeaves[index].out;
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

    component yesC1Adds[7];
    component yesC2Adds[7];
    component noC1Adds[7];
    component noC2Adds[7];
    signal yesC1Aggregate[8][2];
    signal yesC2Aggregate[8][2];
    signal noC1Aggregate[8][2];
    signal noC2Aggregate[8][2];
    yesC1Aggregate[0][0] <== ciphertext[0][0];
    yesC1Aggregate[0][1] <== ciphertext[0][1];
    yesC2Aggregate[0][0] <== ciphertext[0][2];
    yesC2Aggregate[0][1] <== ciphertext[0][3];
    noC1Aggregate[0][0] <== ciphertext[0][4];
    noC1Aggregate[0][1] <== ciphertext[0][5];
    noC2Aggregate[0][0] <== ciphertext[0][6];
    noC2Aggregate[0][1] <== ciphertext[0][7];
    for (var index = 1; index < 8; index++) {
        yesC1Adds[index - 1] = BabyAdd();
        yesC1Adds[index - 1].x1 <== yesC1Aggregate[index - 1][0];
        yesC1Adds[index - 1].y1 <== yesC1Aggregate[index - 1][1];
        yesC1Adds[index - 1].x2 <== ciphertext[index][0];
        yesC1Adds[index - 1].y2 <== ciphertext[index][1];
        yesC1Aggregate[index][0] <== yesC1Adds[index - 1].xout;
        yesC1Aggregate[index][1] <== yesC1Adds[index - 1].yout;
        yesC2Adds[index - 1] = BabyAdd();
        yesC2Adds[index - 1].x1 <== yesC2Aggregate[index - 1][0];
        yesC2Adds[index - 1].y1 <== yesC2Aggregate[index - 1][1];
        yesC2Adds[index - 1].x2 <== ciphertext[index][2];
        yesC2Adds[index - 1].y2 <== ciphertext[index][3];
        yesC2Aggregate[index][0] <== yesC2Adds[index - 1].xout;
        yesC2Aggregate[index][1] <== yesC2Adds[index - 1].yout;
        noC1Adds[index - 1] = BabyAdd();
        noC1Adds[index - 1].x1 <== noC1Aggregate[index - 1][0];
        noC1Adds[index - 1].y1 <== noC1Aggregate[index - 1][1];
        noC1Adds[index - 1].x2 <== ciphertext[index][4];
        noC1Adds[index - 1].y2 <== ciphertext[index][5];
        noC1Aggregate[index][0] <== noC1Adds[index - 1].xout;
        noC1Aggregate[index][1] <== noC1Adds[index - 1].yout;
        noC2Adds[index - 1] = BabyAdd();
        noC2Adds[index - 1].x1 <== noC2Aggregate[index - 1][0];
        noC2Adds[index - 1].y1 <== noC2Aggregate[index - 1][1];
        noC2Adds[index - 1].x2 <== ciphertext[index][6];
        noC2Adds[index - 1].y2 <== ciphertext[index][7];
        noC2Aggregate[index][0] <== noC2Adds[index - 1].xout;
        noC2Aggregate[index][1] <== noC2Adds[index - 1].yout;
    }
    aggregateCiphertext[0] === yesC1Aggregate[7][0];
    aggregateCiphertext[1] === yesC1Aggregate[7][1];
    aggregateCiphertext[2] === yesC2Aggregate[7][0];
    aggregateCiphertext[3] === yesC2Aggregate[7][1];
    aggregateCiphertext[4] === noC1Aggregate[7][0];
    aggregateCiphertext[5] === noC1Aggregate[7][1];
    aggregateCiphertext[6] === noC2Aggregate[7][0];
    aggregateCiphertext[7] === noC2Aggregate[7][1];

    signal yesCollected;
    signal noCollected;
    yesCollected <== quote[11] * quote[2];
    noCollected <== quote[12] * quote[3];
    signal yesRemainder;
    signal noRemainder;
    yesRemainder <== quote[9] - yesCollected;
    noRemainder <== quote[10] - noCollected;
    component yesRemainderRange = Num2Bits(14);
    yesRemainderRange.in <== yesRemainder;
    component noRemainderRange = Num2Bits(14);
    noRemainderRange.in <== noRemainder;
    component yesRemainderBound = LessThan(14);
    yesRemainderBound.in[0] <== yesRemainder;
    yesRemainderBound.in[1] <== quote[2];
    component yesCountZero = IsZero();
    yesCountZero.in <== quote[2];
    yesRemainderBound.out + yesCountZero.out === 1;
    yesRemainder * yesCountZero.out === 0;
    component noRemainderBound = LessThan(14);
    noRemainderBound.in[0] <== noRemainder;
    noRemainderBound.in[1] <== quote[3];
    component noCountZero = IsZero();
    noCountZero.in <== quote[3];
    noRemainderBound.out + noCountZero.out === 1;
    noRemainder * noCountZero.out === 0;
    quote[8] === quote[9] + quote[10];
    quote[13] === yesRemainder + noRemainder;
    quote[15] === quote[14] * quote[1];
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
