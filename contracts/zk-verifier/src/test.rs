extern crate std;

use crate::{ZkVerifier, ZkVerifierClient};
use ark_bn254::{Bn254, Fr, G1Affine as ArkG1Affine, G2Affine as ArkG2Affine};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Groth16, ProvingKey};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError, Variable};
use ark_std::rand::{rngs::StdRng, SeedableRng};
use privacy_types::{
    action_public_inputs, batch_public_inputs, keyset_domain, BatchProofStatement, BatchQuote,
    CircuitKey, ProofAction, ProofCircuit, ProofStatement, VerificationKeyBytes,
};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec, U256};

#[derive(Clone)]
struct PublicInputCircuit {
    inputs: std::vec::Vec<Fr>,
}

impl ConstraintSynthesizer<Fr> for PublicInputCircuit {
    fn generate_constraints(self, system: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let mut variables = std::vec::Vec::with_capacity(self.inputs.len());
        for value in &self.inputs {
            variables.push(system.new_input_variable(|| Ok(*value))?);
        }
        let witness = system.new_witness_variable(|| Ok(self.inputs[0]))?;
        system.enforce_constraint(witness.into(), Variable::One.into(), variables[0].into())?;
        Ok(())
    }
}

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn circuit(index: u32) -> ProofCircuit {
    match index {
        0 => ProofCircuit::Deposit,
        1 => ProofCircuit::Transfer,
        2 => ProofCircuit::Withdraw,
        3 => ProofCircuit::Order,
        4 => ProofCircuit::Claim,
        5 => ProofCircuit::Refund,
        6 => ProofCircuit::LiquidityFund,
        7 => ProofCircuit::LiquidityExit,
        8 => ProofCircuit::LiquidityRedeem,
        9 => ProofCircuit::ExecutionChange,
        10 => ProofCircuit::Treasury,
        11 => ProofCircuit::ExitRequest,
        12 => ProofCircuit::ExitCancel,
        13 => ProofCircuit::ExitMatch,
        14 => ProofCircuit::Batch,
        _ => panic!("invalid circuit"),
    }
}

fn action_statement(env: &Env) -> ProofStatement {
    ProofStatement {
        action: ProofAction::Deposit,
        context_digest: U256::from_u32(env, 1),
        membership_root: U256::from_u32(env, 2),
        append_root: U256::from_u32(env, 3),
        new_root: U256::from_u32(env, 4),
        input_nullifiers: Vec::new(env),
        output_commitments: Vec::from_array(env, [U256::from_u32(env, 5), U256::from_u32(env, 6)]),
        output_envelope_hashes: Vec::from_array(
            env,
            [U256::from_u32(env, 7), U256::from_u32(env, 8)],
        ),
        first_leaf_index: 7,
        public_amount: 8,
    }
}

fn exit_match_statement(env: &Env) -> ProofStatement {
    ProofStatement {
        action: ProofAction::ExitMatch,
        context_digest: U256::from_u32(env, 1),
        membership_root: U256::from_u32(env, 2),
        append_root: U256::from_u32(env, 3),
        new_root: U256::from_u32(env, 4),
        input_nullifiers: Vec::from_array(
            env,
            [
                U256::from_u32(env, 5),
                U256::from_u32(env, 6),
                U256::from_u32(env, 7),
            ],
        ),
        output_commitments: Vec::from_array(
            env,
            [
                U256::from_u32(env, 8),
                U256::from_u32(env, 9),
                U256::from_u32(env, 10),
                U256::from_u32(env, 11),
            ],
        ),
        output_envelope_hashes: Vec::from_array(
            env,
            [
                U256::from_u32(env, 12),
                U256::from_u32(env, 13),
                U256::from_u32(env, 14),
                U256::from_u32(env, 15),
            ],
        ),
        first_leaf_index: 16,
        public_amount: 0,
    }
}

