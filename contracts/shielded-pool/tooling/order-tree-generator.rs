use coinutils::{bls_scalar_to_decimal_string, decimal_string_to_bls_scalar, poseidon_hash};
use lean_imt::{bls_scalar_to_bytes, bytes_to_bls_scalar, Imt, LeanIMT};
use soroban_sdk::{crypto::bls12_381::Fr as BlsScalar, Env};

fn main() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let path = std::env::args().nth(1).expect("usage: order_tree <orders.json> [depth]");
    let depth: u32 = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(16);

    let raw = std::fs::read_to_string(&path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let orders = v.as_array().unwrap();

    let mut commitments = Vec::new();
    let mut null_hashes = Vec::new();
    for o in orders {
        let g = |k: &str| decimal_string_to_bls_scalar(&env, o[k].as_str().unwrap()).unwrap();
        let (a, s, sec, nul) = (g("amount"), g("side"), g("secret"), g("nullifier"));
        let sn = poseidon_hash(&env, &[sec, nul.clone()]);
        let c = poseidon_hash(&env, &[a, s, sn]);
        let nh = poseidon_hash(&env, &[nul]);
        commitments.push(c);
        null_hashes.push(nh);
    }

    let mut tree = LeanIMT::new(&env, depth);
    let mut imt = Imt::new(&env, depth);
    for c in &commitments {
        tree.insert(bls_scalar_to_bytes(c.clone())).unwrap();
        imt.insert(bls_scalar_to_bytes(c.clone())).unwrap();
    }
    let root = tree.get_root_scalar();
    let imt_root = bytes_to_bls_scalar(&imt.get_root());
    if root != imt_root {
        panic!("frontier IMT root != LeanIMT root: on-chain and tool would disagree");
    }
    let dec = |s: &BlsScalar| bls_scalar_to_decimal_string(s);

    let mut entries = Vec::new();
    for (i, c) in commitments.iter().enumerate() {
        let (sibs, _) = tree.generate_proof(i as u32).unwrap();
        let row: Vec<String> = sibs.iter().map(|s| format!("\"{}\"", dec(&s))).collect();
        entries.push(format!(
            "{{\"commitment\":\"{}\",\"nullifierHash\":\"{}\",\"pathIndex\":\"{}\",\"siblings\":[{}]}}",
            dec(c),
            dec(&null_hashes[i]),
            i,
            row.join(",")
        ));
    }

    println!(
        "{{\"depth\":{},\"orderRoot\":\"{}\",\"orders\":[{}]}}",
        depth,
        dec(&root),
        entries.join(",")
    );
}
