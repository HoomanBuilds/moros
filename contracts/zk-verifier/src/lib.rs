#![no_std]

use core::convert::TryInto;
use privacy_types::{
    action_public_inputs, batch_public_inputs, keyset_domain_step, BatchProofStatement, CircuitKey,
    ProofCircuit, ProofStatement, VerificationKeyBytes, PROOF_SIZE, REQUIRED_CIRCUITS,
};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    panic_with_error, vec, Address, Bytes, BytesN, Env, Vec, U256,
};

#[cfg(test)]
mod test;

const G1_SIZE: u32 = 64;
const G2_SIZE: u32 = 128;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Controller,
    Domain,
    Finalized,
    NextCircuit,
    RollingDomain,
    Key(ProofCircuit),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifierInfo {
    pub domain: BytesN<32>,
    pub circuits: u32,
    pub finalized: bool,
    pub required_circuits: u32,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    InvalidConfiguration = 1,
    InvalidCircuitKey = 2,
    NotFinalized = 3,
    AlreadyFinalized = 4,
}

struct Groth16Proof {
    a: Bn254G1Affine,
    b: Bn254G2Affine,
    c: Bn254G1Affine,
}

#[contract]
pub struct ZkVerifier;

#[contractimpl]
impl ZkVerifier {
    pub fn __constructor(env: Env, controller: Address) {
        let instance = env.storage().instance();
        instance.set(&DataKey::Controller, &controller);
        instance.set(&DataKey::Finalized, &false);
        instance.set(&DataKey::NextCircuit, &0u32);
        instance.set(&DataKey::RollingDomain, &BytesN::from_array(&env, &[0; 32]));
        Self::bump_instance(&env);
    }

