pragma circom 2.2.3;

include "./privacy_primitives.circom";

template PrivateTreasury(levels) {
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

    action === 10;
    nullifierCount === 0;
    nullifier0 === 0;
    nullifier1 === 0;
    publicAmountSign === 0;
    contextFields[0] === 1;
    contextFields[9] === action;
    contextFields[12] === 0;
    contextFields[13] === 0;
    contextFields[14] === 0;
    contextFields[15] === 0;
    contextFields[16] === publicAmountMagnitude;
    contextFields[17] === 0;
    contextFields[18] === 0;
    contextFields[19] === 0;
    contextFields[21] === 5;
    for (var field = 24; field < 46; field++) {
        contextFields[field] === 0;
    }

    component amountRange = Num2Bits(60);
    amountRange.in <== publicAmountMagnitude;
    component amountZero = IsZero();
    amountZero.in <== publicAmountMagnitude;
    amountZero.out === 0;
    component treasuryHighRange = Num2Bits(128);
    treasuryHighRange.in <== contextFields[22];
    component treasuryLowRange = Num2Bits(128);
    treasuryLowRange.in <== contextFields[23];
    signal treasuryKey;
    treasuryKey <== contextFields[22] * 340282366920938463463374607431768211456
        + contextFields[23];

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

    component treasuryRecipient = Poseidon2Sponge(4);
    treasuryRecipient.inputs[0] <== 1015;
    treasuryRecipient.inputs[1] <== outSpendPublicKey[0];
    treasuryRecipient.inputs[2] <== outViewingPublicKey[0][0];
    treasuryRecipient.inputs[3] <== outViewingPublicKey[0][1];
    treasuryRecipient.out === treasuryKey;
    component treasuryPayload = Poseidon2Sponge(2);
    treasuryPayload.inputs[0] <== 1016;
    treasuryPayload.inputs[1] <== treasuryKey;

    component outputs[2];
    component spendKeyZero[2];
    component noteIdZero[2];
    component blindingZero[2];
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
        spendKeyZero[index] = IsZero();
        spendKeyZero[index].in <== outSpendPublicKey[index];
        spendKeyZero[index].out === 0;
        noteIdZero[index] = IsZero();
        noteIdZero[index].in <== outNoteId[index];
        noteIdZero[index].out === 0;
        blindingZero[index] = IsZero();
        blindingZero[index].in <== outBlinding[index];
        blindingZero[index].out === 0;
    }

    outPurpose[0] === 8;
    outAmount[0] === publicAmountMagnitude;
    outPayloadHash[0] === treasuryPayload.out;
    outPrivateData[0][0] === 0;
    outPrivateData[0][1] === 0;

    outPurpose[1] === 0;
    outAmount[1] === 0;
    outPayloadHash[1] === 0;
    outPrivateData[1][0] === 0;
    outPrivateData[1][1] === 0;

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
] } = PrivateTreasury(20);
