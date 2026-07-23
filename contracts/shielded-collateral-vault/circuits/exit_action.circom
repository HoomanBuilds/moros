pragma circom 2.2.3;

include "./privacy_primitives.circom";

template PrivateExitAction(levels, actionCode, inputCount) {
    assert(actionCode == 11 || actionCode == 12);
    assert(inputCount == 1);

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

    signal input inPurpose[inputCount];
    signal input inAmount[inputCount];
    signal input inSpendSecret[inputCount];
    signal input inViewingPublicKey[inputCount][2];
    signal input inNoteId[inputCount];
    signal input inPayloadHash[inputCount];
    signal input inPrivateData[inputCount][2];
    signal input inBlinding[inputCount];
    signal input inLeafIndex[inputCount];
    signal input inSiblings[inputCount][levels];

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
    signal input appendSiblings[levels - 1];

    action === actionCode;
    nullifierCount === inputCount;
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
    contextFields[21] === actionCode - 5;
    if (actionCode == 11) {
        component paymentCommitmentLimbs[2];
        for (var index = 0; index < 2; index++) {
            paymentCommitmentLimbs[index] = Num2Bits(128);
            paymentCommitmentLimbs[index].in <== contextFields[32 + index];
        }
        component minimumZero = IsZero();
        minimumZero.in <== contextFields[27];
        minimumZero.out === 0;
        for (var field = 39; field < 46; field++) {
            contextFields[field] === 0;
        }
    } else {
        for (var field = 32; field < 46; field++) {
            contextFields[field] === 0;
        }
    }

    component bindingLimbRanges[6];
    for (var index = 0; index < 2; index++) {
        bindingLimbRanges[index] = Num2Bits(128);
        bindingLimbRanges[index].in <== contextFields[22 + index];
        bindingLimbRanges[2 + index] = Num2Bits(128);
        bindingLimbRanges[2 + index].in <== contextFields[24 + index];
        bindingLimbRanges[4 + index] = Num2Bits(128);
        bindingLimbRanges[4 + index].in <== contextFields[28 + index];
    }
    component shareRange = Num2Bits(60);
    shareRange.in <== contextFields[26];
    component sharesZero = IsZero();
    sharesZero.in <== contextFields[26];
    sharesZero.out === 0;
    component minimumRange = Num2Bits(60);
    minimumRange.in <== contextFields[27];
    component exitExpiryRange = Num2Bits(64);
    exitExpiryRange.in <== contextFields[30];
    component versionRange = Num2Bits(64);
    versionRange.in <== contextFields[31];

    signal destination;
    destination <== contextFields[28] * 340282366920938463463374607431768211456
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

    if (actionCode == 11) {
        signal paymentCommitment;
        paymentCommitment <== contextFields[32] * 340282366920938463463374607431768211456
            + contextFields[33];
        component paymentDestination = NoteCommitment();
        paymentDestination.noteDomain <== noteDomain.out;
        paymentDestination.purpose <== 1;
        paymentDestination.amount <== contextFields[27];
        paymentDestination.spendPublicKey <== contextFields[34];
        paymentDestination.viewingPublicKey[0] <== contextFields[35];
        paymentDestination.viewingPublicKey[1] <== contextFields[36];
        paymentDestination.noteId <== contextFields[37];
        paymentDestination.payloadHash <== 0;
        paymentDestination.privateData[0] <== 0;
        paymentDestination.privateData[1] <== 0;
        paymentDestination.blinding <== contextFields[38];
        paymentDestination.out === paymentCommitment;
    }

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

    component inputs[inputCount];
    component purposePadding[inputCount];
    component purposePrimary[inputCount];
    component inputAmountRange[inputCount];
    component inputSecretZero[inputCount];
    var totalInput = 0;
    for (var index = 0; index < inputCount; index++) {
        if (actionCode == 11) {
            inputs[index] = InputNote(levels, 2);
        } else {
            inputs[index] = InputNote(levels, 5);
        }
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
        for (var level = 0; level < levels; level++) {
            inputs[index].siblings[level] <== inSiblings[index][level];
        }
        if (index == 0) {
            inputs[index].expectedNullifier <== nullifier0;
        } else {
            inputs[index].expectedNullifier <== nullifier1;
        }
        inputAmountRange[index] = Num2Bits(60);
        inputAmountRange[index].in <== inAmount[index];
        inputSecretZero[index] = IsZero();
        inputSecretZero[index].in <== inSpendSecret[index];
        inputSecretZero[index].out === 0;
        purposePadding[index] = IsEqual();
        purposePadding[index].in[0] <== inPurpose[index];
        purposePadding[index].in[1] <== 0;
        purposePrimary[index] = IsEqual();
        purposePrimary[index].in[0] <== inPurpose[index];
        purposePrimary[index].in[1] <== actionCode == 11 ? 3 : 9;
        purposePadding[index].out + purposePrimary[index].out === 1;
        if (actionCode == 11) {
            inPayloadHash[index] === purposePrimary[index].out * liquidityPayload.out;
            inPrivateData[index][0] === 0;
            inPrivateData[index][1] === 0;
        }
        totalInput += inAmount[index];
    }

    if (inputCount == 1) {
        nullifier1 === 0;
    } else {
        component distinctNullifiers = IsEqual();
        distinctNullifiers.in[0] <== nullifier0;
        distinctNullifiers.in[1] <== nullifier1;
        distinctNullifiers.out === 0;
    }

    component outputs[2];
    component outputAmountRange[2];
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
        outputAmountRange[index] = Num2Bits(60);
        outputAmountRange[index].in <== outAmount[index];
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

    if (actionCode == 11) {
        component remainingPurpose = IsEqual();
        remainingPurpose.in[0] <== outPurpose[0];
        remainingPurpose.in[1] <== 3;
        component remainingPadding = IsEqual();
        remainingPadding.in[0] <== outPurpose[0];
        remainingPadding.in[1] <== 0;
        remainingPurpose.out + remainingPadding.out === 1;
        component remainingZero = IsZero();
        remainingZero.in <== outAmount[0];
        remainingZero.out === remainingPadding.out;
        outPayloadHash[0] === remainingPurpose.out * liquidityPayload.out;
        outPrivateData[0][0] === 0;
        outPrivateData[0][1] === 0;

        outPurpose[1] === 9;
        outAmount[1] === contextFields[26];
        outPayloadHash[1] === exitPayload.out;
        outPrivateData[1][0] === contextFields[27];
        outPrivateData[1][1] === contextFields[30];
        outputCommitment1 === destination;
        totalInput === contextFields[26] + outAmount[0];
    } else {
        inPurpose[0] === 9;
        inAmount[0] === contextFields[26];
        inPayloadHash[0] === exitPayload.out;
        inPrivateData[0][0] === contextFields[27];
        inPrivateData[0][1] === contextFields[30];
        inputs[0].commitment === destination;

        outPurpose[0] === 3;
        outAmount[0] === contextFields[26];
        outPayloadHash[0] === liquidityPayload.out;
        outPrivateData[0][0] === 0;
        outPrivateData[0][1] === 0;

        outPurpose[1] === 0;
        outAmount[1] === 0;
        outPayloadHash[1] === 0;
        outPrivateData[1][0] === 0;
        outPrivateData[1][1] === 0;
    }

    outputs[0].commitment === outputCommitment0;
    outputs[1].commitment === outputCommitment1;
    outputs[0].envelopeHash === outputEnvelopeHash0;
    outputs[1].envelopeHash === outputEnvelopeHash1;
    component distinctOutputs = IsEqual();
    distinctOutputs.in[0] <== outputCommitment0;
    distinctOutputs.in[1] <== outputCommitment1;
    distinctOutputs.out === 0;

    component append = AppendTwo(levels);
    append.appendRoot <== appendRoot;
    append.newRoot <== newRoot;
    append.firstLeafIndex <== firstLeafIndex;
    append.outputCommitments[0] <== outputCommitment0;
    append.outputCommitments[1] <== outputCommitment1;
    for (var level = 0; level < levels - 1; level++) {
        append.siblings[level] <== appendSiblings[level];
    }
}
