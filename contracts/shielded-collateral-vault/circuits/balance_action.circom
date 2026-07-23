pragma circom 2.2.3;

include "./privacy_primitives.circom";

template BalanceAction(levels, actionCode, inputCount) {
    assert(actionCode >= 0);
    assert(actionCode <= 2);
    assert(inputCount >= 0);
    assert(inputCount <= 2);

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
    contextFields[0] === 1;
    contextFields[9] === action;
    contextFields[15] === publicAmountSign;
    contextFields[16] === publicAmountMagnitude;
    contextFields[17] === 0;
    contextFields[18] === 0;
    contextFields[19] === 0;
    contextFields[21] === 0;
    for (var field = 22; field < 46; field++) {
        contextFields[field] === 0;
    }

    component amountSignBits = Num2Bits(1);
    amountSignBits.in <== publicAmountSign;
    component publicAmountRange = Num2Bits(60);
    publicAmountRange.in <== publicAmountMagnitude;

    if (actionCode == 0) {
        publicAmountSign === 0;
        contextFields[12] === 1;
    }
    if (actionCode == 1) {
        publicAmountSign === 0;
        publicAmountMagnitude === 0;
        contextFields[12] === 0;
        contextFields[13] === 0;
        contextFields[14] === 0;
    }
    if (actionCode == 2) {
        publicAmountSign === 1;
        contextFields[12] === 1;
    }

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

    component inputs[inputCount];
    component inputAmountRanges[inputCount];
    component inputAmountZero[inputCount];
    component inputSecretZero[inputCount];
    component inputPurposeChecks[inputCount][3];
    var totalInput = 0;
    for (var index = 0; index < inputCount; index++) {
        inputs[index] = InputNote(levels, 1);
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

        inputPurposeChecks[index][0] = IsEqual();
        inputPurposeChecks[index][0].in[0] <== inPurpose[index];
        inputPurposeChecks[index][0].in[1] <== 1;
        inputPurposeChecks[index][1] = IsEqual();
        inputPurposeChecks[index][1].in[0] <== inPurpose[index];
        inputPurposeChecks[index][1].in[1] <== 6;
        inputPurposeChecks[index][2] = IsEqual();
        inputPurposeChecks[index][2].in[0] <== inPurpose[index];
        inputPurposeChecks[index][2].in[1] <== 7;
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

    if (inputCount == 0) {
        nullifier0 === 0;
        nullifier1 === 0;
    }
    if (inputCount == 1) {
        nullifier1 === 0;
    }
    if (inputCount == 2) {
        component distinctNullifiers = IsEqual();
        distinctNullifiers.in[0] <== nullifier0;
        distinctNullifiers.in[1] <== nullifier1;
        distinctNullifiers.out === 0;
    }

    component outputs[2];
    component outputAmountRanges[2];
    component outputAmountZero[2];
    component outputSpendKeyZero[2];
    component outputNoteIdZero[2];
    component outputBlindingZero[2];
    var totalOutput = 0;
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

        outPurpose[index] * (outPurpose[index] - 1) === 0;
        outputAmountRanges[index] = Num2Bits(60);
        outputAmountRanges[index].in <== outAmount[index];
        outputAmountZero[index] = IsZero();
        outputAmountZero[index].in <== outAmount[index];
        outputAmountZero[index].out === 1 - outPurpose[index];
        outPayloadHash[index] === 0;
        outPrivateData[index][0] === 0;
        outPrivateData[index][1] === 0;

        outputSpendKeyZero[index] = IsZero();
        outputSpendKeyZero[index].in <== outSpendPublicKey[index];
        outputSpendKeyZero[index].out === 0;
        outputNoteIdZero[index] = IsZero();
        outputNoteIdZero[index].in <== outNoteId[index];
        outputNoteIdZero[index].out === 0;
        outputBlindingZero[index] = IsZero();
        outputBlindingZero[index].in <== outBlinding[index];
        outputBlindingZero[index].out === 0;

        totalOutput += outAmount[index];
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

    if (actionCode == 0) {
        totalOutput === publicAmountMagnitude;
    }
    if (actionCode == 1) {
        totalInput === totalOutput;
    }
    if (actionCode == 2) {
        totalInput === totalOutput + publicAmountMagnitude;
    }
}