    pub fn add_key(env: Env, controller: Address, key: CircuitKey) -> BytesN<32> {
        Self::require_setup_controller(&env, &controller);
        let next: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextCircuit)
            .unwrap_or(0);
        if next >= REQUIRED_CIRCUITS
            || key.circuit.code() != next
            || key
                .verification_key
                .ic
                .len()
                .checked_sub(1)
                .is_none_or(|count| count != key.circuit.public_input_count())
            || Self::is_zero(&key.schema_hash)
        {
            panic_with_error!(&env, VerifierError::InvalidCircuitKey);
        }
        let key_storage = DataKey::Key(key.circuit);
        if env.storage().persistent().has(&key_storage) {
            panic_with_error!(&env, VerifierError::InvalidCircuitKey);
        }
        Self::validate_key(&env, &key.verification_key);
        let prior: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::RollingDomain)
            .unwrap();
        let domain = keyset_domain_step(&env, &prior, &key);
        env.storage().persistent().set(&key_storage, &key);
        env.storage()
            .instance()
            .set(&DataKey::RollingDomain, &domain);
        env.storage()
            .instance()
            .set(&DataKey::NextCircuit, &(next + 1));
        Self::bump_key(&env, &key_storage);
        Self::bump_instance(&env);
        domain
    }

    pub fn finalize(env: Env, controller: Address) -> BytesN<32> {
        Self::require_setup_controller(&env, &controller);
        let next: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextCircuit)
            .unwrap_or(0);
        if next != REQUIRED_CIRCUITS {
            panic_with_error!(&env, VerifierError::InvalidConfiguration);
        }
        let domain: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::RollingDomain)
            .unwrap();
        let instance = env.storage().instance();
        instance.set(&DataKey::Domain, &domain);
        instance.set(&DataKey::Finalized, &true);
        instance.remove(&DataKey::Controller);
        Self::bump_instance(&env);
        domain
    }

    pub fn info(env: Env) -> VerifierInfo {
        Self::bump_instance(&env);
        let finalized = Self::is_finalized(&env);
        VerifierInfo {
            domain: if finalized {
                env.storage().instance().get(&DataKey::Domain).unwrap()
            } else {
                env.storage()
                    .instance()
                    .get(&DataKey::RollingDomain)
                    .unwrap()
            },
            circuits: env
                .storage()
                .instance()
                .get(&DataKey::NextCircuit)
                .unwrap_or(0),
            finalized,
            required_circuits: REQUIRED_CIRCUITS,
        }
    }

    pub fn domain(env: Env) -> BytesN<32> {
        if !Self::is_finalized(&env) {
            panic_with_error!(&env, VerifierError::NotFinalized);
        }
        Self::info(env).domain
    }

    pub fn circuit_key(env: Env, circuit: ProofCircuit) -> Option<CircuitKey> {
        let key = DataKey::Key(circuit);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_key(&env, &key);
        }
        value
    }

    pub fn verify(env: Env, statement: ProofStatement, proof: Bytes) -> bool {
        if !Self::is_finalized(&env) {
            return false;
        }
        let Ok(inputs) = action_public_inputs(&env, &statement) else {
            return false;
        };
        Self::verify_for_circuit(
            &env,
            ProofCircuit::from_action(statement.action),
            proof,
            inputs,
        )
    }

    pub fn verify_batch(env: Env, statement: BatchProofStatement, proof: Bytes) -> bool {
        if !Self::is_finalized(&env) {
            return false;
        }
        let Ok(inputs) = batch_public_inputs(&env, &statement) else {
            return false;
        };
        Self::verify_for_circuit(&env, ProofCircuit::Batch, proof, inputs)
    }

    fn verify_for_circuit(
        env: &Env,
        circuit: ProofCircuit,
        proof_bytes: Bytes,
        inputs: Vec<U256>,
    ) -> bool {
        let Some(key) = env
            .storage()
            .persistent()
            .get::<_, CircuitKey>(&DataKey::Key(circuit))
        else {
            return false;
        };
        Self::bump_key(env, &DataKey::Key(circuit));
        let Some(proof) = Self::parse_proof(proof_bytes) else {
            return false;
        };
        Self::verify_with_key(env, &key.verification_key, proof, inputs)
    }

    fn verify_with_key(
        env: &Env,
        key: &VerificationKeyBytes,
        proof: Groth16Proof,
        inputs: Vec<U256>,
    ) -> bool {
        if inputs.len().checked_add(1) != Some(key.ic.len()) {
            return false;
        }
        let bn = env.crypto().bn254();
        let mut points = Vec::new(env);
        let mut scalars = Vec::new(env);
        for index in 0..inputs.len() {
            points.push_back(Bn254G1Affine::from_bytes(key.ic.get(index + 1).unwrap()));
            scalars.push_back(Bn254Fr::from_u256(inputs.get(index).unwrap()));
        }
        let product = bn.g1_msm(points, scalars);
        let constant = Bn254G1Affine::from_bytes(key.ic.get(0).unwrap());
        let vk_x = bn.g1_add(&constant, &product);
        let g1 = vec![
            env,
            -proof.a,
            Bn254G1Affine::from_bytes(key.alpha.clone()),
            vk_x,
            proof.c,
        ];
        let g2 = vec![
            env,
            proof.b,
            Bn254G2Affine::from_bytes(key.beta.clone()),
            Bn254G2Affine::from_bytes(key.gamma.clone()),
            Bn254G2Affine::from_bytes(key.delta.clone()),
        ];
        bn.pairing_check(g1, g2)
    }

    fn parse_proof(value: Bytes) -> Option<Groth16Proof> {
        if value.len() != PROOF_SIZE {
            return None;
        }
        let a_bytes: BytesN<64> = value.slice(0..G1_SIZE).try_into().ok()?;
        let b_bytes: BytesN<128> = value.slice(G1_SIZE..G1_SIZE + G2_SIZE).try_into().ok()?;
        let c_bytes: BytesN<64> = value.slice(G1_SIZE + G2_SIZE..).try_into().ok()?;
        if Self::is_zero(&a_bytes) || Self::is_zero(&b_bytes) || Self::is_zero(&c_bytes) {
            return None;
        }
        Some(Groth16Proof {
            a: Bn254G1Affine::from_bytes(a_bytes),
            b: Bn254G2Affine::from_bytes(b_bytes),
            c: Bn254G1Affine::from_bytes(c_bytes),
        })
    }

    fn validate_key(env: &Env, key: &VerificationKeyBytes) {
        if Self::is_zero(&key.alpha)
            || Self::is_zero(&key.beta)
            || Self::is_zero(&key.gamma)
            || Self::is_zero(&key.delta)
            || key.ic.is_empty()
        {
            panic_with_error!(env, VerifierError::InvalidCircuitKey);
        }
        let bn = env.crypto().bn254();
        let alpha = Bn254G1Affine::from_bytes(key.alpha.clone());
        if !bn.g1_is_on_curve(&alpha) {
            panic_with_error!(env, VerifierError::InvalidCircuitKey);
        }
        for point in key.ic.iter() {
            if Self::is_zero(&point) || !bn.g1_is_on_curve(&Bn254G1Affine::from_bytes(point)) {
                panic_with_error!(env, VerifierError::InvalidCircuitKey);
            }
        }
        let zero = Bn254G1Affine::from_bytes(BytesN::from_array(env, &[0; 64]));
        let valid_g2 = bn.pairing_check(
            vec![env, zero.clone(), zero.clone(), zero],
            vec![
                env,
                Bn254G2Affine::from_bytes(key.beta.clone()),
                Bn254G2Affine::from_bytes(key.gamma.clone()),
                Bn254G2Affine::from_bytes(key.delta.clone()),
            ],
        );
        if !valid_g2 {
            panic_with_error!(env, VerifierError::InvalidCircuitKey);
        }
    }

    fn require_setup_controller(env: &Env, controller: &Address) {
        if Self::is_finalized(env) {
            panic_with_error!(env, VerifierError::AlreadyFinalized);
        }
        let configured: Address = env
            .storage()
            .instance()
            .get(&DataKey::Controller)
            .unwrap_or_else(|| panic_with_error!(env, VerifierError::InvalidConfiguration));
        if configured != *controller {
            panic_with_error!(env, VerifierError::InvalidConfiguration);
        }
        controller.require_auth();
    }

    fn is_finalized(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Finalized)
            .unwrap_or(false)
    }

    fn is_zero<const N: usize>(value: &BytesN<N>) -> bool {
        value.to_array().iter().all(|byte| *byte == 0)
    }

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn bump_key(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}
