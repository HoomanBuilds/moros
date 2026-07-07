use coinutils::{
    bls_scalar_to_decimal_string, decimal_string_to_bls_scalar, poseidon_hash, random_fr,
};
use lean_imt::{bls_scalar_to_bytes, LeanIMT};
use soroban_sdk::{crypto::bls12_381::Fr as BlsScalar, Env, U256};

fn main() {
    let env = Env::default();
    let s32 = |n: u32| BlsScalar::from_u256(U256::from_u32(&env, n));

    let mut amount = Vec::new();
    let mut side = Vec::new();
    let mut secret = Vec::new();
    let mut nullifier = Vec::new();
    let mut commitments = Vec::new();

    let orders: Vec<(BlsScalar, BlsScalar, BlsScalar, BlsScalar)> =
        match std::env::args().nth(1) {
            Some(path) => {
                let raw = std::fs::read_to_string(&path).unwrap();
                let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
                v.as_array()
                    .unwrap()
                    .iter()
                    .map(|o| {
                        let g = |k: &str| {
                            decimal_string_to_bls_scalar(&env, o[k].as_str().unwrap()).unwrap()
                        };
                        (g("amount"), g("side"), g("secret"), g("nullifier"))
                    })
                    .collect()
            }
            None => (0u32..4)
                .map(|i| {
                    let (amt, sd) = [(10u32, 1u32), (20, 1), (5, 0), (15, 0)][i as usize];
                    (s32(amt), s32(sd), s32(100 + i * 2), s32(101 + i * 2))
                })
                .collect(),
        };

    for (a, s, sec, nul) in orders {
        let sn = poseidon_hash(&env, &[sec.clone(), nul.clone()]);
        let c = poseidon_hash(&env, &[a.clone(), s.clone(), sn.clone()]);
        amount.push(a);
        side.push(s);
        secret.push(sec);
        nullifier.push(nul);
        commitments.push(c);
    }
    let _ = random_fr;

    let mut tree = LeanIMT::new(&env, 2);
    for c in &commitments {
        tree.insert(bls_scalar_to_bytes(c.clone())).unwrap();
    }
    let root = tree.get_root_scalar();

    let dec = |s: &BlsScalar| bls_scalar_to_decimal_string(s);
    let arr = |v: &Vec<BlsScalar>| {
        v.iter()
            .map(|s| format!("\"{}\"", dec(s)))
            .collect::<Vec<_>>()
            .join(",")
    };

    let mut siblings_json = Vec::new();
    for i in 0..4u32 {
        let (sibs, _) = tree.generate_proof(i).unwrap();
        let row: Vec<String> = sibs.iter().map(|s| format!("\"{}\"", dec(&s))).collect();
        siblings_json.push(format!("[{}]", row.join(",")));
    }

    println!(
        "{{\"orderRoot\":\"{}\",\"amount\":[{}],\"side\":[{}],\"secret\":[{}],\"nullifier\":[{}],\"pathIndex\":[\"0\",\"1\",\"2\",\"3\"],\"siblings\":[{}]}}",
        dec(&root),
        arr(&amount),
        arr(&side),
        arr(&secret),
        arr(&nullifier),
        siblings_json.join(",")
    );
    eprintln!("expected dQYes=30 dQNo=20");
    for c in &commitments {
        eprintln!(
            "COMMIT {}",
            hex::encode(bls_scalar_to_bytes(c.clone()).to_array())
        );
    }
}
