pragma circom 2.2.3;

include "./poseidon2_sponge.circom";
include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/escalarmulfix.circom";
include "circomlib/circuits/switcher.circom";

template NoteDomain() {
    signal input network[2];
    signal input vault[2];
    signal input token[2];
    signal input verifier[2];
    signal output out;

    component hash = Poseidon2Sponge(9);
    hash.inputs[0] <== 1001;
    hash.inputs[1] <== network[0];
    hash.inputs[2] <== network[1];
    hash.inputs[3] <== vault[0];
    hash.inputs[4] <== vault[1];
    hash.inputs[5] <== token[0];
    hash.inputs[6] <== token[1];
    hash.inputs[7] <== verifier[0];
    hash.inputs[8] <== verifier[1];
    out <== hash.out;
}

template SpendPublicKey() {
    signal input secret;
    signal output out;

    component hash = Poseidon2Sponge(2);
    hash.inputs[0] <== 1002;
    hash.inputs[1] <== secret;
    out <== hash.out;
}

template NoteCommitment() {
    signal input noteDomain;
    signal input purpose;
    signal input amount;
    signal input spendPublicKey;
    signal input viewingPublicKey[2];
    signal input noteId;
    signal input payloadHash;
    signal input privateData[2];
    signal input blinding;
    signal output out;

    component hash = Poseidon2Sponge(12);
    hash.inputs[0] <== 1003;
    hash.inputs[1] <== noteDomain;
    hash.inputs[2] <== purpose;
    hash.inputs[3] <== amount;
    hash.inputs[4] <== spendPublicKey;
    hash.inputs[5] <== viewingPublicKey[0];
    hash.inputs[6] <== viewingPublicKey[1];
    hash.inputs[7] <== noteId;
    hash.inputs[8] <== payloadHash;
    hash.inputs[9] <== privateData[0];
    hash.inputs[10] <== privateData[1];
    hash.inputs[11] <== blinding;
    out <== hash.out;
}

template NoteNullifier() {
    signal input noteDomain;
    signal input nullifierDomain;
    signal input commitment;
    signal input spendSecret;
    signal input noteId;
    signal output out;

    component hash = Poseidon2Sponge(6);
    hash.inputs[0] <== 1004;
    hash.inputs[1] <== noteDomain;
    hash.inputs[2] <== nullifierDomain;
    hash.inputs[3] <== commitment;
    hash.inputs[4] <== spendSecret;
    hash.inputs[5] <== noteId;
    out <== hash.out;
}

template MerkleNode() {
    signal input left;
    signal input right;
    signal output out;

    component hash = Poseidon2Sponge(3);
    hash.inputs[0] <== 1005;
    hash.inputs[1] <== left;
    hash.inputs[2] <== right;
    out <== hash.out;
}

template MerkleProof(levels) {
    signal input leaf;
    signal input leafIndex;
    signal input siblings[levels];
    signal output root;

    component indexBits = Num2Bits(levels);
    indexBits.in <== leafIndex;

    component switches[levels];
    component hashes[levels];
    signal nodes[levels + 1];
    nodes[0] <== leaf;

    for (var level = 0; level < levels; level++) {
        switches[level] = Switcher();
        switches[level].L <== nodes[level];
        switches[level].R <== siblings[level];
        switches[level].sel <== indexBits.out[level];

        hashes[level] = MerkleNode();
        hashes[level].left <== switches[level].outL;
        hashes[level].right <== switches[level].outR;
        nodes[level + 1] <== hashes[level].out;
    }

    root <== nodes[levels];
}

