pragma circom 2.2.0;

include "bitify.circom";
include "escalarmulfix.circom";
include "escalarmulany.circom";
include "babyjub.circom";
include "poseidon.circom";

template Enc(nb) {
    signal input m;
    signal input r;
    signal input pk[2];
    signal output c1[2];
    signal output c2[2];

    var BASE[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    component rbits = Num2Bits(252);
    rbits.in <== r;
    component mbits = Num2Bits(nb);
    mbits.in <== m;

    component c1mul = EscalarMulFix(252, BASE);
    for (var i = 0; i < 252; i++) c1mul.e[i] <== rbits.out[i];
    c1[0] <== c1mul.out[0];
    c1[1] <== c1mul.out[1];

    component mB = EscalarMulFix(nb, BASE);
    for (var i = 0; i < nb; i++) mB.e[i] <== mbits.out[i];

    component rpk = EscalarMulAny(252);
    for (var i = 0; i < 252; i++) rpk.e[i] <== rbits.out[i];
    rpk.p[0] <== pk[0];
    rpk.p[1] <== pk[1];

    component add = BabyAdd();
    add.x1 <== mB.out[0];
    add.y1 <== mB.out[1];
    add.x2 <== rpk.out[0];
    add.y2 <== rpk.out[1];
    c2[0] <== add.xout;
    c2[1] <== add.yout;
}

template EncryptOrder() {
    signal input amount;
    signal input side;
    signal input secret;
    signal input nullifier;
    signal input ryes;
    signal input rno;
    signal input pk[2];

    signal output commitment;
    signal output nullifierHash;
    signal output c1yes[2];
    signal output c2yes[2];
    signal output c1no[2];
    signal output c2no[2];

    side * (side - 1) === 0;

    component ab = Num2Bits(64);
    ab.in <== amount;

    signal myes;
    myes <== amount * side;
    signal mno;
    mno <== amount - myes;

    component inner = Poseidon(2);
    inner.inputs[0] <== secret;
    inner.inputs[1] <== nullifier;
    component com = Poseidon(3);
    com.inputs[0] <== amount;
    com.inputs[1] <== side;
    com.inputs[2] <== inner.out;
    commitment <== com.out;

    component nh = Poseidon(1);
    nh.inputs[0] <== nullifier;
    nullifierHash <== nh.out;

    component eyes = Enc(64);
    eyes.m <== myes;
    eyes.r <== ryes;
    eyes.pk[0] <== pk[0];
    eyes.pk[1] <== pk[1];
    c1yes[0] <== eyes.c1[0];
    c1yes[1] <== eyes.c1[1];
    c2yes[0] <== eyes.c2[0];
    c2yes[1] <== eyes.c2[1];

    component eno = Enc(64);
    eno.m <== mno;
    eno.r <== rno;
    eno.pk[0] <== pk[0];
    eno.pk[1] <== pk[1];
    c1no[0] <== eno.c1[0];
    c1no[1] <== eno.c1[1];
    c2no[0] <== eno.c2[0];
    c2no[1] <== eno.c2[1];
}

component main { public [ pk ] } = EncryptOrder();
