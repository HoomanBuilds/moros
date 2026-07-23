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

    signal input inPurpose[2];
    signal input inAmount[2];
    signal input inSpendSecret[2];
    signal input inViewingPublicKey[2][2];
    signal input inNoteId[2];
    signal input inPayloadHash[2];
    signal input inPrivateData[2][2];
    signal input inBlinding[2];
    signal input inLeafIndex[2];
    signal input inSiblings[2][levels];

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
    nullifierCount === 2;
    nullifier2 === 0;
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
    contextFields[43] === 0;
    contextFields[44] === 0;
    contextFields[45] === 0;

    component limbRanges[6];
    for (var index = 0; index < 2; index++) {
        limbRanges[index] = Num2Bits(128);
        limbRanges[index].in <== contextFields[22 + index];
        limbRanges[2 + index] = Num2Bits(128);
        limbRanges[2 + index].in <== contextFields[24 + index];
        limbRanges[4 + index] = Num2Bits(128);
        limbRanges[4 + index].in <== contextFields[28 + index];
    }
    component amountRanges[5];
    var amountFields[5] = [26, 27, 36, 37, 38];
    for (var index = 0; index < 5; index++) {
        amountRanges[index] = Num2Bits(60);
        amountRanges[index].in <== contextFields[amountFields[index]];
    }
    component sharesZero = IsZero();
    sharesZero.in <== contextFields[26];
    sharesZero.out === 0;
    component paymentZero = IsZero();
    paymentZero.in <== contextFields[27];
    paymentZero.out === 0;
    component timeRanges[5];
    var timeFields[5] = [35, 39, 40, 41, 42];
    for (var index = 0; index < 5; index++) {
        timeRanges[index] = Num2Bits(64);
        timeRanges[index].in <== contextFields[timeFields[index]];
    }
    component maximumAgeZero = IsZero();
    maximumAgeZero.in <== contextFields[40];
    maximumAgeZero.out === 0;

    signal paymentCommitment;
    paymentCommitment <== contextFields[28] * 340282366920938463463374607431768211456
        + contextFields[29];

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

    component buyerInputs[2];
    component buyerPadding[2];
    component buyerLiquid[2][3];
    component buyerAmountRanges[2];
    component buyerAmountZero[2];
    component buyerSecretZero[2];
    var buyerTotal = 0;
    for (var index = 0; index < 2; index++) {
        buyerInputs[index] = InputNote(levels, 1);
        buyerInputs[index].noteDomain <== noteDomain.out;
        buyerInputs[index].membershipRoot <== membershipRoot;
        buyerInputs[index].purpose <== inPurpose[index];
        buyerInputs[index].amount <== inAmount[index];
        buyerInputs[index].spendSecret <== inSpendSecret[index];
        buyerInputs[index].viewingPublicKey[0] <== inViewingPublicKey[index][0];
        buyerInputs[index].viewingPublicKey[1] <== inViewingPublicKey[index][1];
        buyerInputs[index].noteId <== inNoteId[index];
        buyerInputs[index].payloadHash <== inPayloadHash[index];
        buyerInputs[index].privateData[0] <== inPrivateData[index][0];
        buyerInputs[index].privateData[1] <== inPrivateData[index][1];
        buyerInputs[index].blinding <== inBlinding[index];
        buyerInputs[index].leafIndex <== inLeafIndex[index];
        for (var level = 0; level < levels; level++) {
            buyerInputs[index].siblings[level] <== inSiblings[index][level];
        }
        if (index == 0) {
            buyerInputs[index].expectedNullifier <== nullifier0;
        } else {
            buyerInputs[index].expectedNullifier <== nullifier1;
        }
        buyerPadding[index] = IsEqual();
        buyerPadding[index].in[0] <== inPurpose[index];
        buyerPadding[index].in[1] <== 0;
        for (var purposeIndex = 0; purposeIndex < 3; purposeIndex++) {
            buyerLiquid[index][purposeIndex] = IsEqual();
            buyerLiquid[index][purposeIndex].in[0] <== inPurpose[index];
            buyerLiquid[index][purposeIndex].in[1] <==
                purposeIndex == 0 ? 1 : purposeIndex + 5;
        }
        buyerPadding[index].out
            + buyerLiquid[index][0].out
            + buyerLiquid[index][1].out
            + buyerLiquid[index][2].out === 1;
        inPayloadHash[index] === 0;
        inPrivateData[index][0] === 0;
        inPrivateData[index][1] === 0;
        buyerAmountRanges[index] = Num2Bits(60);
        buyerAmountRanges[index].in <== inAmount[index];
        buyerAmountZero[index] = IsZero();
        buyerAmountZero[index].in <== inAmount[index];
        buyerAmountZero[index].out === buyerPadding[index].out;
        buyerSecretZero[index] = IsZero();
        buyerSecretZero[index].in <== inSpendSecret[index];
        buyerSecretZero[index].out === 0;
        buyerTotal += inAmount[index];
    }
    component distinctNullifiers = IsEqual();
    distinctNullifiers.in[0] <== nullifier0;
    distinctNullifiers.in[1] <== nullifier1;
    distinctNullifiers.out === 0;

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

    outPurpose[0] === 1;
    outAmount[0] === contextFields[27];
    outSpendPublicKey[0] === contextFields[30];
    outViewingPublicKey[0][0] === contextFields[31];
    outViewingPublicKey[0][1] === contextFields[32];
    outNoteId[0] === contextFields[33];
    outBlinding[0] === contextFields[34];
    outPayloadHash[0] === 0;
    outPrivateData[0][0] === 0;
    outPrivateData[0][1] === 0;
    outputCommitment0 === paymentCommitment;

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

    outPurpose[3] === 0;
    outAmount[3] === 0;
    outPayloadHash[3] === 0;
    outPrivateData[3][0] === 0;
    outPrivateData[3][1] === 0;

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
