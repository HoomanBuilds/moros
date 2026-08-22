pragma circom 2.2.3;

include "./payment_action.circom";

component main { public [
    action,
    contextDigest,
    membershipRoot,
    nullifierCount,
    nullifier0,
    nullifier1,
    nullifier2,
    nullifier3,
    outputCount,
    outputCommitment0,
    outputCommitment1,
    outputCommitment2,
    outputCommitment3,
    outputEnvelopeHash0,
    outputEnvelopeHash1,
    outputEnvelopeHash2,
    outputEnvelopeHash3,
    attachmentHash,
    publicAmountSign,
    publicAmountMagnitude
] } = PrivatePaymentTransfer(20, 4);