template AppendTwo(levels) {
    assert(levels > 1);

    signal input appendRoot;
    signal input newRoot;
    signal input firstLeafIndex;
    signal input outputCommitments[2];
    signal input siblings[levels - 1];

    signal subtreeIndex;
    subtreeIndex <-- firstLeafIndex \ 2;
    firstLeafIndex === 2 * subtreeIndex;

    component indexBits = Num2Bits(levels - 1);
    indexBits.in <== subtreeIndex;

    component emptyPair = MerkleNode();
    emptyPair.left <== 0;
    emptyPair.right <== 0;

    component outputPair = MerkleNode();
    outputPair.left <== outputCommitments[0];
    outputPair.right <== outputCommitments[1];

    component oldPath = MerkleProof(levels - 1);
    oldPath.leaf <== emptyPair.out;
    oldPath.leafIndex <== subtreeIndex;

    component newPath = MerkleProof(levels - 1);
    newPath.leaf <== outputPair.out;
    newPath.leafIndex <== subtreeIndex;

    for (var level = 0; level < levels - 1; level++) {
        oldPath.siblings[level] <== siblings[level];
        newPath.siblings[level] <== siblings[level];
    }

    oldPath.root === appendRoot;
    newPath.root === newRoot;
}

template AppendOne(levels) {
    signal input appendRoot;
    signal input newRoot;
    signal input leafIndex;
    signal input commitment;
    signal input siblings[levels];

    component oldPath = MerkleProof(levels);
    oldPath.leaf <== 0;
    oldPath.leafIndex <== leafIndex;

    component newPath = MerkleProof(levels);
    newPath.leaf <== commitment;
    newPath.leafIndex <== leafIndex;

    for (var level = 0; level < levels; level++) {
        oldPath.siblings[level] <== siblings[level];
        newPath.siblings[level] <== siblings[level];
    }

    oldPath.root === appendRoot;
    newPath.root === newRoot;
}

template InputNote(levels, nullifierDomain) {
    signal input noteDomain;
    signal input membershipRoot;
    signal input purpose;
    signal input amount;
    signal input spendSecret;
    signal input viewingPublicKey[2];
    signal input noteId;
    signal input payloadHash;
    signal input privateData[2];
    signal input blinding;
    signal input leafIndex;
    signal input siblings[levels];
    signal input expectedNullifier;
    signal output commitment;

    component spendKey = SpendPublicKey();
    spendKey.secret <== spendSecret;

    component note = NoteCommitment();
    note.noteDomain <== noteDomain;
    note.purpose <== purpose;
    note.amount <== amount;
    note.spendPublicKey <== spendKey.out;
    note.viewingPublicKey[0] <== viewingPublicKey[0];
    note.viewingPublicKey[1] <== viewingPublicKey[1];
    note.noteId <== noteId;
    note.payloadHash <== payloadHash;
    note.privateData[0] <== privateData[0];
    note.privateData[1] <== privateData[1];
    note.blinding <== blinding;

    component path = MerkleProof(levels);
    path.leaf <== note.out;
    path.leafIndex <== leafIndex;
    for (var level = 0; level < levels; level++) {
        path.siblings[level] <== siblings[level];
    }
    path.root === membershipRoot;

    component nullifier = NoteNullifier();
    nullifier.noteDomain <== noteDomain;
    nullifier.nullifierDomain <== nullifierDomain;
    nullifier.commitment <== note.out;
    nullifier.spendSecret <== spendSecret;
    nullifier.noteId <== noteId;
    nullifier.out === expectedNullifier;

    commitment <== note.out;
}

