pragma circom 2.2.3;

include "./privacy_primitives.circom";

template PrivateLiquidityAction(levels, actionCode, inputCount) {
    assert(actionCode >= 6);
    assert(actionCode <= 8);
    assert((actionCode == 6 && inputCount == 2) || (actionCode != 6 && inputCount == 1));

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
    contextFields[12] === 0;
    contextFields[13] === 0;
    contextFields[14] === 0;
    contextFields[15] === publicAmountSign;
    contextFields[16] === publicAmountMagnitude;
    contextFields[17] === 1;
    contextFields[18] === contextFields[22];
    contextFields[19] === contextFields[23];
    contextFields[21] === 1;
    contextFields[24] === outputCommitment1;
    for (var field = 28; field < 46; field++) {
        contextFields[field] === 0;
    }

    component amountRange = Num2Bits(60);
    amountRange.in <== publicAmountMagnitude;
    component amountZero = IsZero();
    amountZero.in <== publicAmountMagnitude;
    amountZero.out === 0;
    component shareRange = Num2Bits(60);
    shareRange.in <== contextFields[25];
    component sharesZero = IsZero();
    sharesZero.in <== contextFields[25];
    sharesZero.out === 0;
    component bindingAmountRange = Num2Bits(60);
    bindingAmountRange.in <== contextFields[26];
    contextFields[26] === publicAmountMagnitude;
    component versionRange = Num2Bits(64);
    versionRange.in <== contextFields[27];

    if (actionCode == 6) {
        publicAmountSign === 1;
    } else {
        publicAmountSign === 0;
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

    component liquidityPayload = Poseidon2Sponge(3);
    liquidityPayload.inputs[0] <== 1011;
    liquidityPayload.inputs[1] <== contextFields[22];
    liquidityPayload.inputs[2] <== contextFields[23];

    component inputs[inputCount];
    component inputPurposePadding[inputCount];
    component inputPurposePrimary[inputCount];
    component inputPurposeRefund[inputCount];
    component inputPurposePayout[inputCount];
    component inputAmountRange[inputCount];
    component inputAmountZero[inputCount];
    component inputSecretZero[inputCount];
    var totalInput = 0;
    for (var index = 0; index < inputCount; index++) {
        if (actionCode == 6) {
            inputs[index] = InputNote(levels, 1);
        } else {
            inputs[index] = InputNote(levels, 2);
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

        inputPurposePadding[index] = IsEqual();
        inputPurposePadding[index].in[0] <== inPurpose[index];
        inputPurposePadding[index].in[1] <== 0;
        if (actionCode == 6) {
            inputPurposePrimary[index] = IsEqual();
            inputPurposePrimary[index].in[0] <== inPurpose[index];
            inputPurposePrimary[index].in[1] <== 1;
            inputPurposeRefund[index] = IsEqual();
            inputPurposeRefund[index].in[0] <== inPurpose[index];
            inputPurposeRefund[index].in[1] <== 6;
            inputPurposePayout[index] = IsEqual();
            inputPurposePayout[index].in[0] <== inPurpose[index];
            inputPurposePayout[index].in[1] <== 7;
            inputPurposePadding[index].out
                + inputPurposePrimary[index].out
                + inputPurposeRefund[index].out
                + inputPurposePayout[index].out === 1;
            inPayloadHash[index] === 0;
            inPrivateData[index][0] === 0;
            inPrivateData[index][1] === 0;
        } else {
            inputPurposePrimary[index] = IsEqual();
            inputPurposePrimary[index].in[0] <== inPurpose[index];
            inputPurposePrimary[index].in[1] <== 3;
            inputPurposePadding[index].out + inputPurposePrimary[index].out === 1;
            inputPurposeRefund[index] = IsEqual();
            inputPurposeRefund[index].in[0] <== 0;
            inputPurposeRefund[index].in[1] <== 1;
            inputPurposePayout[index] = IsEqual();
            inputPurposePayout[index].in[0] <== 0;
            inputPurposePayout[index].in[1] <== 1;
            inPayloadHash[index] === inputPurposePrimary[index].out * liquidityPayload.out;
            inPrivateData[index][0] === 0;
            inPrivateData[index][1] === 0;
        }
        inputAmountRange[index] = Num2Bits(60);
        inputAmountRange[index].in <== inAmount[index];
        inputAmountZero[index] = IsZero();
        inputAmountZero[index].in <== inAmount[index];
        inputAmountZero[index].out === inputPurposePadding[index].out;
        inputSecretZero[index] = IsZero();
        inputSecretZero[index].in <== inSpendSecret[index];
        inputSecretZero[index].out === 0;
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

    if (actionCode == 6) {
        component changePurpose = Num2Bits(1);
        changePurpose.in <== outPurpose[0];
        component changeAmountZero = IsZero();
        changeAmountZero.in <== outAmount[0];
        changeAmountZero.out === 1 - outPurpose[0];
        outPayloadHash[0] === 0;
        outPrivateData[0][0] === 0;
        outPrivateData[0][1] === 0;

        outPurpose[1] === 3;
        outAmount[1] === contextFields[25];
        outPayloadHash[1] === liquidityPayload.out;
        outPrivateData[1][0] === 0;
        outPrivateData[1][1] === 0;
        totalInput === outAmount[0] + publicAmountMagnitude;
    } else {
        outPurpose[0] === 1;
        outAmount[0] === publicAmountMagnitude;
        outPayloadHash[0] === 0;
        outPrivateData[0][0] === 0;
        outPrivateData[0][1] === 0;

        component remainingPurpose = IsEqual();
        remainingPurpose.in[0] <== outPurpose[1];
        remainingPurpose.in[1] <== 3;
        component paddingPurpose = IsEqual();
        paddingPurpose.in[0] <== outPurpose[1];
        paddingPurpose.in[1] <== 0;
        remainingPurpose.out + paddingPurpose.out === 1;
        component remainingAmountZero = IsZero();
        remainingAmountZero.in <== outAmount[1];
        remainingAmountZero.out === paddingPurpose.out;
        outPayloadHash[1] === remainingPurpose.out * liquidityPayload.out;
        outPrivateData[1][0] === 0;
        outPrivateData[1][1] === 0;
        totalInput === contextFields[25] + outAmount[1];
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
