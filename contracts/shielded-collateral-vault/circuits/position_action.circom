pragma circom 2.2.3;

include "./privacy_primitives.circom";

template PositionCeilDivConstant(denominator, numeratorBits, remainderBits) {
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

template PrivatePositionAction(noteLevels, rootLevels, actionCode) {
    assert(actionCode == 4 || actionCode == 5 || actionCode == 9);

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
    signal input acceptedActionId[2];
    signal input acceptedCiphertext[8];
    signal input acceptedCommitteeEpoch;
    signal input acceptedLeafIndex;
    signal input acceptedSiblings[rootLevels];
    signal input allocationLeafIndex;
    signal input allocationSiblings[rootLevels];

    signal input inPurpose;
    signal input inAmount;
    signal input inSpendSecret;
    signal input inViewingPublicKey[2];
    signal input inNoteId;
    signal input inPayloadHash;
    signal input inPrivateData[2];
    signal input inBlinding;
    signal input inLeafIndex;
    signal input inSiblings[noteLevels];

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

    action === actionCode;
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
    component acceptedModeCheck = IsEqual();
    acceptedModeCheck.in[0] <== contextFields[21];
    acceptedModeCheck.in[1] <== 3;
    component allocationModeCheck = IsEqual();
    allocationModeCheck.in[0] <== contextFields[21];
    allocationModeCheck.in[1] <== 4;
    signal acceptedMode;
    signal allocationMode;
    acceptedMode <== acceptedModeCheck.out;
    allocationMode <== allocationModeCheck.out;

    if (actionCode == 4 || actionCode == 9) {
        acceptedMode === 0;
        allocationMode === 1;
    } else {
        acceptedMode + allocationMode === 1;
        acceptedMode * contextFields[24] === 0;
        allocationMode * (contextFields[24] - 3) === 0;
    }
    for (var field = 24; field < 46; field++) {
        acceptedMode * contextFields[field] === 0;
    }
    allocationMode * contextFields[44] === 0;
    allocationMode * contextFields[45] === 0;
    if (actionCode == 4) {
        component yesOutcome = IsEqual();
        yesOutcome.in[0] <== contextFields[24];
        yesOutcome.in[1] <== 1;
        component noOutcome = IsEqual();
        noOutcome.in[0] <== contextFields[24];
        noOutcome.in[1] <== 2;
        yesOutcome.out + noOutcome.out === 1;
    }
    if (actionCode == 9) {
        contextFields[24] === 0;
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

    component positionInput;
    if (actionCode == 9) {
        positionInput = InputNote(noteLevels, 3);
    } else {
        positionInput = InputNote(noteLevels, 4);
    }
    positionInput.noteDomain <== noteDomain.out;
    positionInput.membershipRoot <== membershipRoot;
    positionInput.purpose <== inPurpose;
    positionInput.amount <== inAmount;
    positionInput.spendSecret <== inSpendSecret;
    positionInput.viewingPublicKey[0] <== inViewingPublicKey[0];
    positionInput.viewingPublicKey[1] <== inViewingPublicKey[1];
    positionInput.noteId <== inNoteId;
    positionInput.payloadHash <== inPayloadHash;
    positionInput.privateData[0] <== inPrivateData[0];
    positionInput.privateData[1] <== inPrivateData[1];
    positionInput.blinding <== inBlinding;
    positionInput.leafIndex <== inLeafIndex;
    for (var level = 0; level < noteLevels; level++) {
        positionInput.siblings[level] <== inSiblings[level];
    }
    positionInput.expectedNullifier <== nullifier0;
    inPurpose === 2;
    component inputAmountRange = Num2Bits(60);
    inputAmountRange.in <== inAmount;
    component inputAmountZero = IsZero();
    inputAmountZero.in <== inAmount;
    inputAmountZero.out === 0;
    component inputSecretZero = IsZero();
    inputSecretZero.in <== inSpendSecret;
    inputSecretZero.out === 0;
    component sideBits = Num2Bits(1);
    sideBits.in <== inPrivateData[0];
    signal sequence;
    signal quantity;
    sequence <-- inPrivateData[1] \ 1024;
    quantity <-- inPrivateData[1] % 1024;
    inPrivateData[1] === sequence * 1024 + quantity;
    component sequenceRange = Num2Bits(64);
    sequenceRange.in <== sequence;
    component quantityRange = Num2Bits(10);
    quantityRange.in <== quantity;
    component quantityBound = LessThan(10);
    quantityBound.in[0] <== quantity;
    quantityBound.in[1] <== 1001;
    quantityBound.out === 1;
    component quantityZero = IsZero();
    quantityZero.in <== quantity;
    quantityZero.out === 0;

    component acceptedLeaf = AcceptedOrderLeaf();
    acceptedLeaf.market[0] <== contextFields[18];
    acceptedLeaf.market[1] <== contextFields[19];
    acceptedLeaf.epoch <== contextFields[22];
    acceptedLeaf.sequence <== sequence;
    acceptedLeaf.actionId[0] <== acceptedActionId[0];
    acceptedLeaf.actionId[1] <== acceptedActionId[1];
    acceptedLeaf.positionCommitment <== positionInput.commitment;
    for (var field = 0; field < 8; field++) {
        acceptedLeaf.ciphertext[field] <== acceptedCiphertext[field];
    }
    acceptedLeaf.committeeEpoch <== acceptedCommitteeEpoch;
    component acceptedPath = MerkleProof(rootLevels);
    acceptedPath.leaf <== acceptedLeaf.out;
    acceptedPath.leafIndex <== acceptedLeafIndex;
    for (var level = 0; level < rootLevels; level++) {
        acceptedPath.siblings[level] <== acceptedSiblings[level];
    }
    acceptedMode * (acceptedPath.root - contextFields[23]) === 0;

    component lotRange = Num2Bits(60);
    lotRange.in <== contextFields[43];
    component payout = PositionCeilDivConstant(4294967296, 84, 33);
    payout.numerator <== contextFields[43] * 10000000;
    component yesChargeRange = Num2Bits(60);
    yesChargeRange.in <== contextFields[36];
    component noChargeRange = Num2Bits(60);
    noChargeRange.in <== contextFields[37];
    component feeRange = Num2Bits(60);
    feeRange.in <== contextFields[39];
    signal chargePerUnit;
    signal charge;
    chargePerUnit <== contextFields[37]
        + inPrivateData[0] * (contextFields[36] - contextFields[37]);
    charge <== chargePerUnit * quantity;
    signal fee;
    signal positionPayout;
    fee <== contextFields[39] * quantity;
    positionPayout <== payout.result * quantity;

    component allocationLeaf = AllocationLeaf();
    allocationLeaf.market[0] <== contextFields[18];
    allocationLeaf.market[1] <== contextFields[19];
    allocationLeaf.epoch <== contextFields[22];
    allocationLeaf.sequence <== sequence;
    allocationLeaf.positionCommitment <== positionInput.commitment;
    allocationLeaf.side <== inPrivateData[0];
    allocationLeaf.charge <== charge;
    allocationLeaf.fee <== fee;
    allocationLeaf.payout <== positionPayout;
    component allocationPath = MerkleProof(rootLevels);
    allocationPath.leaf <== allocationLeaf.out;
    allocationPath.leafIndex <== allocationLeafIndex;
    for (var level = 0; level < rootLevels; level++) {
        allocationPath.siblings[level] <== allocationSiblings[level];
    }
    allocationMode * (allocationPath.root - contextFields[23]) === 0;

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
        outPayloadHash[index] === 0;
        outPrivateData[index][0] === 0;
        outPrivateData[index][1] === 0;
    }
    outPurpose[1] === 0;
    outAmount[1] === 0;

    if (actionCode == 9) {
        component changeZero = IsZero();
        changeZero.in <== outAmount[0];
        outPurpose[0] === 1 - changeZero.out;
        inAmount === charge + fee + outAmount[0];
    }
    if (actionCode == 4) {
        signal winner;
        winner <== inPrivateData[0]
            + (contextFields[24] - 1) * (1 - 2 * inPrivateData[0]);
        winner * (winner - 1) === 0;
        outPurpose[0] === 7 * winner;
        outAmount[0] === positionPayout * winner;
    }
    if (actionCode == 5) {
        outPurpose[0] === 6;
        outAmount[0] === charge + fee
            + acceptedMode * (inAmount - charge - fee);
    }

    outputs[0].commitment === outputCommitment0;
    outputs[1].commitment === outputCommitment1;
    outputs[0].envelopeHash === outputEnvelopeHash0;
    outputs[1].envelopeHash === outputEnvelopeHash1;
    component distinctOutputs = IsEqual();
    distinctOutputs.in[0] <== outputCommitment0;
    distinctOutputs.in[1] <== outputCommitment1;
    distinctOutputs.out === 0;

    component append = AppendTwo(noteLevels);
    append.appendRoot <== appendRoot;
    append.newRoot <== newRoot;
    append.firstLeafIndex <== firstLeafIndex;
    append.outputCommitments[0] <== outputCommitment0;
    append.outputCommitments[1] <== outputCommitment1;
    for (var level = 0; level < noteLevels - 1; level++) {
        append.siblings[level] <== appendSiblings[level];
    }
}
