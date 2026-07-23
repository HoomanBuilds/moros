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
    signal input quantity;
    signal input yesEncryptionRandomness;
    signal input noEncryptionRandomness;
    signal input ciphertext[8];
    signal input acceptedSiblings[acceptedLevels];

    signal input inPurpose[1];
    signal input inAmount[1];
    signal input inSpendSecret[1];
    signal input inViewingPublicKey[1][2];
    signal input inNoteId[1];
    signal input inPayloadHash[1];
    signal input inPrivateData[1][2];
    signal input inBlinding[1];
    signal input inLeafIndex[1];
    signal input inSiblings[1][noteLevels];

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
    nullifierCount === 1;
    nullifier1 === 0;
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
    acceptedIndexRange.in <== contextFields[41];
    component quantityRange = Num2Bits(10);
    quantityRange.in <== quantity;
    component quantityBound = LessThan(10);
    quantityBound.in[0] <== quantity;
    quantityBound.in[1] <== 1001;
    quantityBound.out === 1;
    component quantityZero = IsZero();
    quantityZero.in <== quantity;
    quantityZero.out === 0;

    component payout = CeilDivConstant(4294967296, 84, 33);
    payout.numerator <== contextFields[25] * 10000000;
    component maximumFee = CeilDivConstant(171798691840000, 96, 49);
    maximumFee.numerator <== contextFields[25] * contextFields[26] * 10000000;
    signal positionBudget;
    positionBudget <== (payout.result + maximumFee.result) * quantity;
    component positionBudgetRange = Num2Bits(60);
    positionBudgetRange.in <== positionBudget;

    component inputs[1];
    component inputPurposeChecks[1][3];
    component inputAmountRanges[1];
    component inputAmountZero[1];
    component inputSecretZero[1];
    var totalInput = 0;
    for (var index = 0; index < 1; index++) {
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
        inputs[index].expectedNullifier <== nullifier0;

        var purposes[3] = [1, 6, 7];
        for (var purposeIndex = 0; purposeIndex < 3; purposeIndex++) {
            inputPurposeChecks[index][purposeIndex] = IsEqual();
            inputPurposeChecks[index][purposeIndex].in[0] <== inPurpose[index];
            inputPurposeChecks[index][purposeIndex].in[1] <== purposes[purposeIndex];
        }
        inputPurposeChecks[index][0].out
            + inputPurposeChecks[index][1].out
            + inputPurposeChecks[index][2].out === 1;
        inputAmountRanges[index] = Num2Bits(60);
        inputAmountRanges[index].in <== inAmount[index];
        inputAmountZero[index] = IsZero();
        inputAmountZero[index].in <== inAmount[index];
        inputAmountZero[index].out === 0;
        inputSecretZero[index] = IsZero();
        inputSecretZero[index].in <== inSpendSecret[index];
        inputSecretZero[index].out === 0;
        totalInput += inAmount[index];
    }

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
    outPrivateData[1][1] === contextFields[42] * 1024 + quantity;
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

    component yesEncryptionBits = Num2Bits(253);
    component noEncryptionBits = Num2Bits(253);
    yesEncryptionBits.in <== yesEncryptionRandomness;
    noEncryptionBits.in <== noEncryptionRandomness;
    for (var bit = 248; bit < 253; bit++) {
        yesEncryptionBits.out[bit] === 0;
        noEncryptionBits.out[bit] === 0;
    }
    component yesEncryptionZero = IsZero();
    component noEncryptionZero = IsZero();
    yesEncryptionZero.in <== yesEncryptionRandomness;
    noEncryptionZero.in <== noEncryptionRandomness;
    yesEncryptionZero.out === 0;
    noEncryptionZero.out === 0;

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    component yesC1 = EscalarMulFix(253, BASE8);
    component noC1 = EscalarMulFix(253, BASE8);
    component yesShared = EscalarMulAny(248);
    component noShared = EscalarMulAny(248);
    for (var bit = 0; bit < 253; bit++) {
        yesC1.e[bit] <== yesEncryptionBits.out[bit];
        noC1.e[bit] <== noEncryptionBits.out[bit];
        if (bit < 248) {
            yesShared.e[bit] <== yesEncryptionBits.out[bit];
            noShared.e[bit] <== noEncryptionBits.out[bit];
        }
    }
    yesShared.p[0] <== committeeDouble2.xout;
    yesShared.p[1] <== committeeDouble2.yout;
    noShared.p[0] <== committeeDouble2.xout;
    noShared.p[1] <== committeeDouble2.yout;

    signal yesAmount;
    signal noAmount;
    yesAmount <== side * quantity;
    noAmount <== (1 - side) * quantity;
    component yesAmountBits = Num2Bits(10);
    component noAmountBits = Num2Bits(10);
    yesAmountBits.in <== yesAmount;
    noAmountBits.in <== noAmount;
    component yesMessage = EscalarMulFix(10, BASE8);
    component noMessage = EscalarMulFix(10, BASE8);
    for (var bit = 0; bit < 10; bit++) {
        yesMessage.e[bit] <== yesAmountBits.out[bit];
        noMessage.e[bit] <== noAmountBits.out[bit];
    }
    component yesC2 = BabyAdd();
    yesC2.x1 <== yesShared.out[0];
    yesC2.y1 <== yesShared.out[1];
    yesC2.x2 <== yesMessage.out[0];
    yesC2.y2 <== yesMessage.out[1];
    component noC2 = BabyAdd();
    noC2.x1 <== noShared.out[0];
    noC2.y1 <== noShared.out[1];
    noC2.x2 <== noMessage.out[0];
    noC2.y2 <== noMessage.out[1];
    component yesC2Identity = IsZero();
    component noC2Identity = IsZero();
    yesC2Identity.in <== yesC2.xout;
    noC2Identity.in <== noC2.xout;
    yesC2Identity.out === 0;
    noC2Identity.out === 0;

    ciphertext[0] === yesC1.out[0];
    ciphertext[1] === yesC1.out[1];
    ciphertext[2] === yesC2.xout;
    ciphertext[3] === yesC2.yout;
    ciphertext[4] === noC1.out[0];
    ciphertext[5] === noC1.out[1];
    ciphertext[6] === noC2.xout;
    ciphertext[7] === noC2.yout;
    component ciphertextHash = Poseidon2Sponge(9);
    ciphertextHash.inputs[0] <== 1016;
    for (var field = 0; field < 8; field++) {
        ciphertextHash.inputs[field + 1] <== ciphertext[field];
    }
    ciphertextHash.out === contextFields[38];
    contextFields[43] === 0;
    contextFields[44] === 0;
    contextFields[45] === 0;

    component acceptedLeaf = AcceptedOrderLeaf();
    acceptedLeaf.market[0] <== contextFields[18];
    acceptedLeaf.market[1] <== contextFields[19];
    acceptedLeaf.epoch <== contextFields[22];
    acceptedLeaf.sequence <== contextFields[42];
    acceptedLeaf.actionId[0] <== contextFields[10];
    acceptedLeaf.actionId[1] <== contextFields[11];
    acceptedLeaf.positionCommitment <== outputCommitment1;
    for (var field = 0; field < 8; field++) {
        acceptedLeaf.ciphertext[field] <== ciphertext[field];
    }
    acceptedLeaf.committeeEpoch <== contextFields[33];

    component acceptedAppend = AppendOne(acceptedLevels);
    acceptedAppend.appendRoot <== contextFields[39];
    acceptedAppend.newRoot <== contextFields[40];
    acceptedAppend.leafIndex <== contextFields[41];
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