fn batch_statement(env: &Env) -> BatchProofStatement {
    BatchProofStatement {
        network_domain: id(env, 10),
        vault: Address::generate(env),
        market: Address::generate(env),
        epoch: 1,
        accepted_root: U256::from_u32(env, 11),
        accepted_count: 8,
        first_sequence: 1,
        last_sequence: 8,
        committee_epoch: 1,
        committee_config_hash: id(env, 12),
        committee_public_key_x: U256::from_u32(env, 13),
        committee_public_key_y: U256::from_u32(env, 14),
        aggregate_ciphertext: Vec::from_array(
            env,
            [
                U256::from_u32(env, 15),
                U256::from_u32(env, 16),
                U256::from_u32(env, 17),
                U256::from_u32(env, 18),
            ],
        ),
        decryption_proof_hash: id(env, 14),
        committee_statement_hash: id(env, 15),
        allocation_root: U256::from_u32(env, 19),
        included_root: U256::from_u32(env, 20),
        lot_size: 4_294_967_296,
        quote: BatchQuote {
            state_version: 0,
            batch_size: 8,
            yes_count: 4,
            no_count: 4,
            pre_yes_price: 17,
            post_yes_price: 18,
            yes_price: 19,
            no_price: 20,
            aggregate_market_charge: 21,
            yes_market_cost: 22,
            no_market_cost: 23,
            yes_charge_per_position: 24,
            no_charge_per_position: 25,
            rounding_contribution: 1,
            fee_per_position: 26,
            fee_escrow: 27,
            conditional_lp_fee: 13,
            conditional_protocol_fee: 13,
        },
    }
}

fn fields(values: &Vec<U256>) -> std::vec::Vec<Fr> {
    values
        .iter()
        .map(|value| {
            let bytes = value.to_be_bytes();
            let mut array = [0u8; 32];
            bytes.copy_into_slice(&mut array);
            Fr::from_be_bytes_mod_order(&array)
        })
        .collect()
}

fn build_parameters(values: &Vec<U256>, seed: u64) -> ProvingKey<Bn254> {
    let mut rng = StdRng::seed_from_u64(seed);
    Groth16::<Bn254>::generate_random_parameters_with_reduction(
        PublicInputCircuit {
            inputs: fields(values),
        },
        &mut rng,
    )
    .unwrap()
}

fn prove(env: &Env, values: &Vec<U256>, key: &ProvingKey<Bn254>, seed: u64) -> Bytes {
    let mut rng = StdRng::seed_from_u64(seed);
    let proof = Groth16::<Bn254>::create_random_proof_with_reduction(
        PublicInputCircuit {
            inputs: fields(values),
        },
        key,
        &mut rng,
    )
    .unwrap();
    let mut encoded = Bytes::new(env);
    encoded.append(&Bytes::from_array(env, &g1_bytes(proof.a)));
    encoded.append(&Bytes::from_array(env, &g2_bytes(proof.b)));
    encoded.append(&Bytes::from_array(env, &g1_bytes(proof.c)));
    encoded
}

fn verification_key(env: &Env, key: &ProvingKey<Bn254>) -> VerificationKeyBytes {
    let mut ic = Vec::new(env);
    for point in &key.vk.gamma_abc_g1 {
        ic.push_back(BytesN::from_array(env, &g1_bytes(*point)));
    }
    VerificationKeyBytes {
        alpha: BytesN::from_array(env, &g1_bytes(key.vk.alpha_g1)),
        beta: BytesN::from_array(env, &g2_bytes(key.vk.beta_g2)),
        gamma: BytesN::from_array(env, &g2_bytes(key.vk.gamma_g2)),
        delta: BytesN::from_array(env, &g2_bytes(key.vk.delta_g2)),
        ic,
    }
}

fn g1_bytes(point: ArkG1Affine) -> [u8; 64] {
    let mut bytes = [0u8; 64];
    bytes[..32].copy_from_slice(&point.x.into_bigint().to_bytes_be());
    bytes[32..].copy_from_slice(&point.y.into_bigint().to_bytes_be());
    bytes
}

fn g2_bytes(point: ArkG2Affine) -> [u8; 128] {
    let mut bytes = [0u8; 128];
    bytes[..32].copy_from_slice(&point.x.c1.into_bigint().to_bytes_be());
    bytes[32..64].copy_from_slice(&point.x.c0.into_bigint().to_bytes_be());
    bytes[64..96].copy_from_slice(&point.y.c1.into_bigint().to_bytes_be());
    bytes[96..].copy_from_slice(&point.y.c0.into_bigint().to_bytes_be());
    bytes
}

