pragma circom 2.2.3;

include "./position_action.circom";

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
] } = PrivatePositionAction(20, 6, 5);
