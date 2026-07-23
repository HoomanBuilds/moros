pragma circom 2.2.3;

include "./privacy_primitives.circom";

template PrivateExitMatch(levels) {
    signal input action;
    signal input contextDigest;
    signal input membershipRoot;
    signal input appendRoot;
    signal input newRoot;
    signal input nullifierCount;
    signal input nullifier0;
    signal input nullifier1;
    signal input nullifier2;
    signal input outputCommitment0;
    signal input outputCommitment1;
    signal input outputCommitment2;
    signal input outputCommitment3;
    signal input outputEnvelopeHash0;
    signal input outputEnvelopeHash1;
    signal input outputEnvelopeHash2;
    signal input outputEnvelopeHash3;
    signal input firstLeafIndex;
    signal input publicAmountSign;
    signal input publicAmountMagnitude;

    signal input contextFields[46];

    signal input inPurpose[3];
    signal input inAmount[3];
    signal input inSpendSecret[3];
    signal input inViewingPublicKey[3][2];
    signal input inNoteId[3];
    signal input inPayloadHash[3];
    signal input inPrivateData[3][2];
    signal input inBlinding[3];
    signal input inLeafIndex[3];
    signal input inSiblings[3][levels];

    signal input outPurpose[4];
    signal input outAmount[4];
    signal input outSpendPublicKey[4];
    signal input outViewingPublicKey[4][2];
    signal input outNoteId[4];
    signal input outPayloadHash[4];
    signal input outPrivateData[4][2];
    signal input outBlinding[4];
    signal input outEphemeralSecret[4];
    signal input outNonce[4];
    signal input outEnvelope[4][15];
    signal input middleRoot;
    signal input appendSiblings0[levels - 1];
    signal input appendSiblings1[levels - 1];

    action === 13;
    nullifierCount === 3;
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
    contextFields[21] === 8;

    component limbRanges[10];
    for (var index = 0; index < 2; index++) {
        limbRanges[index] = Num2Bits(128);
        limbRanges[index].in <== contextFields[22 + index];
        limbRanges[2 + index] = Num2Bits(128);
        limbRanges[2 + index].in <== contextFields[24 + index];
        limbRanges[4 + index] = Num2Bits(128);
        limbRanges[4 + index].in <== contextFields[30 + index];
        limbRanges[6 + index] = Num2Bits(128);
        limbRanges[6 + index].in <== contextFields[42 + index];
    }
    component amountRanges[11];
    var amountFields[11] = [26, 27, 28, 29, 34, 35, 36, 40, 41, 44, 45];
    for (var index = 0; index < 10; index++) {
        amountRanges[index] = Num2Bits(60);
        amountRanges[index].in <== contextFields[amountFields[index]];
    }
    amountRanges[10] = Num2Bits(64);
    amountRanges[10].in <== contextFields[45];
    component fillZero = IsZero();
    fillZero.in <== contextFields[26];
    fillZero.out === 0;
    component paymentZero = IsZero();
    paymentZero.in <== contextFields[27];
    paymentZero.out === 0;
    component currentSharesZero = IsZero();
    currentSharesZero.in <== contextFields[28];
    currentSharesZero.out === 0;
    component timeRanges[7];
    var timeFields[7] = [32, 33, 37, 38, 39, 45, 20];
    for (var index = 0; index < 7; index++) {
        timeRanges[index] = Num2Bits(64);
        timeRanges[index].in <== contextFields[timeFields[index]];
    }
    component maximumAgeZero = IsZero();
    maximumAgeZero.in <== contextFields[38];
    maximumAgeZero.out === 0;

    signal destination;
    destination <== contextFields[30] * 340282366920938463463374607431768211456
        + contextFields[31];
    signal remainingDestination;
    remainingDestination <== contextFields[42] * 340282366920938463463374607431768211456
        + contextFields[43];

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

    component liquidityPayload = Poseidon2Sponge(3);
    liquidityPayload.inputs[0] <== 1011;
    liquidityPayload.inputs[1] <== contextFields[22];
    liquidityPayload.inputs[2] <== contextFields[23];
    component exitPayload = Poseidon2Sponge(5);
    exitPayload.inputs[0] <== 1014;
    exitPayload.inputs[1] <== contextFields[22];
    exitPayload.inputs[2] <== contextFields[23];
    exitPayload.inputs[3] <== contextFields[24];
    exitPayload.inputs[4] <== contextFields[25];

    component exitInput = InputNote(levels, 5);
    exitInput.noteDomain <== noteDomain.out;
    exitInput.membershipRoot <== membershipRoot;
    exitInput.purpose <== inPurpose[0];
    exitInput.amount <== inAmount[0];
    exitInput.spendSecret <== inSpendSecret[0];
    exitInput.viewingPublicKey[0] <== inViewingPublicKey[0][0];
    exitInput.viewingPublicKey[1] <== inViewingPublicKey[0][1];
    exitInput.noteId <== inNoteId[0];
    exitInput.payloadHash <== inPayloadHash[0];
    exitInput.privateData[0] <== inPrivateData[0][0];
    exitInput.privateData[1] <== inPrivateData[0][1];
    exitInput.blinding <== inBlinding[0];
    exitInput.leafIndex <== inLeafIndex[0];
    for (var level = 0; level < levels; level++) {
        exitInput.siblings[level] <== inSiblings[0][level];
    }
    exitInput.expectedNullifier <== nullifier0;
    inPurpose[0] === 9;
    inAmount[0] === contextFields[28];
    inPayloadHash[0] === exitPayload.out;
    inPrivateData[0][0] === contextFields[29];
    inPrivateData[0][1] === contextFields[32];
    exitInput.commitment === destination;

    component buyerInputs[2];
    component buyerPadding[2];
    component buyerLiquid[2][3];
    component buyerAmountRanges[2];
    component buyerAmountZero[2];
    component buyerSecretZero[2];
    var buyerTotal = 0;
    for (var offset = 0; offset < 2; offset++) {
        var index = offset + 1;
        buyerInputs[offset] = InputNote(levels, 1);
        buyerInputs[offset].noteDomain <== noteDomain.out;
        buyerInputs[offset].membershipRoot <== membershipRoot;
        buyerInputs[offset].purpose <== inPurpose[index];
        buyerInputs[offset].amount <== inAmount[index];
        buyerInputs[offset].spendSecret <== inSpendSecret[index];
        buyerInputs[offset].viewingPublicKey[0] <== inViewingPublicKey[index][0];
        buyerInputs[offset].viewingPublicKey[1] <== inViewingPublicKey[index][1];
        buyerInputs[offset].noteId <== inNoteId[index];
        buyerInputs[offset].payloadHash <== inPayloadHash[index];
        buyerInputs[offset].privateData[0] <== inPrivateData[index][0];
        buyerInputs[offset].privateData[1] <== inPrivateData[index][1];
        buyerInputs[offset].blinding <== inBlinding[index];
        buyerInputs[offset].leafIndex <== inLeafIndex[index];
        for (var level = 0; level < levels; level++) {
            buyerInputs[offset].siblings[level] <== inSiblings[index][level];
        }
        if (offset == 0) {
            buyerInputs[offset].expectedNullifier <== nullifier1;
        } else {
            buyerInputs[offset].expectedNullifier <== nullifier2;
        }
        buyerPadding[offset] = IsEqual();
        buyerPadding[offset].in[0] <== inPurpose[index];
        buyerPadding[offset].in[1] <== 0;
        for (var purposeIndex = 0; purposeIndex < 3; purposeIndex++) {
            buyerLiquid[offset][purposeIndex] = IsEqual();
            buyerLiquid[offset][purposeIndex].in[0] <== inPurpose[index];
            buyerLiquid[offset][purposeIndex].in[1] <== purposeIndex == 0 ? 1 : purposeIndex + 5;
        }
        buyerPadding[offset].out
            + buyerLiquid[offset][0].out
            + buyerLiquid[offset][1].out
            + buyerLiquid[offset][2].out === 1;
        inPayloadHash[index] === 0;
        inPrivateData[index][0] === 0;
        inPrivateData[index][1] === 0;
        buyerAmountRanges[offset] = Num2Bits(60);
        buyerAmountRanges[offset].in <== inAmount[index];
        buyerAmountZero[offset] = IsZero();
        buyerAmountZero[offset].in <== inAmount[index];
        buyerAmountZero[offset].out === buyerPadding[offset].out;
        buyerSecretZero[offset] = IsZero();
        buyerSecretZero[offset].in <== inSpendSecret[index];
        buyerSecretZero[offset].out === 0;
        buyerTotal += inAmount[index];
    }

    component distinctNullifiers01 = IsEqual();
    distinctNullifiers01.in[0] <== nullifier0;
    distinctNullifiers01.in[1] <== nullifier1;
    distinctNullifiers01.out === 0;
    component distinctNullifiers02 = IsEqual();
    distinctNullifiers02.in[0] <== nullifier0;
    distinctNullifiers02.in[1] <== nullifier2;
    distinctNullifiers02.out === 0;
    component distinctNullifiers12 = IsEqual();
    distinctNullifiers12.in[0] <== nullifier1;
    distinctNullifiers12.in[1] <== nullifier2;
    distinctNullifiers12.out === 0;

    signal minimumNumerator;
    signal minimumQuotient;
    signal minimumRemainder;
    minimumNumerator <== contextFields[29] * contextFields[26];
    minimumQuotient <-- minimumNumerator \ contextFields[28];
    minimumRemainder <-- minimumNumerator % contextFields[28];
    minimumNumerator === minimumQuotient * contextFields[28] + minimumRemainder;
    component minimumNumeratorRange = Num2Bits(120);
    minimumNumeratorRange.in <== minimumNumerator;
    component minimumQuotientRange = Num2Bits(60);
    minimumQuotientRange.in <== minimumQuotient;
    component minimumRemainderRange = Num2Bits(60);
    minimumRemainderRange.in <== minimumRemainder;
    component remainderBound = LessThan(61);
    remainderBound.in[0] <== minimumRemainder;
    remainderBound.in[1] <== contextFields[28];
    remainderBound.out === 1;
    component remainderZero = IsZero();
    remainderZero.in <== minimumRemainder;
    contextFields[40] === minimumQuotient + 1 - remainderZero.out;
    contextFields[29] === contextFields[40] + contextFields[41];
    contextFields[28] === contextFields[26] + contextFields[44];
    component underMinimum = LessThan(61);
    underMinimum.in[0] <== contextFields[27];
    underMinimum.in[1] <== contextFields[40];
    underMinimum.out === 0;

    component outputs[4];
    component outputAmountRanges[4];
    component outputSpendKeyZero[4];
    component outputNoteIdZero[4];
    component outputBlindingZero[4];
    for (var index = 0; index < 4; index++) {
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
        outputAmountRanges[index] = Num2Bits(60);
        outputAmountRanges[index].in <== outAmount[index];
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

    component sellerSpendKey = SpendPublicKey();
    sellerSpendKey.secret <== inSpendSecret[0];
    component sellerSecretZero = IsZero();
    sellerSecretZero.in <== inSpendSecret[0];
    sellerSecretZero.out === 0;
    outPurpose[0] === 1;
    outAmount[0] === contextFields[27];
    outSpendPublicKey[0] === sellerSpendKey.out;
    outViewingPublicKey[0][0] === inViewingPublicKey[0][0];
    outViewingPublicKey[0][1] === inViewingPublicKey[0][1];
    outPayloadHash[0] === 0;
    outPrivateData[0][0] === 0;
    outPrivateData[0][1] === 0;

    outPurpose[1] === 3;
    outAmount[1] === contextFields[26];
    outPayloadHash[1] === liquidityPayload.out;
    outPrivateData[1][0] === 0;
    outPrivateData[1][1] === 0;

    component buyerChangeZero = IsZero();
    buyerChangeZero.in <== outAmount[2];
    outPurpose[2] === 1 - buyerChangeZero.out;
    outPayloadHash[2] === 0;
    outPrivateData[2][0] === 0;
    outPrivateData[2][1] === 0;
    buyerTotal === contextFields[27] + outAmount[2];

    component remainingZero = IsZero();
    remainingZero.in <== contextFields[44];
    outPurpose[3] === 9 * (1 - remainingZero.out);
    outAmount[3] === contextFields[44];
    outSpendPublicKey[3] === sellerSpendKey.out;
    outViewingPublicKey[3][0] === inViewingPublicKey[0][0];
    outViewingPublicKey[3][1] === inViewingPublicKey[0][1];
    outPayloadHash[3] === (1 - remainingZero.out) * exitPayload.out;
    outPrivateData[3][0] === contextFields[41];
    outPrivateData[3][1] === (1 - remainingZero.out) * contextFields[32];
    (1 - remainingZero.out) * (outputCommitment3 - remainingDestination) === 0;
    remainingZero.out * contextFields[41] === 0;
    remainingZero.out * contextFields[42] === 0;
    remainingZero.out * contextFields[43] === 0;

    outputs[0].commitment === outputCommitment0;
    outputs[1].commitment === outputCommitment1;
    outputs[2].commitment === outputCommitment2;
    outputs[3].commitment === outputCommitment3;
    outputs[0].envelopeHash === outputEnvelopeHash0;
    outputs[1].envelopeHash === outputEnvelopeHash1;
    outputs[2].envelopeHash === outputEnvelopeHash2;
    outputs[3].envelopeHash === outputEnvelopeHash3;
    component distinctOutputs[6];
    var pair = 0;
    for (var left = 0; left < 4; left++) {
        for (var right = left + 1; right < 4; right++) {
            distinctOutputs[pair] = IsEqual();
            distinctOutputs[pair].in[0] <== outputs[left].commitment;
            distinctOutputs[pair].in[1] <== outputs[right].commitment;
            distinctOutputs[pair].out === 0;
            pair++;
        }
    }

    component appendFirst = AppendTwo(levels);
    appendFirst.appendRoot <== appendRoot;
    appendFirst.newRoot <== middleRoot;
    appendFirst.firstLeafIndex <== firstLeafIndex;
    appendFirst.outputCommitments[0] <== outputCommitment0;
    appendFirst.outputCommitments[1] <== outputCommitment1;
    component appendSecond = AppendTwo(levels);
    appendSecond.appendRoot <== middleRoot;
    appendSecond.newRoot <== newRoot;
    appendSecond.firstLeafIndex <== firstLeafIndex + 2;
    appendSecond.outputCommitments[0] <== outputCommitment2;
    appendSecond.outputCommitments[1] <== outputCommitment3;
    for (var level = 0; level < levels - 1; level++) {
        appendFirst.siblings[level] <== appendSiblings0[level];
        appendSecond.siblings[level] <== appendSiblings1[level];
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
    nullifier2,
    outputCommitment0,
    outputCommitment1,
    outputCommitment2,
    outputCommitment3,
    outputEnvelopeHash0,
    outputEnvelopeHash1,
    outputEnvelopeHash2,
    outputEnvelopeHash3,
    firstLeafIndex,
    publicAmountSign,
    publicAmountMagnitude
] } = PrivateExitMatch(20);
