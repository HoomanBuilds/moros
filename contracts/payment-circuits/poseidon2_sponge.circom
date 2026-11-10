pragma circom 2.2.3;

include "./vendor/stellar-private-payments/poseidon2/poseidon2_perm.circom";

template Poseidon2Sponge(n) {
    assert(n > 0);

    var rate = 3;
    var blocks = (n + rate - 1) \ rate;
    var capacity = n * 18446744073709551616;

    signal input inputs[n];
    signal output out;

    component permutations[blocks];
    signal state[blocks][4];

    for (var block = 0; block < blocks; block++) {
        permutations[block] = Permutation(4);

        for (var cell = 0; cell < rate; cell++) {
            var inputIndex = block * rate + cell;
            if (block == 0) {
                if (inputIndex < n) {
                    state[block][cell] <== inputs[inputIndex];
                } else {
                    state[block][cell] <== 0;
                }
            } else {
                if (inputIndex < n) {
                    state[block][cell] <== permutations[block - 1].out[cell] + inputs[inputIndex];
                } else {
                    state[block][cell] <== permutations[block - 1].out[cell];
                }
            }
            permutations[block].inputs[cell] <== state[block][cell];
        }

        if (block == 0) {
            state[block][3] <== capacity;
        } else {
            state[block][3] <== permutations[block - 1].out[3];
        }
        permutations[block].inputs[3] <== state[block][3];
    }

    out <== permutations[blocks - 1].out[0];
}
