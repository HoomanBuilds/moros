use coinutils::{bls_scalar_to_decimal_string, decimal_string_to_bls_scalar};
use lean_imt::{bls_scalar_to_bytes, bytes_to_bls_scalar, Imt, LeanIMT};
use soroban_sdk::{crypto::bls12_381::Fr as BlsScalar, Env};

fn main() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let path = std::env::args().nth(1).expect("usage: tree_proof <input.json>");
    let raw = std::fs::read_to_string(&path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let depth = v["depth"].as_u64().unwrap_or(16) as u32;
    let leaves: Vec<BlsScalar> = v["leaves"].as_array().unwrap().iter()
        .map(|s| decimal_string_to_bls_scalar(&env, s.as_str().unwrap()).unwrap())
        .collect();

    let mut tree = LeanIMT::new(&env, depth);
    let mut imt = Imt::new(&env, depth);
    for c in &leaves {
        tree.insert(bls_scalar_to_bytes(c.clone())).unwrap();
        imt.insert(bls_scalar_to_bytes(c.clone())).unwrap();
    }
    let root_scalar = tree.get_root_scalar();
    let imt_root_scalar = bytes_to_bls_scalar(&imt.get_root());
    if root_scalar != imt_root_scalar {
        panic!("frontier IMT root != LeanIMT root: on-chain and tool would disagree");
    }
    let dec = |s: &BlsScalar| bls_scalar_to_decimal_string(s);
    let root = dec(&root_scalar);
    let mut proofs = Vec::new();
    for i in 0..leaves.len() {
        let (sibs, _) = tree.generate_proof(i as u32).unwrap();
        let row: Vec<String> = sibs.iter().map(|s| format!("\"{}\"", dec(&s))).collect();
        proofs.push(format!("{{\"pathIndex\":\"{}\",\"siblings\":[{}]}}", i, row.join(",")));
    }
    println!("{{\"orderRoot\":\"{}\",\"proofs\":[{}]}}", root, proofs.join(","));
}