template OutputNote(outputIndex) {
    signal input noteDomain;
    signal input purpose;
    signal input amount;
    signal input spendPublicKey;
    signal input viewingPublicKey[2];
    signal input noteId;
    signal input payloadHash;
    signal input privateData[2];
    signal input blinding;
    signal input ephemeralSecret;
    signal input nonce;
    signal input envelope[15];
    signal output commitment;
    signal output envelopeHash;

    component note = NoteCommitment();
    note.noteDomain <== noteDomain;
    note.purpose <== purpose;
    note.amount <== amount;
    note.spendPublicKey <== spendPublicKey;
    note.viewingPublicKey[0] <== viewingPublicKey[0];
    note.viewingPublicKey[1] <== viewingPublicKey[1];
    note.noteId <== noteId;
    note.payloadHash <== payloadHash;
    note.privateData[0] <== privateData[0];
    note.privateData[1] <== privateData[1];
    note.blinding <== blinding;
    commitment <== note.out;

    component recipientCheck = BabyCheck();
    recipientCheck.x <== viewingPublicKey[0];
    recipientCheck.y <== viewingPublicKey[1];

    component recipientDouble0 = BabyDbl();
    recipientDouble0.x <== viewingPublicKey[0];
    recipientDouble0.y <== viewingPublicKey[1];
    component recipientDouble1 = BabyDbl();
    recipientDouble1.x <== recipientDouble0.xout;
    recipientDouble1.y <== recipientDouble0.yout;
    component recipientDouble2 = BabyDbl();
    recipientDouble2.x <== recipientDouble1.xout;
    recipientDouble2.y <== recipientDouble1.yout;

    component recipientIdentity = IsZero();
    recipientIdentity.in <== recipientDouble2.xout;
    recipientIdentity.out === 0;

    component ephemeralBits = Num2Bits(253);
    ephemeralBits.in <== ephemeralSecret;
    for (var bit = 248; bit < 253; bit++) {
        ephemeralBits.out[bit] === 0;
    }
    component ephemeralZero = IsZero();
    ephemeralZero.in <== ephemeralSecret;
    ephemeralZero.out === 0;
    component nonceZero = IsZero();
    nonceZero.in <== nonce;
    nonceZero.out === 0;

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    component ephemeralPublic = EscalarMulFix(253, BASE8);
    component sharedSecret = EscalarMulAny(248);
    for (var bit = 0; bit < 253; bit++) {
        ephemeralPublic.e[bit] <== ephemeralBits.out[bit];
        if (bit < 248) {
            sharedSecret.e[bit] <== ephemeralBits.out[bit];
        }
    }
    sharedSecret.p[0] <== recipientDouble2.xout;
    sharedSecret.p[1] <== recipientDouble2.yout;

    envelope[0] === 1;
    envelope[1] === ephemeralPublic.out[0];
    envelope[2] === ephemeralPublic.out[1];
    envelope[3] === nonce;

    signal plaintext[10];
    plaintext[0] <== purpose;
    plaintext[1] <== amount;
    plaintext[2] <== spendPublicKey;
    plaintext[3] <== viewingPublicKey[0];
    plaintext[4] <== viewingPublicKey[1];
    plaintext[5] <== noteId;
    plaintext[6] <== payloadHash;
    plaintext[7] <== privateData[0];
    plaintext[8] <== privateData[1];
    plaintext[9] <== blinding;

    component pads[10];
    for (var index = 0; index < 10; index++) {
        pads[index] = Poseidon2Sponge(6);
        pads[index].inputs[0] <== 1006;
        pads[index].inputs[1] <== sharedSecret.out[0];
        pads[index].inputs[2] <== sharedSecret.out[1];
        pads[index].inputs[3] <== nonce;
        pads[index].inputs[4] <== outputIndex;
        pads[index].inputs[5] <== index;
        envelope[index + 4] === plaintext[index] + pads[index].out;
    }

    component authentication = Poseidon2Sponge(15);
    authentication.inputs[0] <== 1007;
    authentication.inputs[1] <== sharedSecret.out[0];
    authentication.inputs[2] <== sharedSecret.out[1];
    authentication.inputs[3] <== nonce;
    authentication.inputs[4] <== outputIndex;
    for (var index = 0; index < 10; index++) {
        authentication.inputs[index + 5] <== plaintext[index];
    }
    envelope[14] === authentication.out;

    component envelopeCommitment = Poseidon2Sponge(16);
    envelopeCommitment.inputs[0] <== 1008;
    for (var index = 0; index < 15; index++) {
        envelopeCommitment.inputs[index + 1] <== envelope[index];
    }
    envelopeHash <== envelopeCommitment.out;
}
