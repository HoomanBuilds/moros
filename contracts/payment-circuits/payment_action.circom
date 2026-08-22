pragma circom 2.2.3;

include "../shielded-collateral-vault/circuits/privacy_primitives.circom";

template PaymentNoteDomain() {
    signal input network[2];
    signal input vault[2];
    signal input token[2];
    signal input schemaVersion;
    signal output out;

    component hash = Poseidon2Sponge(8);
    hash.inputs[0] <== 1101;
    hash.inputs[1] <== network[0];
    hash.inputs[2] <== network[1];
    hash.inputs[3] <== vault[0];
    hash.inputs[4] <== vault[1];
    hash.inputs[5] <== token[0];
    hash.inputs[6] <== token[1];
    hash.inputs[7] <== schemaVersion;
    out <== hash.out;
}

template PrivatePaymentTransfer(levels, inputCount) {
    assert(inputCount == 1 || inputCount == 2 || inputCount == 4);

    signal input action;
    signal input contextDigest;
    signal input membershipRoot;
    signal input nullifierCount;
    signal input nullifier0;
    signal input nullifier1;
    signal input nullifier2;
    signal input nullifier3;
    signal input outputCount;
    signal input outputCommitment0;
    signal input outputCommitment1;
    signal input outputCommitment2;
    signal input outputCommitment3;
    signal input outputEnvelopeHash0;
    signal input outputEnvelopeHash1;
    signal input outputEnvelopeHash2;
    signal input outputEnvelopeHash3;
    signal input attachmentHash;
    signal input publicAmountSign;
    signal input publicAmountMagnitude;

    signal input contextFields[32];
    signal input attachmentFields[4];

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

    action === 1;
    nullifierCount === inputCount;
    outputCount === 4;
    publicAmountSign === 0;
    publicAmountMagnitude === 0;

    contextFields[0] === 1;
    contextFields[1] === action;
    contextFields[2] === 1;
    contextFields[16] === publicAmountSign;
    contextFields[17] === publicAmountMagnitude;
    contextFields[18] === outputCount;
    contextFields[19] === 4;
    contextFields[20] === 0;
    contextFields[30] === attachmentHash;

    component contextHash = Poseidon2Sponge(32);
    for (var field = 0; field < 32; field++) {
        contextHash.inputs[field] <== contextFields[field];
    }
    contextHash.out === contextDigest;

    component attachmentCommitment = Poseidon2Sponge(5);
    attachmentCommitment.inputs[0] <== 1110;
    for (var field = 0; field < 4; field++) {
        attachmentCommitment.inputs[field + 1] <== attachmentFields[field];
    }
    attachmentCommitment.out === attachmentHash;

    component noteDomain = PaymentNoteDomain();
    noteDomain.network[0] <== contextFields[3];
    noteDomain.network[1] <== contextFields[4];
    noteDomain.vault[0] <== contextFields[5];
    noteDomain.vault[1] <== contextFields[6];
    noteDomain.token[0] <== contextFields[7];
    noteDomain.token[1] <== contextFields[8];
    noteDomain.schemaVersion <== contextFields[2];

    component inputs[inputCount];
    component inputAmountRanges[inputCount];
    component inputAmountZero[inputCount];
    component inputSecretZero[inputCount];
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
        }
        if (index == 1) {
            inputs[index].expectedNullifier <== nullifier1;
        }
        if (index == 2) {
            inputs[index].expectedNullifier <== nullifier2;
        }
        if (index == 3) {
            inputs[index].expectedNullifier <== nullifier3;
        }

        inPurpose[index] === 1;
        inputAmountRanges[index] = Num2Bits(120);
        inputAmountRanges[index].in <== inAmount[index];
        inputAmountZero[index] = IsZero();
        inputAmountZero[index].in <== inAmount[index];
        inputAmountZero[index].out === 0;
        inputSecretZero[index] = IsZero();
        inputSecretZero[index].in <== inSpendSecret[index];
        inputSecretZero[index].out === 0;
        totalInput += inAmount[index];
    }

    if (inputCount < 4) {
        nullifier3 === 0;
    }
    if (inputCount < 3) {
        nullifier2 === 0;
    }
    if (inputCount < 2) {
        nullifier1 === 0;
    }

    component nullifierDistinct[inputCount * (inputCount - 1) / 2];
    var nullifierPair = 0;
    for (var left = 0; left < inputCount; left++) {
        for (var right = left + 1; right < inputCount; right++) {
            nullifierDistinct[nullifierPair] = IsEqual();
            if (left == 0) {
                nullifierDistinct[nullifierPair].in[0] <== nullifier0;
            }
            if (left == 1) {
                nullifierDistinct[nullifierPair].in[0] <== nullifier1;
            }
            if (left == 2) {
                nullifierDistinct[nullifierPair].in[0] <== nullifier2;
            }
            if (right == 1) {
                nullifierDistinct[nullifierPair].in[1] <== nullifier1;
            }
            if (right == 2) {
                nullifierDistinct[nullifierPair].in[1] <== nullifier2;
            }
            if (right == 3) {
                nullifierDistinct[nullifierPair].in[1] <== nullifier3;
            }
            nullifierDistinct[nullifierPair].out === 0;
            nullifierPair++;
        }
    }

    component outputs[4];
    component outputAmountRanges[4];
    component outputSpendKeyZero[4];
    component outputNoteIdZero[4];
    component outputBlindingZero[4];
    var totalOutput = 0;
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

        outPurpose[index] === 1;
        outputAmountRanges[index] = Num2Bits(120);
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
        totalOutput += outAmount[index];
    }

    outputs[0].commitment === outputCommitment0;
    outputs[1].commitment === outputCommitment1;
    outputs[2].commitment === outputCommitment2;
    outputs[3].commitment === outputCommitment3;
    outputs[0].envelopeHash === outputEnvelopeHash0;
    outputs[1].envelopeHash === outputEnvelopeHash1;
    outputs[2].envelopeHash === outputEnvelopeHash2;
    outputs[3].envelopeHash === outputEnvelopeHash3;

    component recipientAmountZero = IsZero();
    recipientAmountZero.in <== outAmount[0];
    recipientAmountZero.out === 0;
    outPrivateData[0][0] === attachmentHash;
    outPrivateData[0][1] === 0;

    outPayloadHash[1] === 0;
    outPayloadHash[2] === 0;
    outPayloadHash[3] === 0;
    outPrivateData[1][0] === 0;
    outPrivateData[1][1] === 0;
    outPrivateData[2][0] === 0;
    outPrivateData[2][1] === 0;
    outPrivateData[3][0] === 0;
    outPrivateData[3][1] === 0;

    outAmount[2] === contextFields[22];
    outAmount[3] === contextFields[23];
    outSpendPublicKey[2] === contextFields[24];
    outViewingPublicKey[2][0] === contextFields[25];
    outViewingPublicKey[2][1] === contextFields[26];
    outSpendPublicKey[3] === contextFields[27];
    outViewingPublicKey[3][0] === contextFields[28];
    outViewingPublicKey[3][1] === contextFields[29];

    component outputDistinct[6];
    var outputPair = 0;
    for (var left = 0; left < 4; left++) {
        for (var right = left + 1; right < 4; right++) {
            outputDistinct[outputPair] = IsEqual();
            if (left == 0) {
                outputDistinct[outputPair].in[0] <== outputCommitment0;
            }
            if (left == 1) {
                outputDistinct[outputPair].in[0] <== outputCommitment1;
            }
            if (left == 2) {
                outputDistinct[outputPair].in[0] <== outputCommitment2;
            }
            if (right == 1) {
                outputDistinct[outputPair].in[1] <== outputCommitment1;
            }
            if (right == 2) {
                outputDistinct[outputPair].in[1] <== outputCommitment2;
            }
            if (right == 3) {
                outputDistinct[outputPair].in[1] <== outputCommitment3;
            }
            outputDistinct[outputPair].out === 0;
            outputPair++;
        }
    }

    totalInput === totalOutput;
}

