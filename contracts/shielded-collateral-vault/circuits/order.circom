pragma circom 2.2.3;

include "./privacy_primitives.circom";

template CeilDivConstant(denominator, numeratorBits, remainderBits) {
    signal input numerator;
    signal output result;
    signal quotient;
    signal remainder;

    quotient <-- numerator \ denominator;
    remainder <-- numerator % denominator;
    numerator === quotient * denominator + remainder;

    component numeratorRange = Num2Bits(numeratorBits);
    numeratorRange.in <== numerator;
    component quotientRange = Num2Bits(60);
    quotientRange.in <== quotient;
    component remainderRange = Num2Bits(remainderBits);
    remainderRange.in <== remainder;
    component remainderBound = LessThan(remainderBits);
    remainderBound.in[0] <== remainder;
    remainderBound.in[1] <== denominator;
    remainderBound.out === 1;
    component exact = IsZero();
    exact.in <== remainder;
    result <== quotient + 1 - exact.out;
}

template PrivateOrder(noteLevels, acceptedLevels) {
    signal input action;
    signal input contextDigest;
    signal input membershipRoot;
    signal input appendRoot;
    signal input newRoot;
    signal input nullifierCount;
    signal input nullifier0;
    signal input nullifier1;
    signal input outputCommitment0;
    signal input outputCommitment1;
    signal input outputEnvelopeHash0;
    signal input outputEnvelopeHash1;
    signal input firstLeafIndex;
    signal input publicAmountSign;
    signal input publicAmountMagnitude;

    signal input contextFields[46];
    signal input side;
    signal input encryptionRandomness;
    signal input acceptedSiblings[acceptedLevels];

    signal input inPurpose[2];
    signal input inAmount[2];
    signal input inSpendSecret[2];
    signal input inViewingPublicKey[2][2];
    signal input inNoteId[2];
    signal input inPayloadHash[2];
    signal input inPrivateData[2][2];
    signal input inBlinding[2];
    signal input inLeafIndex[2];
    signal input inSiblings[2][noteLevels];

    signal input outPurpose[2];
    signal input outAmount[2];
    signal input outSpendPublicKey[2];
    signal input outViewingPublicKey[2][2];
    signal input outNoteId[2];
    signal input outPayloadHash[2];
    signal input outPrivateData[2][2];
    signal input outBlinding[2];
    signal input outEphemeralSecret[2];
    signal input outNonce[2];
    signal input outEnvelope[2][15];
    signal input appendSiblings[noteLevels - 1];

    action === 3;
    nullifierCount === 2;
    publicAmountSign === 0;
    publicAmountMagnitude === 0;
    contextFields[0] === 1;
    contextFields[9] === action;
    contextFields[12] === 0;
    contextFields[13] === 0;
    contextFields[14] === 0;
    contextFields[15] === 0;
    contextFields[16] === 0;
    contextFields[17] === 1;
    contextFields[20] === contextFields[32];
    contextFields[21] === 2;
    contextFields[24] === outputCommitment1;

    component contextHash = Poseidon2Sponge(46);
    for (var field = 0; field < 46; field++) {
        contextHash.inputs[field] <== contextFields[field];
    }
    contextHash.out === contextDigest;

    component noteDomain = NoteDomain();
    noteDomain.network[0] <== contextFields[1];
    noteDomain.network[1] <== contextFields[2];
    noteDomain.vault[0] <== contextFields[3];
    noteDomain.vault[1] <== contextFields[4];
    noteDomain.token[0] <== contextFields[5];
    noteDomain.token[1] <== contextFields[6];
    noteDomain.verifier[0] <== contextFields[7];
    noteDomain.verifier[1] <== contextFields[8];

    component sideBits = Num2Bits(1);
    sideBits.in <== side;
    component lotRange = Num2Bits(60);
    lotRange.in <== contextFields[25];
    component lotZero = IsZero();
    lotZero.in <== contextFields[25];
    lotZero.out === 0;
    component feeRateRange = Num2Bits(10);
    feeRateRange.in <== contextFields[26];
    component acceptedIndexRange = Num2Bits(acceptedLevels);
    acceptedIndexRange.in <== contextFields[44];

    component payout = CeilDivConstant(4294967296, 84, 33);
    payout.numerator <== contextFields[25] * 10000000;
    component maximumFee = CeilDivConstant(171798691840000, 96, 49);
    maximumFee.numerator <== contextFields[25] * contextFields[26] * 10000000;
    signal positionBudget;
    positionBudget <== payout.result + maximumFee.result;
    component positionBudgetRange = Num2Bits(60);
    positionBudgetRange.in <== positionBudget;

    component inputs[2];
    component inputPurposeChecks[2][4];
    component inputAmountRanges[2];
    component inputAmountZero[2];
    component inputSecretZero[2];
    var totalInput = 0;
    for (var index = 0; index < 2; index++) {
        inputs[index] = InputNote(noteLevels, 1);
        inputs[index].noteDomain <== noteDomain.out;
        inputs[index].membershipRoot <== membershipRoot;
        inputs[index].purpose <== inPurpose[index];
        inputs[index].amount <== inAmount[index];
        inputs[index].spendSecret <== inSpendSecret[index];
        inputs[index].viewingPublicKey[0] <== inViewingPublicKey[index][0];
        inputs[index].viewingPublicKey[1] <== inViewingPublicKey[index][1];
        inputs[index].noteId <== inNoteId[index];
        inputs[index].payloadHash <== inPayloadHash[index];
        inputs[index].privateData[0] <== inPrivateData[index][0];
        inputs[index].privateData[1] <== inPrivateData[index][1];
        inputs[index].blinding <== inBlinding[index];
        inputs[index].leafIndex <== inLeafIndex[index];
        for (var level = 0; level < noteLevels; level++) {
            inputs[index].siblings[level] <== inSiblings[index][level];
        }
        if (index == 0) {
            inputs[index].expectedNullifier <== nullifier0;
        } else {
            inputs[index].expectedNullifier <== nullifier1;
        }

        var purposes[4] = [0, 1, 6, 7];
        for (var purposeIndex = 0; purposeIndex < 4; purposeIndex++) {
            inputPurposeChecks[index][purposeIndex] = IsEqual();
            inputPurposeChecks[index][purposeIndex].in[0] <== inPurpose[index];
            inputPurposeChecks[index][purposeIndex].in[1] <== purposes[purposeIndex];
        }
        inputPurposeChecks[index][0].out
            + inputPurposeChecks[index][1].out
            + inputPurposeChecks[index][2].out
            + inputPurposeChecks[index][3].out === 1;
        inputAmountRanges[index] = Num2Bits(60);
        inputAmountRanges[index].in <== inAmount[index];
        inputAmountZero[index] = IsZero();
        inputAmountZero[index].in <== inAmount[index];
        inputAmountZero[index].out === inputPurposeChecks[index][0].out;
        inputSecretZero[index] = IsZero();
        inputSecretZero[index].in <== inSpendSecret[index];
        inputSecretZero[index].out === 0;
        totalInput += inAmount[index];
    }

    component distinctNullifiers = IsEqual();
    distinctNullifiers.in[0] <== nullifier0;
    distinctNullifiers.in[1] <== nullifier1;
    distinctNullifiers.out === 0;

    component outputs[2];
    component outputSpendKeyZero[2];
    component outputNoteIdZero[2];
    component outputBlindingZero[2];
    for (var index = 0; index < 2; index++) {
        outputs[index] = OutputNote(index);
        outputs[index].noteDomain <== noteDomain.out;
        outputs[index].purpose <== outPurpose[index];
        outputs[index].amount <== outAmount[index];
        outputs[index].spendPublicKey <== outSpendPublicKey[index];
        outputs[index].viewingPublicKey[0] <== outViewingPublicKey[index][0];
        outputs[index].viewingPublicKey[1] <== outViewingPublicKey[index][1];
        outputs[index].noteId <== outNoteId[index];
        outputs[index].payloadHash <== outPayloadHash[index];
        outputs[index].privateData[0] <== outPrivateData[index][0];
        outputs[index].privateData[1] <== outPrivateData[index][1];
        outputs[index].blinding <== outBlinding[index];
        outputs[index].ephemeralSecret <== outEphemeralSecret[index];
        outputs[index].nonce <== outNonce[index];
        for (var envelopeField = 0; envelopeField < 15; envelopeField++) {
            outputs[index].envelope[envelopeField] <== outEnvelope[index][envelopeField];
        }
        outputSpendKeyZero[index] = IsZero();
        outputSpendKeyZero[index].in <== outSpendPublicKey[index];
        outputSpendKeyZero[index].out === 0;
        outputNoteIdZero[index] = IsZero();
        outputNoteIdZero[index].in <== outNoteId[index];
        outputNoteIdZero[index].out === 0;
        outputBlindingZero[index] = IsZero();
        outputBlindingZero[index].in <== outBlinding[index];
        outputBlindingZero[index].out === 0;
    }

    component changePurpose = Num2Bits(1);
    changePurpose.in <== outPurpose[0];
    component changeAmountRange = Num2Bits(60);
    changeAmountRange.in <== outAmount[0];
    component changeAmountZero = IsZero();
    changeAmountZero.in <== outAmount[0];
    changeAmountZero.out === 1 - outPurpose[0];
    outPayloadHash[0] === 0;
    outPrivateData[0][0] === 0;
    outPrivateData[0][1] === 0;

    outPurpose[1] === 2;
    outAmount[1] === positionBudget;
    component marketPositionDomain = Poseidon2Sponge(7);
    marketPositionDomain.inputs[0] <== 1010;
    marketPositionDomain.inputs[1] <== contextFields[18];
    marketPositionDomain.inputs[2] <== contextFields[19];
    marketPositionDomain.inputs[3] <== contextFields[22];
    marketPositionDomain.inputs[4] <== contextFields[30];
    marketPositionDomain.inputs[5] <== contextFields[31];
    marketPositionDomain.inputs[6] <== contextFields[25];
    outPayloadHash[1] === marketPositionDomain.out;
    outPrivateData[1][0] === side;
    outPrivateData[1][1] === contextFields[45];
    totalInput === outAmount[0] + positionBudget;

    outputs[0].commitment === outputCommitment0;
    outputs[1].commitment === outputCommitment1;
    outputs[0].envelopeHash === outputEnvelopeHash0;
    outputs[1].envelopeHash === outputEnvelopeHash1;
    component distinctOutputs = IsEqual();
    distinctOutputs.in[0] <== outputCommitment0;
    distinctOutputs.in[1] <== outputCommitment1;
    distinctOutputs.out === 0;

    component noteAppend = AppendTwo(noteLevels);
    noteAppend.appendRoot <== appendRoot;
    noteAppend.newRoot <== newRoot;
    noteAppend.firstLeafIndex <== firstLeafIndex;
    noteAppend.outputCommitments[0] <== outputCommitment0;
    noteAppend.outputCommitments[1] <== outputCommitment1;
    for (var level = 0; level < noteLevels - 1; level++) {
        noteAppend.siblings[level] <== appendSiblings[level];
    }

    component committeeCheck = BabyCheck();
    committeeCheck.x <== contextFields[36];
    committeeCheck.y <== contextFields[37];
    component committeeDouble0 = BabyDbl();
    committeeDouble0.x <== contextFields[36];
    committeeDouble0.y <== contextFields[37];
    component committeeDouble1 = BabyDbl();
    committeeDouble1.x <== committeeDouble0.xout;
    committeeDouble1.y <== committeeDouble0.yout;
    component committeeDouble2 = BabyDbl();
    committeeDouble2.x <== committeeDouble1.xout;
    committeeDouble2.y <== committeeDouble1.yout;
    component committeeIdentity = IsZero();
    committeeIdentity.in <== committeeDouble2.xout;
    committeeIdentity.out === 0;

    component encryptionBits = Num2Bits(253);
    encryptionBits.in <== encryptionRandomness;
    for (var bit = 248; bit < 253; bit++) {
        encryptionBits.out[bit] === 0;
    }
    component encryptionZero = IsZero();
    encryptionZero.in <== encryptionRandomness;
    encryptionZero.out === 0;

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    component c1 = EscalarMulFix(253, BASE8);
    component shared = EscalarMulAny(248);
    for (var bit = 0; bit < 253; bit++) {
        c1.e[bit] <== encryptionBits.out[bit];
        if (bit < 248) {
            shared.e[bit] <== encryptionBits.out[bit];
        }
    }
    shared.p[0] <== committeeDouble2.xout;
    shared.p[1] <== committeeDouble2.yout;

    signal sidePoint[2];
    sidePoint[0] <== side * BASE8[0];
    sidePoint[1] <== 1 + side * (BASE8[1] - 1);
    component c2 = BabyAdd();
    c2.x1 <== shared.out[0];
    c2.y1 <== shared.out[1];
    c2.x2 <== sidePoint[0];
    c2.y2 <== sidePoint[1];
    component c2Identity = IsZero();
    c2Identity.in <== c2.xout;
    c2Identity.out === 0;

    contextFields[38] === c1.out[0];
    contextFields[39] === c1.out[1];
    contextFields[40] === c2.xout;
    contextFields[41] === c2.yout;

    component acceptedLeaf = AcceptedOrderLeaf();
    acceptedLeaf.market[0] <== contextFields[18];
    acceptedLeaf.market[1] <== contextFields[19];
    acceptedLeaf.epoch <== contextFields[22];
    acceptedLeaf.sequence <== contextFields[45];
    acceptedLeaf.actionId[0] <== contextFields[10];
    acceptedLeaf.actionId[1] <== contextFields[11];
    acceptedLeaf.positionCommitment <== outputCommitment1;
    acceptedLeaf.ciphertext[0] <== contextFields[38];
    acceptedLeaf.ciphertext[1] <== contextFields[39];
    acceptedLeaf.ciphertext[2] <== contextFields[40];
    acceptedLeaf.ciphertext[3] <== contextFields[41];
    acceptedLeaf.committeeEpoch <== contextFields[33];

    component acceptedAppend = AppendOne(acceptedLevels);
    acceptedAppend.appendRoot <== contextFields[42];
    acceptedAppend.newRoot <== contextFields[43];
    acceptedAppend.leafIndex <== contextFields[44];
    acceptedAppend.commitment <== acceptedLeaf.out;
    for (var level = 0; level < acceptedLevels; level++) {
        acceptedAppend.siblings[level] <== acceptedSiblings[level];
    }
}

component main { public [
    action,
    contextDigest,
    membershipRoot,
    appendRoot,
    newRoot,
    nullifierCount,
    nullifier0,
    nullifier1,
    outputCommitment0,
    outputCommitment1,
    outputEnvelopeHash0,
    outputEnvelopeHash1,
    firstLeafIndex,
    publicAmountSign,
    publicAmountMagnitude
] } = PrivateOrder(20, 6);
