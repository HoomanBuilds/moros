#![no_std]

use soroban_poseidon::poseidon2_hash;
use soroban_sdk::crypto::bn254::Bn254Fr;
use soroban_sdk::{
    contracterror, contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec, U256,
};

pub const ACTION_PUBLIC_INPUTS: u32 = 15;
pub const EXIT_MATCH_PUBLIC_INPUTS: u32 = 20;
pub const BATCH_PUBLIC_INPUTS: u32 = 45;
pub const OPERATION_BINDING_FIELDS: u32 = 24;
pub const OPERATION_CONTEXT_FIELDS: u32 = 46;
pub const OUTPUT_ENVELOPE_FIELDS: u32 = 15;
pub const OUTPUT_ENVELOPE_LENGTH: u32 = OUTPUT_ENVELOPE_FIELDS * 32;
pub const OUTPUT_ENVELOPE_VERSION: u32 = 1;
pub const OUTPUT_ENVELOPE_HASH_TAG: u32 = 1008;
pub const MERKLE_NODE_HASH_TAG: u32 = 1005;
pub const PROOF_SIZE: u32 = 256;
pub const REQUIRED_CIRCUITS: u32 = 15;
pub const OPERATION_CONTEXT_VERSION: u32 = 1;

const BN254_SCALAR_MODULUS: [u8; 32] = [
    48, 100, 78, 114, 225, 49, 160, 41, 184, 80, 69, 182, 129, 129, 88, 93, 40, 51, 232, 72, 121,
    185, 112, 145, 67, 225, 245, 147, 240, 0, 0, 1,
];

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProofAction {
    Deposit,
    Transfer,
    Withdraw,
    Order,
    Claim,
    Refund,
    LiquidityFund,
    LiquidityExit,
    LiquidityRedeem,
    ExecutionChange,
    Treasury,
    ExitRequest,
    ExitCancel,
    ExitMatch,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BindingKind {
    Empty,
    Liquidity,
    Order,
    Refund,
    Allocation,
    Treasury,
    ExitRequest,
    ExitCancel,
    ExitMatch,
}

impl BindingKind {
    pub fn code(self) -> u32 {
        match self {
            Self::Empty => 0,
            Self::Liquidity => 1,
            Self::Order => 2,
            Self::Refund => 3,
            Self::Allocation => 4,
            Self::Treasury => 5,
            Self::ExitRequest => 6,
            Self::ExitCancel => 7,
            Self::ExitMatch => 8,
        }
    }
}

impl ProofAction {
    pub fn code(self) -> u32 {
        match self {
            Self::Deposit => 0,
            Self::Transfer => 1,
            Self::Withdraw => 2,
            Self::Order => 3,
            Self::Claim => 4,
            Self::Refund => 5,
            Self::LiquidityFund => 6,
            Self::LiquidityExit => 7,
            Self::LiquidityRedeem => 8,
            Self::ExecutionChange => 9,
            Self::Treasury => 10,
            Self::ExitRequest => 11,
            Self::ExitCancel => 12,
            Self::ExitMatch => 13,
        }
    }
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProofCircuit {
    Deposit,
    Transfer,
    Withdraw,
    Order,
    Claim,
    Refund,
    LiquidityFund,
    LiquidityExit,
    LiquidityRedeem,
    ExecutionChange,
    Treasury,
    ExitRequest,
    ExitCancel,
    ExitMatch,
    Batch,
}

impl ProofCircuit {
    pub fn code(self) -> u32 {
        match self {
            Self::Deposit => 0,
            Self::Transfer => 1,
            Self::Withdraw => 2,
            Self::Order => 3,
            Self::Claim => 4,
            Self::Refund => 5,
            Self::LiquidityFund => 6,
            Self::LiquidityExit => 7,
            Self::LiquidityRedeem => 8,
            Self::ExecutionChange => 9,
            Self::Treasury => 10,
            Self::ExitRequest => 11,
            Self::ExitCancel => 12,
            Self::ExitMatch => 13,
            Self::Batch => 14,
        }
    }

    pub fn from_action(action: ProofAction) -> Self {
        match action {
            ProofAction::Deposit => Self::Deposit,
            ProofAction::Transfer => Self::Transfer,
            ProofAction::Withdraw => Self::Withdraw,
            ProofAction::Order => Self::Order,
            ProofAction::Claim => Self::Claim,
            ProofAction::Refund => Self::Refund,
            ProofAction::LiquidityFund => Self::LiquidityFund,
            ProofAction::LiquidityExit => Self::LiquidityExit,
            ProofAction::LiquidityRedeem => Self::LiquidityRedeem,
            ProofAction::ExecutionChange => Self::ExecutionChange,
            ProofAction::Treasury => Self::Treasury,
            ProofAction::ExitRequest => Self::ExitRequest,
            ProofAction::ExitCancel => Self::ExitCancel,
            ProofAction::ExitMatch => Self::ExitMatch,
        }
    }

    pub fn public_input_count(self) -> u32 {
        match self {
            Self::Batch => BATCH_PUBLIC_INPUTS,
            Self::ExitMatch => EXIT_MATCH_PUBLIC_INPUTS,
            _ => ACTION_PUBLIC_INPUTS,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchQuote {
    pub state_version: u64,
    pub batch_size: u32,
    pub yes_count: u32,
    pub no_count: u32,
    pub pre_yes_price: i128,
    pub post_yes_price: i128,
    pub yes_price: i128,
    pub no_price: i128,
    pub aggregate_market_charge: i128,
    pub yes_market_cost: i128,
    pub no_market_cost: i128,
    pub yes_charge_per_position: i128,
    pub no_charge_per_position: i128,
    pub rounding_contribution: i128,
    pub fee_per_position: i128,
    pub fee_escrow: i128,
    pub conditional_lp_fee: i128,
    pub conditional_protocol_fee: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofStatement {
    pub action: ProofAction,
    pub context_digest: U256,
    pub membership_root: U256,
    pub append_root: U256,
    pub new_root: U256,
    pub input_nullifiers: Vec<U256>,
    pub output_commitments: Vec<U256>,
    pub output_envelope_hashes: Vec<U256>,
    pub first_leaf_index: u32,
    pub public_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationBinding {
    pub kind: BindingKind,
    pub fields: Vec<U256>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationContext {
    pub network_domain: BytesN<32>,
    pub vault: Address,
    pub token: Address,
    pub verifier_domain: BytesN<32>,
    pub action: ProofAction,
    pub action_id: BytesN<32>,
    pub public_account: Option<Address>,
    pub public_amount: i128,
    pub market: Option<Address>,
    pub binding: OperationBinding,
    pub expiry: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchProofStatement {
    pub network_domain: BytesN<32>,
    pub vault: Address,
    pub market: Address,
    pub epoch: u64,
    pub accepted_root: U256,
    pub accepted_count: u32,
    pub first_sequence: u64,
    pub last_sequence: u64,
    pub committee_epoch: u64,
    pub committee_config_hash: BytesN<32>,
    pub committee_public_key_x: U256,
    pub committee_public_key_y: U256,
    pub aggregate_ciphertext: Vec<U256>,
    pub decryption_proof_hash: BytesN<32>,
    pub committee_statement_hash: BytesN<32>,
    pub allocation_root: U256,
    pub included_root: U256,
    pub lot_size: i128,
    pub quote: BatchQuote,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationKeyBytes {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircuitKey {
    pub circuit: ProofCircuit,
    pub schema_hash: BytesN<32>,
    pub verification_key: VerificationKeyBytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KeyDomainStep {
    pub prior: BytesN<32>,
    pub key: CircuitKey,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SignalError {
    InvalidShape = 1,
    NonCanonicalField = 2,
    NegativeBatchValue = 3,
    MalformedProof = 4,
}

pub fn scalar_modulus(env: &Env) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &BN254_SCALAR_MODULUS))
}

pub fn is_canonical_field(env: &Env, value: &U256) -> bool {
    value < &scalar_modulus(env)
}

pub fn action_public_inputs(
    env: &Env,
    statement: &ProofStatement,
) -> Result<Vec<U256>, SignalError> {
    let exit_match = statement.action == ProofAction::ExitMatch;
    let nullifier_slots = if exit_match { 3 } else { 2 };
    let output_slots = if exit_match { 4 } else { 2 };
    if statement.input_nullifiers.len() > nullifier_slots
        || statement.output_commitments.len() != output_slots
        || statement.output_envelope_hashes.len() != output_slots
    {
        return Err(SignalError::InvalidShape);
    }
    if !is_canonical_field(env, &statement.membership_root)
        || !is_canonical_field(env, &statement.append_root)
        || !is_canonical_field(env, &statement.new_root)
    {
        return Err(SignalError::NonCanonicalField);
    }

    let mut signals = Vec::new(env);
    signals.push_back(U256::from_u32(env, statement.action.code()));
    push_field(env, &mut signals, &statement.context_digest)?;
    push_field(env, &mut signals, &statement.membership_root)?;
    push_field(env, &mut signals, &statement.append_root)?;
    push_field(env, &mut signals, &statement.new_root)?;
    signals.push_back(U256::from_u32(env, statement.input_nullifiers.len()));
    for index in 0..nullifier_slots {
        let value = statement
            .input_nullifiers
            .get(index)
            .unwrap_or_else(|| U256::from_u32(env, 0));
        push_field(env, &mut signals, &value)?;
    }
    for commitment in statement.output_commitments.iter() {
        push_field(env, &mut signals, &commitment)?;
    }
    for envelope_hash in statement.output_envelope_hashes.iter() {
        push_field(env, &mut signals, &envelope_hash)?;
    }
    signals.push_back(U256::from_u32(env, statement.first_leaf_index));
    let (sign, magnitude) = signed_i128(statement.public_amount);
    signals.push_back(U256::from_u32(env, sign));
    signals.push_back(U256::from_u128(env, magnitude));
    let expected_inputs = if exit_match {
        EXIT_MATCH_PUBLIC_INPUTS
    } else {
        ACTION_PUBLIC_INPUTS
    };
    if signals.len() != expected_inputs {
        return Err(SignalError::InvalidShape);
    }
    Ok(signals)
}

pub fn empty_operation_binding(env: &Env) -> OperationBinding {
    OperationBinding {
        kind: BindingKind::Empty,
        fields: zero_fields(env),
    }
}

pub fn operation_context_fields(
    env: &Env,
    context: &OperationContext,
) -> Result<Vec<U256>, SignalError> {
    if context.binding.fields.len() != OPERATION_BINDING_FIELDS {
        return Err(SignalError::InvalidShape);
    }
    let mut fields = Vec::new(env);
    fields.push_back(U256::from_u32(env, OPERATION_CONTEXT_VERSION));
    push_bytes32(env, &mut fields, &context.network_domain);
    push_address(env, &mut fields, &context.vault);
    push_address(env, &mut fields, &context.token);
    push_bytes32(env, &mut fields, &context.verifier_domain);
    fields.push_back(U256::from_u32(env, context.action.code()));
    push_bytes32(env, &mut fields, &context.action_id);
    push_optional_address(env, &mut fields, &context.public_account);
    let (amount_sign, amount_magnitude) = signed_i128(context.public_amount);
    fields.push_back(U256::from_u32(env, amount_sign));
    fields.push_back(U256::from_u128(env, amount_magnitude));
    push_optional_address(env, &mut fields, &context.market);
    fields.push_back(U256::from_u128(env, context.expiry as u128));
    fields.push_back(U256::from_u32(env, context.binding.kind.code()));
    for value in context.binding.fields.iter() {
        push_field(env, &mut fields, &value)?;
    }
    if fields.len() != OPERATION_CONTEXT_FIELDS {
        return Err(SignalError::InvalidShape);
    }
    Ok(fields)
}

pub fn operation_context_digest(
    env: &Env,
    context: &OperationContext,
) -> Result<U256, SignalError> {
    let fields = operation_context_fields(env, context)?;
    Ok(poseidon2_hash::<4, Bn254Fr>(env, &fields))
}

pub fn output_envelope_fields(env: &Env, envelope: &Bytes) -> Result<Vec<U256>, SignalError> {
    if envelope.len() != OUTPUT_ENVELOPE_LENGTH {
        return Err(SignalError::InvalidShape);
    }
    let mut fields = Vec::new(env);
    for index in 0..OUTPUT_ENVELOPE_FIELDS {
        let start = index * 32;
        let value: BytesN<32> = envelope
            .slice(start..start + 32)
            .try_into()
            .map_err(|_| SignalError::InvalidShape)?;
        let field = U256::from_be_bytes(env, &Bytes::from(value));
        push_field(env, &mut fields, &field)?;
    }
    if fields.get(0) != Some(U256::from_u32(env, OUTPUT_ENVELOPE_VERSION)) {
        return Err(SignalError::InvalidShape);
    }
    Ok(fields)
}

pub fn output_envelope_hash(env: &Env, envelope: &Bytes) -> Result<U256, SignalError> {
    let fields = output_envelope_fields(env, envelope)?;
    let mut preimage = Vec::new(env);
    preimage.push_back(U256::from_u32(env, OUTPUT_ENVELOPE_HASH_TAG));
    for field in fields.iter() {
        preimage.push_back(field);
    }
    Ok(poseidon2_hash::<4, Bn254Fr>(env, &preimage))
}

pub fn tagged_poseidon2_hash(env: &Env, tag: u32, fields: &Vec<U256>) -> Result<U256, SignalError> {
    let mut preimage = Vec::new(env);
    preimage.push_back(U256::from_u32(env, tag));
    for field in fields.iter() {
        push_field(env, &mut preimage, &field)?;
    }
    Ok(poseidon2_hash::<4, Bn254Fr>(env, &preimage))
}

pub fn merkle_node(env: &Env, left: &U256, right: &U256) -> Result<U256, SignalError> {
    tagged_poseidon2_hash(
        env,
        MERKLE_NODE_HASH_TAG,
        &Vec::from_array(env, [left.clone(), right.clone()]),
    )
}

pub fn empty_merkle_root(env: &Env, levels: u32) -> U256 {
    let mut root = U256::from_u32(env, 0);
    for _ in 0..levels {
        root = merkle_node(env, &root, &root).unwrap();
    }
    root
}

pub fn is_valid_babyjub_encryption_point(env: &Env, x: &U256, y: &U256) -> bool {
    if !is_canonical_field(env, x) || !is_canonical_field(env, y) {
        return false;
    }
    let bn = env.crypto().bn254();
    let a = Bn254Fr::from_u256(U256::from_u32(env, 168_700));
    let d = Bn254Fr::from_u256(U256::from_u32(env, 168_696));
    let one = Bn254Fr::from_u256(U256::from_u32(env, 1));
    let mut point = (Bn254Fr::from_u256(x.clone()), Bn254Fr::from_u256(y.clone()));
    let x_squared = bn.fr_mul(&point.0, &point.0);
    let y_squared = bn.fr_mul(&point.1, &point.1);
    let left = bn.fr_add(&bn.fr_mul(&a, &x_squared), &y_squared);
    let right = bn.fr_add(&one, &bn.fr_mul(&d, &bn.fr_mul(&x_squared, &y_squared)));
    if left != right {
        return false;
    }
    for _ in 0..3 {
        let product = bn.fr_mul(
            &bn.fr_mul(&point.0, &point.0),
            &bn.fr_mul(&point.1, &point.1),
        );
        let x_denominator = bn.fr_add(&one, &bn.fr_mul(&d, &product));
        let y_denominator = bn.fr_sub(&one, &bn.fr_mul(&d, &product));
        if x_denominator.as_u256() == &U256::from_u32(env, 0)
            || y_denominator.as_u256() == &U256::from_u32(env, 0)
        {
            return false;
        }
        let x_numerator = bn.fr_mul(
            &Bn254Fr::from_u256(U256::from_u32(env, 2)),
            &bn.fr_mul(&point.0, &point.1),
        );
        let y_numerator = bn.fr_sub(
            &bn.fr_mul(&point.1, &point.1),
            &bn.fr_mul(&a, &bn.fr_mul(&point.0, &point.0)),
        );
        point = (
            bn.fr_mul(&x_numerator, &x_denominator.inv()),
            bn.fr_mul(&y_numerator, &y_denominator.inv()),
        );
    }
    point.0.as_u256() != &U256::from_u32(env, 0)
}

pub fn zero_fields(env: &Env) -> Vec<U256> {
    let mut fields = Vec::new(env);
    for _ in 0..OPERATION_BINDING_FIELDS {
        fields.push_back(U256::from_u32(env, 0));
    }
    fields
}

pub fn set_binding_field(
    fields: &mut Vec<U256>,
    index: u32,
    value: U256,
) -> Result<(), SignalError> {
    if fields.len() != OPERATION_BINDING_FIELDS || index >= OPERATION_BINDING_FIELDS {
        return Err(SignalError::InvalidShape);
    }
    if !is_canonical_field(value.env(), &value) {
        return Err(SignalError::NonCanonicalField);
    }
    fields.set(index, value);
    Ok(())
}

pub fn bytes32_limbs(env: &Env, value: &BytesN<32>) -> (U256, U256) {
    let bytes = value.to_array();
    let mut high = [0u8; 16];
    let mut low = [0u8; 16];
    high.copy_from_slice(&bytes[..16]);
    low.copy_from_slice(&bytes[16..]);
    (
        U256::from_u128(env, u128::from_be_bytes(high)),
        U256::from_u128(env, u128::from_be_bytes(low)),
    )
}

pub fn address_limbs(env: &Env, value: &Address) -> (U256, U256) {
    let digest: BytesN<32> = env.crypto().sha256(&value.to_xdr(env)).into();
    bytes32_limbs(env, &digest)
}

pub fn batch_public_inputs(
    env: &Env,
    statement: &BatchProofStatement,
) -> Result<Vec<U256>, SignalError> {
    if statement.aggregate_ciphertext.len() != 4 {
        return Err(SignalError::InvalidShape);
    }
    let mut signals = Vec::new(env);
    push_bytes32(env, &mut signals, &statement.network_domain);
    push_address(env, &mut signals, &statement.vault);
    push_address(env, &mut signals, &statement.market);
    signals.push_back(U256::from_u128(env, statement.epoch as u128));
    push_field(env, &mut signals, &statement.accepted_root)?;
    signals.push_back(U256::from_u32(env, statement.accepted_count));
    signals.push_back(U256::from_u128(env, statement.first_sequence as u128));
    signals.push_back(U256::from_u128(env, statement.last_sequence as u128));
    signals.push_back(U256::from_u128(env, statement.committee_epoch as u128));
    push_bytes32(env, &mut signals, &statement.committee_config_hash);
    push_field(env, &mut signals, &statement.committee_public_key_x)?;
    push_field(env, &mut signals, &statement.committee_public_key_y)?;
    for coordinate in statement.aggregate_ciphertext.iter() {
        push_field(env, &mut signals, &coordinate)?;
    }
    push_bytes32(env, &mut signals, &statement.decryption_proof_hash);
    push_bytes32(env, &mut signals, &statement.committee_statement_hash);
    push_field(env, &mut signals, &statement.allocation_root)?;
    push_field(env, &mut signals, &statement.included_root)?;
    push_nonnegative_i128(env, &mut signals, statement.lot_size)?;

    let quote = &statement.quote;
    signals.push_back(U256::from_u128(env, quote.state_version as u128));
    signals.push_back(U256::from_u32(env, quote.batch_size));
    signals.push_back(U256::from_u32(env, quote.yes_count));
    signals.push_back(U256::from_u32(env, quote.no_count));
    push_nonnegative_i128(env, &mut signals, quote.pre_yes_price)?;
    push_nonnegative_i128(env, &mut signals, quote.post_yes_price)?;
    push_nonnegative_i128(env, &mut signals, quote.yes_price)?;
    push_nonnegative_i128(env, &mut signals, quote.no_price)?;
    push_nonnegative_i128(env, &mut signals, quote.aggregate_market_charge)?;
    push_nonnegative_i128(env, &mut signals, quote.yes_market_cost)?;
    push_nonnegative_i128(env, &mut signals, quote.no_market_cost)?;
    push_nonnegative_i128(env, &mut signals, quote.yes_charge_per_position)?;
    push_nonnegative_i128(env, &mut signals, quote.no_charge_per_position)?;
    push_nonnegative_i128(env, &mut signals, quote.rounding_contribution)?;
    push_nonnegative_i128(env, &mut signals, quote.fee_per_position)?;
    push_nonnegative_i128(env, &mut signals, quote.fee_escrow)?;
    push_nonnegative_i128(env, &mut signals, quote.conditional_lp_fee)?;
    push_nonnegative_i128(env, &mut signals, quote.conditional_protocol_fee)?;
    if signals.len() != BATCH_PUBLIC_INPUTS {
        return Err(SignalError::InvalidShape);
    }
    Ok(signals)
}

pub fn keyset_domain(env: &Env, keys: &Vec<CircuitKey>) -> BytesN<32> {
    let mut domain = BytesN::from_array(env, &[0; 32]);
    for key in keys.iter() {
        domain = keyset_domain_step(env, &domain, &key);
    }
    domain
}

pub fn keyset_domain_step(env: &Env, prior: &BytesN<32>, key: &CircuitKey) -> BytesN<32> {
    let step = KeyDomainStep {
        prior: prior.clone(),
        key: key.clone(),
    };
    env.crypto().sha256(&step.to_xdr(env)).into()
}

fn push_address(env: &Env, signals: &mut Vec<U256>, address: &Address) {
    let (high, low) = address_limbs(env, address);
    signals.push_back(high);
    signals.push_back(low);
}

fn push_optional_address(env: &Env, signals: &mut Vec<U256>, address: &Option<Address>) {
    match address {
        Some(address) => {
            signals.push_back(U256::from_u32(env, 1));
            push_address(env, signals, address);
        }
        None => {
            signals.push_back(U256::from_u32(env, 0));
            signals.push_back(U256::from_u32(env, 0));
            signals.push_back(U256::from_u32(env, 0));
        }
    }
}

fn push_bytes32(env: &Env, signals: &mut Vec<U256>, value: &BytesN<32>) {
    let (high, low) = bytes32_limbs(env, value);
    signals.push_back(high);
    signals.push_back(low);
}

fn push_field(env: &Env, signals: &mut Vec<U256>, value: &U256) -> Result<(), SignalError> {
    if !is_canonical_field(env, value) {
        return Err(SignalError::NonCanonicalField);
    }
    signals.push_back(value.clone());
    Ok(())
}

fn push_nonnegative_i128(
    env: &Env,
    signals: &mut Vec<U256>,
    value: i128,
) -> Result<(), SignalError> {
    if value < 0 {
        return Err(SignalError::NegativeBatchValue);
    }
    signals.push_back(U256::from_u128(env, value as u128));
    Ok(())
}

fn signed_i128(value: i128) -> (u32, u128) {
    if value < 0 {
        (1, value.unsigned_abs())
    } else {
        (0, value as u128)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn id(env: &Env, byte: u8) -> BytesN<32> {
        BytesN::from_array(env, &[byte; 32])
    }

    fn babyjub_base(env: &Env) -> (U256, U256) {
        (
            U256::from_be_bytes(
                env,
                &Bytes::from_array(
                    env,
                    &[
                        0x0b, 0xb7, 0x7a, 0x6a, 0xd6, 0x3e, 0x73, 0x9b, 0x4e, 0xac, 0xb2, 0xe0,
                        0x9d, 0x62, 0x77, 0xc1, 0x2a, 0xb8, 0xd8, 0x01, 0x05, 0x34, 0xe0, 0xb6,
                        0x28, 0x93, 0xf3, 0xf6, 0xbb, 0x95, 0x70, 0x51,
                    ],
                ),
            ),
            U256::from_be_bytes(
                env,
                &Bytes::from_array(
                    env,
                    &[
                        0x25, 0x79, 0x72, 0x03, 0xf7, 0xa0, 0xb2, 0x49, 0x25, 0x57, 0x2e, 0x1c,
                        0xd1, 0x6b, 0xf9, 0xed, 0xfc, 0xe0, 0x05, 0x1f, 0xb9, 0xe1, 0x33, 0x77,
                        0x4b, 0x3c, 0x25, 0x7a, 0x87, 0x2d, 0x7d, 0x8b,
                    ],
                ),
            ),
        )
    }

    #[test]
    fn action_signals_have_fixed_shape_and_preserve_signed_amount() {
        let env = Env::default();
        let statement = ProofStatement {
            action: ProofAction::Withdraw,
            context_digest: U256::from_u32(&env, 1),
            membership_root: U256::from_u32(&env, 2),
            append_root: U256::from_u32(&env, 3),
            new_root: U256::from_u32(&env, 4),
            input_nullifiers: Vec::from_array(
                &env,
                [U256::from_u32(&env, 5), U256::from_u32(&env, 6)],
            ),
            output_commitments: Vec::from_array(
                &env,
                [U256::from_u32(&env, 7), U256::from_u32(&env, 8)],
            ),
            output_envelope_hashes: Vec::from_array(
                &env,
                [U256::from_u32(&env, 11), U256::from_u32(&env, 12)],
            ),
            first_leaf_index: 9,
            public_amount: -10,
        };
        let signals = action_public_inputs(&env, &statement).unwrap();
        assert_eq!(signals.len(), ACTION_PUBLIC_INPUTS);
        assert_eq!(signals.get(0), Some(U256::from_u32(&env, 2)));
        assert_eq!(signals.get(13), Some(U256::from_u32(&env, 1)));
        assert_eq!(signals.get(14), Some(U256::from_u32(&env, 10)));
    }

    #[test]
    fn action_signals_reject_field_aliases_and_bad_shapes() {
        let env = Env::default();
        let statement = ProofStatement {
            action: ProofAction::Deposit,
            context_digest: U256::from_u32(&env, 1),
            membership_root: scalar_modulus(&env),
            append_root: U256::from_u32(&env, 1),
            new_root: U256::from_u32(&env, 2),
            input_nullifiers: Vec::new(&env),
            output_commitments: Vec::from_array(
                &env,
                [U256::from_u32(&env, 3), U256::from_u32(&env, 4)],
            ),
            output_envelope_hashes: Vec::from_array(
                &env,
                [U256::from_u32(&env, 5), U256::from_u32(&env, 6)],
            ),
            first_leaf_index: 0,
            public_amount: 1,
        };
        assert_eq!(
            action_public_inputs(&env, &statement),
            Err(SignalError::NonCanonicalField)
        );

        let mut invalid = statement;
        invalid.membership_root = U256::from_u32(&env, 1);
        invalid.output_commitments = Vec::from_array(&env, [U256::from_u32(&env, 3)]);
        assert_eq!(
            action_public_inputs(&env, &invalid),
            Err(SignalError::InvalidShape)
        );
    }

    #[test]
    fn exit_match_signals_have_the_only_extended_shape() {
        let env = Env::default();
        let statement = ProofStatement {
            action: ProofAction::ExitMatch,
            context_digest: U256::from_u32(&env, 1),
            membership_root: U256::from_u32(&env, 2),
            append_root: U256::from_u32(&env, 3),
            new_root: U256::from_u32(&env, 4),
            input_nullifiers: Vec::from_array(
                &env,
                [
                    U256::from_u32(&env, 5),
                    U256::from_u32(&env, 6),
                    U256::from_u32(&env, 7),
                ],
            ),
            output_commitments: Vec::from_array(
                &env,
                [
                    U256::from_u32(&env, 8),
                    U256::from_u32(&env, 9),
                    U256::from_u32(&env, 10),
                    U256::from_u32(&env, 11),
                ],
            ),
            output_envelope_hashes: Vec::from_array(
                &env,
                [
                    U256::from_u32(&env, 12),
                    U256::from_u32(&env, 13),
                    U256::from_u32(&env, 14),
                    U256::from_u32(&env, 15),
                ],
            ),
            first_leaf_index: 16,
            public_amount: 0,
        };
        let signals = action_public_inputs(&env, &statement).unwrap();
        assert_eq!(signals.len(), EXIT_MATCH_PUBLIC_INPUTS);
        assert_eq!(signals.get(0), Some(U256::from_u32(&env, 13)));
        assert_eq!(signals.get(5), Some(U256::from_u32(&env, 3)));

        let mut invalid = statement;
        invalid.action = ProofAction::Transfer;
        assert_eq!(
            action_public_inputs(&env, &invalid),
            Err(SignalError::InvalidShape)
        );
    }

    #[test]
    fn operation_context_is_fixed_canonical_and_domain_separated() {
        let env = Env::default();
        let mut binding = empty_operation_binding(&env);
        binding.kind = BindingKind::Liquidity;
        set_binding_field(&mut binding.fields, 2, U256::from_u32(&env, 9)).unwrap();
        let context = OperationContext {
            network_domain: id(&env, 1),
            vault: Address::generate(&env),
            token: Address::generate(&env),
            verifier_domain: id(&env, 2),
            action: ProofAction::LiquidityFund,
            action_id: id(&env, 3),
            public_account: None,
            public_amount: -10,
            market: Some(Address::generate(&env)),
            binding,
            expiry: 20,
        };
        let fields = operation_context_fields(&env, &context).unwrap();
        assert_eq!(fields.len(), OPERATION_CONTEXT_FIELDS);
        let digest = operation_context_digest(&env, &context).unwrap();
        let mut changed = context;
        changed.action = ProofAction::LiquidityExit;
        assert_ne!(digest, operation_context_digest(&env, &changed).unwrap());
    }

    #[test]
    fn poseidon2_sponge_matches_the_circom_fixture() {
        let env = Env::default();
        let mut fields = Vec::new(&env);
        for value in 1..=46 {
            fields.push_back(U256::from_u32(&env, value));
        }
        let expected = U256::from_be_bytes(
            &env,
            &Bytes::from_array(
                &env,
                &[
                    22, 119, 97, 0, 240, 22, 230, 38, 170, 203, 93, 22, 146, 147, 151, 24, 127, 10,
                    243, 33, 66, 105, 169, 50, 163, 189, 185, 205, 144, 207, 243, 94,
                ],
            ),
        );
        assert_eq!(poseidon2_hash::<4, Bn254Fr>(&env, &fields), expected);
    }

    #[test]
    fn babyjub_encryption_points_reject_invalid_and_low_order_values() {
        let env = Env::default();
        let (x, y) = babyjub_base(&env);
        assert!(is_valid_babyjub_encryption_point(&env, &x, &y));
        assert!(!is_valid_babyjub_encryption_point(
            &env,
            &U256::from_u32(&env, 0),
            &U256::from_u32(&env, 1),
        ));
        assert!(!is_valid_babyjub_encryption_point(
            &env,
            &U256::from_u32(&env, 5),
            &U256::from_u32(&env, 6),
        ));
    }

    #[test]
    fn accepted_tree_empty_root_matches_the_circom_fixture() {
        let env = Env::default();
        let expected = U256::from_be_bytes(
            &env,
            &Bytes::from_array(
                &env,
                &[
                    0x25, 0x61, 0x58, 0xb7, 0x46, 0xd8, 0x43, 0x71, 0x46, 0xcb, 0xaf, 0xca, 0x04,
                    0x1c, 0xec, 0x2b, 0x79, 0x92, 0x0d, 0x28, 0x1a, 0x1c, 0xeb, 0x4f, 0xf7, 0xda,
                    0x54, 0x4b, 0x2d, 0xef, 0xae, 0x9d,
                ],
            ),
        );
        assert_eq!(empty_merkle_root(&env, 6), expected);
    }

    #[test]
    fn output_envelope_hash_matches_the_typescript_fixture() {
        let env = Env::default();
        let mut envelope = Bytes::new(&env);
        for value in 1..=OUTPUT_ENVELOPE_FIELDS {
            envelope.append(&U256::from_u32(&env, value).to_be_bytes());
        }
        let expected = U256::from_be_bytes(
            &env,
            &Bytes::from_array(
                &env,
                &[
                    17, 31, 117, 18, 203, 191, 250, 139, 52, 131, 61, 124, 8, 107, 107, 247, 36,
                    149, 83, 33, 114, 128, 7, 189, 162, 140, 110, 82, 181, 244, 78, 87,
                ],
            ),
        );
        assert_eq!(output_envelope_hash(&env, &envelope), Ok(expected));

        envelope.set(31, 2);
        assert_eq!(
            output_envelope_hash(&env, &envelope),
            Err(SignalError::InvalidShape)
        );
    }

    #[test]
    fn batch_signals_bind_addresses_hashes_and_every_quote_field() {
        let env = Env::default();
        let statement = BatchProofStatement {
            network_domain: id(&env, 1),
            vault: Address::generate(&env),
            market: Address::generate(&env),
            epoch: 2,
            accepted_root: U256::from_u32(&env, 3),
            accepted_count: 8,
            first_sequence: 10,
            last_sequence: 17,
            committee_epoch: 4,
            committee_config_hash: id(&env, 5),
            committee_public_key_x: U256::from_u32(&env, 6),
            committee_public_key_y: U256::from_u32(&env, 7),
            aggregate_ciphertext: Vec::from_array(
                &env,
                [
                    U256::from_u32(&env, 8),
                    U256::from_u32(&env, 9),
                    U256::from_u32(&env, 10),
                    U256::from_u32(&env, 11),
                ],
            ),
            decryption_proof_hash: id(&env, 7),
            committee_statement_hash: id(&env, 8),
            allocation_root: U256::from_u32(&env, 12),
            included_root: U256::from_u32(&env, 13),
            lot_size: 14,
            quote: BatchQuote {
                state_version: 1,
                batch_size: 8,
                yes_count: 2,
                no_count: 6,
                pre_yes_price: 10,
                post_yes_price: 11,
                yes_price: 12,
                no_price: 13,
                aggregate_market_charge: 14,
                yes_market_cost: 15,
                no_market_cost: 16,
                yes_charge_per_position: 17,
                no_charge_per_position: 18,
                rounding_contribution: 19,
                fee_per_position: 20,
                fee_escrow: 21,
                conditional_lp_fee: 22,
                conditional_protocol_fee: 23,
            },
        };
        let signals = batch_public_inputs(&env, &statement).unwrap();
        assert_eq!(signals.len(), BATCH_PUBLIC_INPUTS);
        assert_eq!(signals.get(26), Some(U256::from_u32(&env, 14)));
        assert_eq!(signals.get(27), Some(U256::from_u32(&env, 1)));
        assert_eq!(signals.get(44), Some(U256::from_u32(&env, 23)));
    }
}
