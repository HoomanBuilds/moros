pragma circom 2.2.0;

include "bitify.circom";
include "order.circom";

template JubAdd() {
    signal input x1;
    signal input y1;
    signal input x2;
    signal input y2;
    signal output xout;
    signal output yout;

    var d = 19257038036680949359750312669786877991949435402254120286184196891950884077233;

    signal xx;
    xx <== x1 * x2;
    signal yy;
    yy <== y1 * y2;
    signal xy;
    xy <== x1 * y2;
    signal yx;
    yx <== y1 * x2;
    signal p;
    p <== xx * yy;

    xout <-- (xy + yx) / (1 + d * p);
    xout * (1 + d * p) === xy + yx;
    yout <-- (yy + xx) / (1 - d * p);
    yout * (1 - d * p) === yy + xx;
}

template JubScalarMul(n) {
    signal input e[n];
    signal input p[2];
    signal output out[2];

    signal accx[n + 1];
    signal accy[n + 1];
    signal basex[n + 1];
    signal basey[n + 1];
    accx[0] <== 0;
    accy[0] <== 1;
    basex[0] <== p[0];
    basey[0] <== p[1];

    component adds[n];
    component dbls[n];
    for (var i = 0; i < n; i++) {
        adds[i] = JubAdd();
        adds[i].x1 <== accx[i];
        adds[i].y1 <== accy[i];
        adds[i].x2 <== basex[i];
        adds[i].y2 <== basey[i];
        accx[i + 1] <== accx[i] + e[i] * (adds[i].xout - accx[i]);
        accy[i + 1] <== accy[i] + e[i] * (adds[i].yout - accy[i]);

        dbls[i] = JubAdd();
        dbls[i].x1 <== basex[i];
        dbls[i].y1 <== basey[i];
        dbls[i].x2 <== basex[i];
        dbls[i].y2 <== basey[i];
        basex[i + 1] <== dbls[i].xout;
        basey[i + 1] <== dbls[i].yout;
    }
    out[0] <== accx[n];
    out[1] <== accy[n];
}

template JubEnc(nb) {
    signal input m;
    signal input r;
    signal input pk[2];
    signal output c1[2];
    signal output c2[2];

    var G8x = 26425721312295396735536009845259662215154440146657062145727563247428679108070;
    var G8y = 33870355149453697655464584064870436861767017640968433840972803788419917420560;

    component rbits = Num2Bits(252);
    rbits.in <== r;
    component mbits = Num2Bits(nb);
    mbits.in <== m;

    component rg = JubScalarMul(252);
    for (var i = 0; i < 252; i++) rg.e[i] <== rbits.out[i];
    rg.p[0] <== G8x;
    rg.p[1] <== G8y;
    c1[0] <== rg.out[0];
    c1[1] <== rg.out[1];

    component mg = JubScalarMul(nb);
    for (var i = 0; i < nb; i++) mg.e[i] <== mbits.out[i];
    mg.p[0] <== G8x;
    mg.p[1] <== G8y;

    component rpk = JubScalarMul(252);
    for (var i = 0; i < 252; i++) rpk.e[i] <== rbits.out[i];
    rpk.p[0] <== pk[0];
    rpk.p[1] <== pk[1];

    component s = JubAdd();
    s.x1 <== mg.out[0];
    s.y1 <== mg.out[1];
    s.x2 <== rpk.out[0];
    s.y2 <== rpk.out[1];
    c2[0] <== s.xout;
    c2[1] <== s.yout;
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

    var d = 19257038036680949359750312669786877991949435402254120286184196891950884077233;
    signal pkxx;
    pkxx <== pk[0] * pk[0];
    signal pkyy;
    pkyy <== pk[1] * pk[1];
    signal pkxy2;
    pkxy2 <== pkxx * pkyy;
    pkyy - pkxx === 1 + d * pkxy2;

    component ab = Num2Bits(64);
    ab.in <== amount;

    signal myes;
    myes <== amount * side;
    signal mno;
    mno <== amount - myes;

    component oc = OrderCommit();
    oc.amount <== amount;
    oc.side <== side;
    oc.secret <== secret;
    oc.nullifier <== nullifier;
    commitment <== oc.commitment;
    nullifierHash <== oc.nullifierHash;

    component eyes = JubEnc(64);
    eyes.m <== myes;
    eyes.r <== ryes;
    eyes.pk[0] <== pk[0];
    eyes.pk[1] <== pk[1];
    c1yes[0] <== eyes.c1[0];
    c1yes[1] <== eyes.c1[1];
    c2yes[0] <== eyes.c2[0];
    c2yes[1] <== eyes.c2[1];

    component eno = JubEnc(64);
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