fn setup() -> (
    Env,
    ZkVerifierClient<'static>,
    ProvingKey<Bn254>,
    ProvingKey<Bn254>,
) {
    let env = Env::default();
    env.mock_all_auths();
    let action = action_statement(&env);
    let exit_match = exit_match_statement(&env);
    let batch = batch_statement(&env);
    let action_inputs = action_public_inputs(&env, &action).unwrap();
    let exit_match_inputs = action_public_inputs(&env, &exit_match).unwrap();
    let batch_inputs = batch_public_inputs(&env, &batch).unwrap();
    let action_key = build_parameters(&action_inputs, 7);
    let exit_match_key = build_parameters(&exit_match_inputs, 9);
    let batch_key = build_parameters(&batch_inputs, 11);
    let action_vk = verification_key(&env, &action_key);
    let exit_match_vk = verification_key(&env, &exit_match_key);
    let batch_vk = verification_key(&env, &batch_key);
    let mut keys = Vec::new(&env);
    for index in 0..15 {
        keys.push_back(CircuitKey {
            circuit: circuit(index),
            schema_hash: id(&env, 30 + index as u8),
            verification_key: if index == 14 {
                batch_vk.clone()
            } else if index == 13 {
                exit_match_vk.clone()
            } else {
                action_vk.clone()
            },
        });
    }
    let expected_domain = keyset_domain(&env, &keys);
    let controller = Address::generate(&env);
    let address = env.register(ZkVerifier, (controller.clone(),));
    let setup_client = ZkVerifierClient::new(&env, &address);
    for key in keys.iter() {
        setup_client.add_key(&controller, &key);
    }
    assert_eq!(setup_client.finalize(&controller), expected_domain);
    let env_static: &'static Env = std::boxed::Box::leak(std::boxed::Box::new(env.clone()));
    let address_static: &'static Address = std::boxed::Box::leak(std::boxed::Box::new(address));
    let client = ZkVerifierClient::new(env_static, address_static);
    assert_eq!(client.domain(), expected_domain);
    (env, client, action_key, batch_key)
}

#[test]
fn verifies_typed_action_and_batch_proofs_and_rejects_statement_changes() {
    let (env, client, action_key, batch_key) = setup();
    let info = client.info();
    assert!(info.finalized);
    assert_eq!(info.circuits, 15);
    assert_eq!(info.required_circuits, 15);
    let action = action_statement(&env);
    let action_inputs = action_public_inputs(&env, &action).unwrap();
    let action_proof = prove(&env, &action_inputs, &action_key, 13);
    assert!(client.verify(&action, &action_proof));

    let mut changed = action.clone();
    changed.public_amount = 9;
    assert!(!client.verify(&changed, &action_proof));
    assert!(!client.verify(&action, &action_proof.slice(0..action_proof.len() - 1)));

    let batch = batch_statement(&env);
    let batch_inputs = batch_public_inputs(&env, &batch).unwrap();
    let batch_proof = prove(&env, &batch_inputs, &batch_key, 17);
    assert!(client.verify_batch(&batch, &batch_proof));
    let mut changed_batch = batch;
    changed_batch.committee_config_hash = id(&env, 99);
    assert!(!client.verify_batch(&changed_batch, &batch_proof));

    let late_key = CircuitKey {
        circuit: ProofCircuit::Deposit,
        schema_hash: id(&env, 100),
        verification_key: verification_key(&env, &action_key),
    };
    assert!(client
        .try_add_key(&Address::generate(&env), &late_key)
        .is_err());
}

#[test]
#[should_panic]
fn finalize_rejects_missing_circuits() {
    let env = Env::default();
    env.mock_all_auths();
    let controller = Address::generate(&env);
    let address = env.register(ZkVerifier, (controller.clone(),));
    ZkVerifierClient::new(&env, &address).finalize(&controller);
}

#[test]
fn domain_is_unavailable_before_finalization() {
    let env = Env::default();
    let controller = Address::generate(&env);
    let address = env.register(ZkVerifier, (controller,));
    assert!(ZkVerifierClient::new(&env, &address).try_domain().is_err());
}
