use coinutils::{bls_scalar_to_decimal_string, poseidon_hash, random_fr};
use lean_imt::{bls_scalar_to_bytes, LeanIMT};
use soroban_sdk::{crypto::bls12_381::Fr as BlsScalar, Env, U256};

fn main() {
    let env = Env::default();
    let orders: [(u32, u32); 4] = [(10, 1), (20, 1), (5, 0), (15, 0)];
    let s32 = |n: u32| BlsScalar::from_u256(U256::from_u32(&env, n));

    let mut amount = Vec::new();
    let mut side = Vec::new();
    let mut secret = Vec::new();
    let mut nullifier = Vec::new();
    let mut commitments = Vec::new();
    for (i, (amt, sd)) in orders.iter().enumerate() {
        let a = s32(*amt);
        let s = s32(*sd);
        let sec = s32(100 + (i as u32) * 2);
        let nul = s32(101 + (i as u32) * 2);
        let sn = poseidon_hash(&env, &[sec.clone(), nul.clone()]);
        let c = poseidon_hash(&env, &[a.clone(), s.clone(), sn]);
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
