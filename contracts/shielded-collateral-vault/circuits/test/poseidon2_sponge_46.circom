pragma circom 2.2.3;

include "../poseidon2_sponge.circom";

component main { public [inputs] } = Poseidon2Sponge(46);