template PrivatePaymentDeposit() {
    signal input action;
    signal input contextDigest;
    signal input membershipRoot;
    signal input nullifierCount;
    signal input nullifier0;
    signal input nullifier1;
    signal input nullifier2;
    signal input nullifier3;
    signal input outputCount;
    signal input outputCommitment0;
    signal input outputCommitment1;
    signal input outputCommitment2;
    signal input outputCommitment3;
    signal input outputEnvelopeHash0;
    signal input outputEnvelopeHash1;
    signal input outputEnvelopeHash2;
    signal input outputEnvelopeHash3;
    signal input attachmentHash;
    signal input publicAmountSign;
    signal input publicAmountMagnitude;

    signal input contextFields[32];
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

    action === 0;
    membershipRoot === 0;
    nullifierCount === 0;
    nullifier0 === 0;
    nullifier1 === 0;
    nullifier2 === 0;
    nullifier3 === 0;
    outputCount === 2;
    outputCommitment2 === 0;
    outputCommitment3 === 0;
    outputEnvelopeHash2 === 0;
    outputEnvelopeHash3 === 0;
    attachmentHash === 0;
    publicAmountSign === 0;

    component publicAmountRange = Num2Bits(120);
    publicAmountRange.in <== publicAmountMagnitude;
    component publicAmountZero = IsZero();
    publicAmountZero.in <== publicAmountMagnitude;
    publicAmountZero.out === 0;

    contextFields[0] === 1;
    contextFields[1] === action;
    contextFields[2] === 1;
    contextFields[16] === publicAmountSign;
    contextFields[17] === publicAmountMagnitude;
    contextFields[18] === outputCount;
    contextFields[19] === 2;
    contextFields[20] === 0;
    contextFields[22] === 0;
    contextFields[23] === 0;
    contextFields[30] === attachmentHash;

    component contextHash = Poseidon2Sponge(32);
    for (var field = 0; field < 32; field++) {
        contextHash.inputs[field] <== contextFields[field];
    }
    contextHash.out === contextDigest;

    component noteDomain = PaymentNoteDomain();
    noteDomain.network[0] <== contextFields[3];
    noteDomain.network[1] <== contextFields[4];
    noteDomain.vault[0] <== contextFields[5];
    noteDomain.vault[1] <== contextFields[6];
    noteDomain.token[0] <== contextFields[7];
    noteDomain.token[1] <== contextFields[8];
    noteDomain.schemaVersion <== contextFields[2];

    component outputs[2];
    component outputAmountRanges[2];
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

        outPurpose[index] === 1;
        outputAmountRanges[index] = Num2Bits(120);
        outputAmountRanges[index].in <== outAmount[index];
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
    }

    outAmount[0] === publicAmountMagnitude;
    outAmount[1] === 0;
    outputs[0].commitment === outputCommitment0;
    outputs[1].commitment === outputCommitment1;
    outputs[0].envelopeHash === outputEnvelopeHash0;
    outputs[1].envelopeHash === outputEnvelopeHash1;

    component distinctOutputs = IsEqual();
    distinctOutputs.in[0] <== outputCommitment0;
    distinctOutputs.in[1] <== outputCommitment1;
    distinctOutputs.out === 0;
}

