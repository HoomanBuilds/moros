#![no_std]

use soroban_sdk::{
    contracterror, contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec, U256,
};

pub const ACTION_PUBLIC_INPUTS: u32 = 14;
pub const BATCH_PUBLIC_INPUTS: u32 = 40;
pub const PROOF_SIZE: u32 = 256;
pub const REQUIRED_CIRCUITS: u32 = 2;

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
        }
    }
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProofCircuit {
    Action,
    Batch,
}

impl ProofCircuit {
    pub fn code(self) -> u32 {
        match self {
            Self::Action => 0,
            Self::Batch => 1,
        }
    }

    pub fn public_input_count(self) -> u32 {
        match self {
            Self::Action => ACTION_PUBLIC_INPUTS,
            Self::Batch => BATCH_PUBLIC_INPUTS,
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
    pub context_digest: BytesN<32>,
    pub membership_root: U256,
    pub append_root: U256,
    pub new_root: U256,
    pub input_nullifiers: Vec<U256>,
    pub output_commitments: Vec<U256>,
    pub first_leaf_index: u32,
    pub public_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchProofStatement {
    pub network_domain: BytesN<32>,
    pub vault: Address,
    pub market: Address,
    pub epoch: u64,
    pub accepted_root: BytesN<32>,
    pub accepted_count: u32,
    pub first_sequence: u64,
    pub last_sequence: u64,
    pub committee_epoch: u64,
    pub committee_config_hash: BytesN<32>,
    pub aggregate_ciphertext_hash: BytesN<32>,
    pub decryption_proof_hash: BytesN<32>,
    pub committee_statement_hash: BytesN<32>,
    pub allocation_root: U256,
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
    if statement.input_nullifiers.len() > 2 || statement.output_commitments.len() != 2 {
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
    push_bytes32(env, &mut signals, &statement.context_digest);
    push_field(env, &mut signals, &statement.membership_root)?;
    push_field(env, &mut signals, &statement.append_root)?;
    push_field(env, &mut signals, &statement.new_root)?;
    signals.push_back(U256::from_u32(env, statement.input_nullifiers.len()));
    for index in 0..2 {
        let value = statement
            .input_nullifiers
            .get(index)
            .unwrap_or_else(|| U256::from_u32(env, 0));
        push_field(env, &mut signals, &value)?;
    }
    for commitment in statement.output_commitments.iter() {
        push_field(env, &mut signals, &commitment)?;
    }
    signals.push_back(U256::from_u32(env, statement.first_leaf_index));
    let (sign, magnitude) = signed_i128(statement.public_amount);
    signals.push_back(U256::from_u32(env, sign));
    signals.push_back(U256::from_u128(env, magnitude));
    if signals.len() != ACTION_PUBLIC_INPUTS {
        return Err(SignalError::InvalidShape);
    }
    Ok(signals)
}

pub fn batch_public_inputs(
    env: &Env,
    statement: &BatchProofStatement,
) -> Result<Vec<U256>, SignalError> {
    let mut signals = Vec::new(env);
    push_bytes32(env, &mut signals, &statement.network_domain);
    push_address(env, &mut signals, &statement.vault);
    push_address(env, &mut signals, &statement.market);
    signals.push_back(U256::from_u128(env, statement.epoch as u128));
    push_bytes32(env, &mut signals, &statement.accepted_root);
    signals.push_back(U256::from_u32(env, statement.accepted_count));
    signals.push_back(U256::from_u128(env, statement.first_sequence as u128));
    signals.push_back(U256::from_u128(env, statement.last_sequence as u128));
    signals.push_back(U256::from_u128(env, statement.committee_epoch as u128));
    push_bytes32(env, &mut signals, &statement.committee_config_hash);
    push_bytes32(env, &mut signals, &statement.aggregate_ciphertext_hash);
    push_bytes32(env, &mut signals, &statement.decryption_proof_hash);
    push_bytes32(env, &mut signals, &statement.committee_statement_hash);
    push_field(env, &mut signals, &statement.allocation_root)?;

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
    env.crypto().sha256(&keys.to_xdr(env)).into()
}

fn push_address(env: &Env, signals: &mut Vec<U256>, address: &Address) {
    let digest: BytesN<32> = env.crypto().sha256(&address.to_xdr(env)).into();
    push_bytes32(env, signals, &digest);
}

fn push_bytes32(env: &Env, signals: &mut Vec<U256>, value: &BytesN<32>) {
    let bytes = value.to_array();
    let mut high = [0u8; 16];
    let mut low = [0u8; 16];
    high.copy_from_slice(&bytes[..16]);
    low.copy_from_slice(&bytes[16..]);
    signals.push_back(U256::from_u128(env, u128::from_be_bytes(high)));
    signals.push_back(U256::from_u128(env, u128::from_be_bytes(low)));
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

    #[test]
    fn action_signals_have_fixed_shape_and_preserve_signed_amount() {
        let env = Env::default();
        let statement = ProofStatement {
            action: ProofAction::Withdraw,
            context_digest: id(&env, 1),
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
            first_leaf_index: 9,
            public_amount: -10,
        };
        let signals = action_public_inputs(&env, &statement).unwrap();
        assert_eq!(signals.len(), ACTION_PUBLIC_INPUTS);
        assert_eq!(signals.get(0), Some(U256::from_u32(&env, 2)));
        assert_eq!(signals.get(12), Some(U256::from_u32(&env, 1)));
        assert_eq!(signals.get(13), Some(U256::from_u32(&env, 10)));
    }

    #[test]
    fn action_signals_reject_field_aliases_and_bad_shapes() {
        let env = Env::default();
        let statement = ProofStatement {
            action: ProofAction::Deposit,
            context_digest: id(&env, 1),
            membership_root: scalar_modulus(&env),
            append_root: U256::from_u32(&env, 1),
            new_root: U256::from_u32(&env, 2),
            input_nullifiers: Vec::new(&env),
            output_commitments: Vec::from_array(
                &env,
                [U256::from_u32(&env, 3), U256::from_u32(&env, 4)],
            ),
            first_leaf_index: 0,
            public_amount: 1,
        };
        assert_eq!(
            action_public_inputs(&env, &statement),
            Err(SignalError::NonCanonicalField)
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
            accepted_root: id(&env, 3),
            accepted_count: 8,
            first_sequence: 10,
            last_sequence: 17,
            committee_epoch: 4,
            committee_config_hash: id(&env, 5),
            aggregate_ciphertext_hash: id(&env, 6),
            decryption_proof_hash: id(&env, 7),
            committee_statement_hash: id(&env, 8),
            allocation_root: U256::from_u32(&env, 9),
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
        assert_eq!(signals.get(22), Some(U256::from_u32(&env, 1)));
        assert_eq!(signals.get(39), Some(U256::from_u32(&env, 23)));
    }
}