template PrivatePaymentWithdraw(levels, inputCount) {
    assert(inputCount == 1 || inputCount == 2 || inputCount == 4);

    signal input action;
    signal input contextDigest;
    signal input membershipRoot;
    signal input nullifierCount;
    signal input nullifier0;
    signal input nullifier1;
    signal input nullifier2;
    signal input nullifier3;
    signal input outputCount;
    signal input outputCommitment0;
    signal input outputCommitment1;
    signal input outputCommitment2;
    signal input outputCommitment3;
    signal input outputEnvelopeHash0;
    signal input outputEnvelopeHash1;
    signal input outputEnvelopeHash2;
    signal input outputEnvelopeHash3;
    signal input attachmentHash;
    signal input publicAmountSign;
    signal input publicAmountMagnitude;

    signal input contextFields[32];

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

    signal input outPurpose[3];
    signal input outAmount[3];
    signal input outSpendPublicKey[3];
    signal input outViewingPublicKey[3][2];
    signal input outNoteId[3];
    signal input outPayloadHash[3];
    signal input outPrivateData[3][2];
    signal input outBlinding[3];
    signal input outEphemeralSecret[3];
    signal input outNonce[3];
    signal input outEnvelope[3][15];

    action === 2;
    nullifierCount === inputCount;
    outputCommitment3 === 0;
    outputEnvelopeHash3 === 0;
    attachmentHash === 0;
    publicAmountSign === 1;

    component publicAmountRange = Num2Bits(120);
    publicAmountRange.in <== publicAmountMagnitude;
    component publicAmountZero = IsZero();
    publicAmountZero.in <== publicAmountMagnitude;
    publicAmountZero.out === 0;
    component emergencyBits = Num2Bits(1);
    emergencyBits.in <== contextFields[20];
    signal normal;
    normal <== 1 - contextFields[20];
    outputCount === 3 * normal;

    contextFields[0] === 1;
    contextFields[1] === action;
    contextFields[2] === 1;
    contextFields[16] === publicAmountSign;
    contextFields[17] === publicAmountMagnitude;
    contextFields[18] === outputCount;
    contextFields[19] === outputCount;
    contextFields[30] === attachmentHash;
    contextFields[20] * contextFields[22] === 0;
    contextFields[20] * contextFields[23] === 0;

    component contextHash = Poseidon2Sponge(32);
    for (var field = 0; field < 32; field++) {
        contextHash.inputs[field] <== contextFields[field];
    }
    contextHash.out === contextDigest;

    component noteDomain = PaymentNoteDomain();
    noteDomain.network[0] <== contextFields[3];
    noteDomain.network[1] <== contextFields[4];
    noteDomain.vault[0] <== contextFields[5];
    noteDomain.vault[1] <== contextFields[6];
    noteDomain.token[0] <== contextFields[7];
    noteDomain.token[1] <== contextFields[8];
    noteDomain.schemaVersion <== contextFields[2];

    component inputs[inputCount];
    component inputAmountRanges[inputCount];
    component inputAmountZero[inputCount];
    component inputSecretZero[inputCount];
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
        }
        if (index == 1) {
            inputs[index].expectedNullifier <== nullifier1;
        }
        if (index == 2) {
            inputs[index].expectedNullifier <== nullifier2;
        }
        if (index == 3) {
            inputs[index].expectedNullifier <== nullifier3;
        }

        inPurpose[index] === 1;
        inputAmountRanges[index] = Num2Bits(120);
        inputAmountRanges[index].in <== inAmount[index];
        inputAmountZero[index] = IsZero();
        inputAmountZero[index].in <== inAmount[index];
        inputAmountZero[index].out === 0;
        inputSecretZero[index] = IsZero();
        inputSecretZero[index].in <== inSpendSecret[index];
        inputSecretZero[index].out === 0;
        totalInput += inAmount[index];
    }

    if (inputCount < 4) {
        nullifier3 === 0;
    }
    if (inputCount < 3) {
        nullifier2 === 0;
    }
    if (inputCount < 2) {
        nullifier1 === 0;
    }

    component nullifierDistinct[inputCount * (inputCount - 1) / 2];
    var nullifierPair = 0;
    for (var left = 0; left < inputCount; left++) {
        for (var right = left + 1; right < inputCount; right++) {
            nullifierDistinct[nullifierPair] = IsEqual();
            if (left == 0) {
                nullifierDistinct[nullifierPair].in[0] <== nullifier0;
            }
            if (left == 1) {
                nullifierDistinct[nullifierPair].in[0] <== nullifier1;
            }
            if (left == 2) {
                nullifierDistinct[nullifierPair].in[0] <== nullifier2;
            }
            if (right == 1) {
                nullifierDistinct[nullifierPair].in[1] <== nullifier1;
            }
            if (right == 2) {
                nullifierDistinct[nullifierPair].in[1] <== nullifier2;
            }
            if (right == 3) {
                nullifierDistinct[nullifierPair].in[1] <== nullifier3;
            }
            nullifierDistinct[nullifierPair].out === 0;
            nullifierPair++;
        }
    }

    component outputs[3];
    component outputAmountRanges[3];
    component outputSpendKeyZero[3];
    component outputNoteIdZero[3];
    component outputBlindingZero[3];
    var totalOutput = 0;
    for (var index = 0; index < 3; index++) {
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

        outPurpose[index] === 1;
        outputAmountRanges[index] = Num2Bits(120);
        outputAmountRanges[index].in <== outAmount[index];
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
        contextFields[20] * outAmount[index] === 0;
        totalOutput += outAmount[index];
    }

    outputs[0].commitment * normal === outputCommitment0;
    outputs[1].commitment * normal === outputCommitment1;
    outputs[2].commitment * normal === outputCommitment2;
    outputs[0].envelopeHash * normal === outputEnvelopeHash0;
    outputs[1].envelopeHash * normal === outputEnvelopeHash1;
    outputs[2].envelopeHash * normal === outputEnvelopeHash2;

    outAmount[1] === contextFields[22];
    outAmount[2] === contextFields[23];
    outSpendPublicKey[1] === contextFields[24];
    outViewingPublicKey[1][0] === contextFields[25];
    outViewingPublicKey[1][1] === contextFields[26];
    outSpendPublicKey[2] === contextFields[27];
    outViewingPublicKey[2][0] === contextFields[28];
    outViewingPublicKey[2][1] === contextFields[29];

    component outputDistinct[3];
    outputDistinct[0] = IsEqual();
    outputDistinct[0].in[0] <== outputs[0].commitment;
    outputDistinct[0].in[1] <== outputs[1].commitment;
    outputDistinct[0].out === 0;
    outputDistinct[1] = IsEqual();
    outputDistinct[1].in[0] <== outputs[0].commitment;
    outputDistinct[1].in[1] <== outputs[2].commitment;
    outputDistinct[1].out === 0;
    outputDistinct[2] = IsEqual();
    outputDistinct[2].in[0] <== outputs[1].commitment;
    outputDistinct[2].in[1] <== outputs[2].commitment;
    outputDistinct[2].out === 0;

    totalInput === totalOutput + publicAmountMagnitude;
}
