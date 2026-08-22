#![no_std]

use privacy_types::{
    address_limbs, bytes32_limbs, is_canonical_field, tagged_poseidon2_hash, VerificationKeyBytes,
};
use soroban_poseidon::poseidon2_hash;
use soroban_sdk::{
    contracterror, contracttype, crypto::bn254::Bn254Fr, xdr::ToXdr, Address, Bytes, BytesN, Env,
    Vec, U256,
};

pub const PAYMENT_PUBLIC_INPUTS: u32 = 20;
pub const PAYMENT_CONTEXT_FIELDS: u32 = 32;
pub const PAYMENT_ATTACHMENT_FIELDS: u32 = 4;
pub const PAYMENT_ATTACHMENT_LENGTH: u32 = PAYMENT_ATTACHMENT_FIELDS * 32;
pub const PAYMENT_OUTPUT_ENVELOPE_LENGTH: u32 = 15 * 32;
pub const PAYMENT_REQUIRED_CIRCUITS: u32 = 7;
pub const PAYMENT_PROOF_SIZE: u32 = 256;
pub const PAYMENT_CONTEXT_VERSION: u32 = 1;
pub const PAYMENT_NOTE_SCHEMA: u32 = 1;
pub const MAX_PAYMENT_AMOUNT: i128 = (1_i128 << 120) - 1;

const PAYMENT_NOTE_DOMAIN_TAG: u32 = 1101;
const PAYMENT_ATTACHMENT_TAG: u32 = 1110;
const PAYMENT_RELAY_QUOTE_TAG: u32 = 1111;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaymentAction {
    Deposit,
    Transfer,
    Withdraw,
}

impl PaymentAction {
    pub fn code(self) -> u32 {
        match self {
            Self::Deposit => 0,
            Self::Transfer => 1,
            Self::Withdraw => 2,
        }
    }
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaymentCircuit {
    Deposit,
    TransferOne,
    TransferTwo,
    TransferFour,
    WithdrawOne,
    WithdrawTwo,
    WithdrawFour,
}

impl PaymentCircuit {
    pub fn code(self) -> u32 {
        match self {
            Self::Deposit => 0,
            Self::TransferOne => 1,
            Self::TransferTwo => 2,
            Self::TransferFour => 3,
            Self::WithdrawOne => 4,
            Self::WithdrawTwo => 5,
            Self::WithdrawFour => 6,
        }
    }

    pub fn action(self) -> PaymentAction {
        match self {
            Self::Deposit => PaymentAction::Deposit,
            Self::TransferOne | Self::TransferTwo | Self::TransferFour => PaymentAction::Transfer,
            Self::WithdrawOne | Self::WithdrawTwo | Self::WithdrawFour => PaymentAction::Withdraw,
        }
    }

    pub fn input_count(self) -> u32 {
        match self {
            Self::Deposit => 0,
            Self::TransferOne | Self::WithdrawOne => 1,
            Self::TransferTwo | Self::WithdrawTwo => 2,
            Self::TransferFour | Self::WithdrawFour => 4,
        }
    }

    pub fn normal_output_count(self) -> u32 {
        match self {
            Self::Deposit => 2,
            Self::TransferOne | Self::TransferTwo | Self::TransferFour => 4,
            Self::WithdrawOne | Self::WithdrawTwo | Self::WithdrawFour => 3,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentIdentity {
    pub spend_public_key: U256,
    pub viewing_public_key_x: U256,
    pub viewing_public_key_y: U256,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentProofStatement {
    pub action: PaymentAction,
    pub circuit: PaymentCircuit,
    pub context_digest: U256,
    pub membership_root: U256,
    pub input_nullifiers: Vec<U256>,
    pub output_commitments: Vec<U256>,
    pub output_envelope_hashes: Vec<U256>,
    pub attachment_hash: U256,
    pub public_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentTransition {
    pub statement: PaymentProofStatement,
    pub proof: Bytes,
    pub encrypted_outputs: Vec<Bytes>,
    pub attachment: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentCircuitKey {
    pub circuit: PaymentCircuit,
    pub schema_hash: BytesN<32>,
    pub verification_key: VerificationKeyBytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentFeeConfig {
    pub epoch: u64,
    pub protocol_fee: i128,
    pub protocol_identity: PaymentIdentity,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RelayQuote {
    pub quote_id: BytesN<32>,
    pub signing_key: BytesN<32>,
    pub payment_identity: PaymentIdentity,
    pub fee: i128,
    pub expiry: u64,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnsignedRelayQuote {
    pub network_domain: BytesN<32>,
    pub vault: Address,
    pub token: Address,
    pub action_id: BytesN<32>,
    pub quote_id: BytesN<32>,
    pub signing_key: BytesN<32>,
    pub payment_identity: PaymentIdentity,
    pub fee: i128,
    pub expiry: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentContext {
    pub network_domain: BytesN<32>,
    pub vault: Address,
    pub token: Address,
    pub verifier_domain: BytesN<32>,
    pub action: PaymentAction,
    pub action_id: BytesN<32>,
    pub expiry: u64,
    pub public_account: Option<Address>,
    pub public_amount: i128,
    pub output_count: u32,
    pub append_count: u32,
    pub emergency: bool,
    pub fee: PaymentFeeConfig,
    pub relay_quote_digest: U256,
    pub relay_fee: i128,
    pub relay_identity: PaymentIdentity,
    pub attachment_hash: U256,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymentSignalError {
    InvalidShape = 1,
    NonCanonicalField = 2,
    InvalidAmount = 3,
    InvalidContext = 4,
}

pub fn payment_public_inputs(
    env: &Env,
    statement: &PaymentProofStatement,
) -> Result<Vec<U256>, PaymentSignalError> {
    validate_statement(env, statement)?;
    let mut signals = Vec::new(env);
    signals.push_back(U256::from_u32(env, statement.action.code()));
    push_field(env, &mut signals, &statement.context_digest)?;
    push_field(env, &mut signals, &statement.membership_root)?;
    signals.push_back(U256::from_u32(env, statement.input_nullifiers.len()));
    push_padded_fields(env, &mut signals, &statement.input_nullifiers, 4)?;
    signals.push_back(U256::from_u32(env, statement.output_commitments.len()));
    push_padded_fields(env, &mut signals, &statement.output_commitments, 4)?;
    push_padded_fields(env, &mut signals, &statement.output_envelope_hashes, 4)?;
    push_field(env, &mut signals, &statement.attachment_hash)?;
    let (sign, magnitude) = signed_amount(statement.public_amount)?;
    signals.push_back(U256::from_u32(env, sign));
    signals.push_back(U256::from_u128(env, magnitude));
    if signals.len() != PAYMENT_PUBLIC_INPUTS {
        return Err(PaymentSignalError::InvalidShape);
    }
    Ok(signals)
}

pub fn payment_context_fields(
    env: &Env,
    context: &PaymentContext,
) -> Result<Vec<U256>, PaymentSignalError> {
    validate_context(env, context)?;
    let mut fields = Vec::new(env);
    fields.push_back(U256::from_u32(env, PAYMENT_CONTEXT_VERSION));
    fields.push_back(U256::from_u32(env, context.action.code()));
    fields.push_back(U256::from_u32(env, PAYMENT_NOTE_SCHEMA));
    push_bytes32(env, &mut fields, &context.network_domain);
    push_address(env, &mut fields, &context.vault);
    push_address(env, &mut fields, &context.token);
    push_bytes32(env, &mut fields, &context.verifier_domain);
    push_bytes32(env, &mut fields, &context.action_id);
    fields.push_back(U256::from_u128(env, context.expiry as u128));
    match &context.public_account {
        Some(account) => push_address(env, &mut fields, account),
        None => {
            fields.push_back(U256::from_u32(env, 0));
            fields.push_back(U256::from_u32(env, 0));
        }
    }
    let (sign, magnitude) = signed_amount(context.public_amount)?;
    fields.push_back(U256::from_u32(env, sign));
    fields.push_back(U256::from_u128(env, magnitude));
    fields.push_back(U256::from_u32(env, context.output_count));
    fields.push_back(U256::from_u32(env, context.append_count));
    fields.push_back(U256::from_u32(env, u32::from(context.emergency)));
    fields.push_back(U256::from_u128(env, context.fee.epoch as u128));
    fields.push_back(U256::from_u128(env, context.relay_fee as u128));
    fields.push_back(U256::from_u128(env, context.fee.protocol_fee as u128));
    push_identity(env, &mut fields, &context.relay_identity)?;
    push_identity(env, &mut fields, &context.fee.protocol_identity)?;
    push_field(env, &mut fields, &context.attachment_hash)?;
    push_field(env, &mut fields, &context.relay_quote_digest)?;
    if fields.len() != PAYMENT_CONTEXT_FIELDS {
        return Err(PaymentSignalError::InvalidShape);
    }
    Ok(fields)
}

pub fn payment_context_digest(
    env: &Env,
    context: &PaymentContext,
) -> Result<U256, PaymentSignalError> {
    let fields = payment_context_fields(env, context)?;
    Ok(poseidon2_hash::<4, Bn254Fr>(env, &fields))
}

pub fn payment_note_domain(
    env: &Env,
    network_domain: &BytesN<32>,
    vault: &Address,
    token: &Address,
) -> U256 {
    let mut fields = Vec::new(env);
    push_bytes32(env, &mut fields, network_domain);
    push_address(env, &mut fields, vault);
    push_address(env, &mut fields, token);
    fields.push_back(U256::from_u32(env, PAYMENT_NOTE_SCHEMA));
    tagged_poseidon2_hash(env, PAYMENT_NOTE_DOMAIN_TAG, &fields).unwrap()
}

pub fn payment_attachment_hash(env: &Env, attachment: &Bytes) -> Result<U256, PaymentSignalError> {
    if attachment.len() != PAYMENT_ATTACHMENT_LENGTH {
        return Err(PaymentSignalError::InvalidShape);
    }
    let mut fields = Vec::new(env);
    for index in 0..PAYMENT_ATTACHMENT_FIELDS {
        let value: BytesN<32> = attachment
            .slice(index * 32..(index + 1) * 32)
            .try_into()
            .map_err(|_| PaymentSignalError::InvalidShape)?;
        let field = U256::from_be_bytes(env, &Bytes::from(value));
        push_field(env, &mut fields, &field)?;
    }
    tagged_poseidon2_hash(env, PAYMENT_ATTACHMENT_TAG, &fields)
        .map_err(|_| PaymentSignalError::InvalidContext)
}

pub fn unsigned_relay_quote(
    network_domain: BytesN<32>,
    vault: Address,
    token: Address,
    action_id: BytesN<32>,
    quote: &RelayQuote,
) -> UnsignedRelayQuote {
    UnsignedRelayQuote {
        network_domain,
        vault,
        token,
        action_id,
        quote_id: quote.quote_id.clone(),
        signing_key: quote.signing_key.clone(),
        payment_identity: quote.payment_identity.clone(),
        fee: quote.fee,
        expiry: quote.expiry,
    }
}

pub fn relay_quote_message(env: &Env, quote: &UnsignedRelayQuote) -> Bytes {
    quote.clone().to_xdr(env)
}

pub fn relay_quote_digest(
    env: &Env,
    quote: &UnsignedRelayQuote,
) -> Result<U256, PaymentSignalError> {
    if !valid_amount(quote.fee) {
        return Err(PaymentSignalError::InvalidAmount);
    }
    let mut fields = Vec::new(env);
    push_bytes32(env, &mut fields, &quote.network_domain);
    push_address(env, &mut fields, &quote.vault);
    push_address(env, &mut fields, &quote.token);
    push_bytes32(env, &mut fields, &quote.action_id);
    push_bytes32(env, &mut fields, &quote.quote_id);
    push_bytes32(env, &mut fields, &quote.signing_key);
    fields.push_back(U256::from_u128(env, quote.fee as u128));
    fields.push_back(U256::from_u128(env, quote.expiry as u128));
    push_identity(env, &mut fields, &quote.payment_identity)?;
    tagged_poseidon2_hash(env, PAYMENT_RELAY_QUOTE_TAG, &fields)
        .map_err(|_| PaymentSignalError::InvalidContext)
}

pub fn payment_keyset_domain_step(
    env: &Env,
    prior: &BytesN<32>,
    key: &PaymentCircuitKey,
) -> BytesN<32> {
    env.crypto()
        .sha256(&(prior.clone(), key.clone()).to_xdr(env))
        .into()
}

fn validate_statement(
    env: &Env,
    statement: &PaymentProofStatement,
) -> Result<(), PaymentSignalError> {
    if statement.action != statement.circuit.action()
        || statement.input_nullifiers.len() != statement.circuit.input_count()
        || statement.output_commitments.len() != statement.output_envelope_hashes.len()
        || statement.output_commitments.len() > 4
    {
        return Err(PaymentSignalError::InvalidShape);
    }
    let output_count = statement.output_commitments.len();
    if output_count != statement.circuit.normal_output_count()
        && !(statement.action == PaymentAction::Withdraw && output_count == 0)
    {
        return Err(PaymentSignalError::InvalidShape);
    }
    match statement.action {
        PaymentAction::Deposit if statement.public_amount <= 0 => {
            return Err(PaymentSignalError::InvalidAmount)
        }
        PaymentAction::Transfer if statement.public_amount != 0 => {
            return Err(PaymentSignalError::InvalidAmount)
        }
        PaymentAction::Withdraw if statement.public_amount >= 0 => {
            return Err(PaymentSignalError::InvalidAmount)
        }
        _ => {}
    }
    signed_amount(statement.public_amount)?;
    push_field(env, &mut Vec::new(env), &statement.membership_root)?;
    Ok(())
}

fn validate_context(env: &Env, context: &PaymentContext) -> Result<(), PaymentSignalError> {
    if context.append_count != context.output_count
        || !valid_amount(context.relay_fee)
        || !valid_amount(context.fee.protocol_fee)
        || !is_canonical_field(env, &context.relay_quote_digest)
        || !is_canonical_field(env, &context.attachment_hash)
    {
        return Err(PaymentSignalError::InvalidContext);
    }
    match context.action {
        PaymentAction::Deposit
            if context.public_account.is_none()
                || context.public_amount <= 0
                || context.output_count != 2
                || context.emergency
                || context.relay_fee != 0
                || context.fee.protocol_fee != 0 =>
        {
            return Err(PaymentSignalError::InvalidContext)
        }
        PaymentAction::Transfer
            if context.public_account.is_some()
                || context.public_amount != 0
                || context.output_count != 4
                || context.emergency =>
        {
            return Err(PaymentSignalError::InvalidContext)
        }
        PaymentAction::Withdraw
            if context.public_account.is_none()
                || context.public_amount >= 0
                || (context.emergency && context.output_count != 0)
                || (!context.emergency && context.output_count != 3)
                || (context.emergency
                    && (context.relay_fee != 0 || context.fee.protocol_fee != 0)) =>
        {
            return Err(PaymentSignalError::InvalidContext)
        }
        _ => {}
    }
    signed_amount(context.public_amount)?;
    Ok(())
}

fn valid_amount(value: i128) -> bool {
    (0..=MAX_PAYMENT_AMOUNT).contains(&value)
}

fn signed_amount(value: i128) -> Result<(u32, u128), PaymentSignalError> {
    let magnitude = value.unsigned_abs();
    if magnitude > MAX_PAYMENT_AMOUNT as u128 {
        return Err(PaymentSignalError::InvalidAmount);
    }
    Ok((u32::from(value < 0), magnitude))
}

fn push_identity(
    env: &Env,
    fields: &mut Vec<U256>,
    identity: &PaymentIdentity,
) -> Result<(), PaymentSignalError> {
    push_field(env, fields, &identity.spend_public_key)?;
    push_field(env, fields, &identity.viewing_public_key_x)?;
    push_field(env, fields, &identity.viewing_public_key_y)
}

fn push_padded_fields(
    env: &Env,
    target: &mut Vec<U256>,
    values: &Vec<U256>,
    width: u32,
) -> Result<(), PaymentSignalError> {
    if values.len() > width {
        return Err(PaymentSignalError::InvalidShape);
    }
    for index in 0..width {
        let value = values.get(index).unwrap_or_else(|| U256::from_u32(env, 0));
        push_field(env, target, &value)?;
    }
    Ok(())
}

fn push_field(env: &Env, target: &mut Vec<U256>, value: &U256) -> Result<(), PaymentSignalError> {
    if !is_canonical_field(env, value) {
        return Err(PaymentSignalError::NonCanonicalField);
    }
    target.push_back(value.clone());
    Ok(())
}

fn push_address(env: &Env, target: &mut Vec<U256>, value: &Address) {
    let (high, low) = address_limbs(env, value);
    target.push_back(high);
    target.push_back(low);
}

fn push_bytes32(env: &Env, target: &mut Vec<U256>, value: &BytesN<32>) {
    let (high, low) = bytes32_limbs(env, value);
    target.push_back(high);
    target.push_back(low);
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn identity(env: &Env, start: u32) -> PaymentIdentity {
        PaymentIdentity {
            spend_public_key: U256::from_u32(env, start),
            viewing_public_key_x: U256::from_u32(env, start + 1),
            viewing_public_key_y: U256::from_u32(env, start + 2),
        }
    }

    fn statement(env: &Env, circuit: PaymentCircuit) -> PaymentProofStatement {
        let mut input_nullifiers = Vec::new(env);
        for index in 0..circuit.input_count() {
            input_nullifiers.push_back(U256::from_u32(env, index + 10));
        }
        let output_count = circuit.normal_output_count();
        let mut output_commitments = Vec::new(env);
        let mut output_envelope_hashes = Vec::new(env);
        for index in 0..output_count {
            output_commitments.push_back(U256::from_u32(env, index + 20));
            output_envelope_hashes.push_back(U256::from_u32(env, index + 30));
        }
        PaymentProofStatement {
            action: circuit.action(),
            circuit,
            context_digest: U256::from_u32(env, 1),
            membership_root: U256::from_u32(env, 2),
            input_nullifiers,
            output_commitments,
            output_envelope_hashes,
            attachment_hash: U256::from_u32(env, 3),
            public_amount: match circuit.action() {
                PaymentAction::Deposit => 10,
                PaymentAction::Transfer => 0,
                PaymentAction::Withdraw => -10,
            },
        }
    }

    #[test]
    fn every_circuit_has_the_fixed_public_shape() {
        let env = Env::default();
        let circuits = [
            PaymentCircuit::Deposit,
            PaymentCircuit::TransferOne,
            PaymentCircuit::TransferTwo,
            PaymentCircuit::TransferFour,
            PaymentCircuit::WithdrawOne,
            PaymentCircuit::WithdrawTwo,
            PaymentCircuit::WithdrawFour,
        ];
        for circuit in circuits {
            let signals = payment_public_inputs(&env, &statement(&env, circuit)).unwrap();
            assert_eq!(signals.len(), PAYMENT_PUBLIC_INPUTS);
            assert_eq!(
                signals.get(0),
                Some(U256::from_u32(&env, circuit.action().code()))
            );
        }
    }

    #[test]
    fn emergency_withdraw_has_no_outputs() {
        let env = Env::default();
        let mut statement = statement(&env, PaymentCircuit::WithdrawFour);
        statement.output_commitments = Vec::new(&env);
        statement.output_envelope_hashes = Vec::new(&env);
        let signals = payment_public_inputs(&env, &statement).unwrap();
        assert_eq!(signals.get(8), Some(U256::from_u32(&env, 0)));
    }

    #[test]
    fn context_and_attachment_are_fixed_and_bound() {
        let env = Env::default();
        let vault = Address::generate(&env);
        let token = Address::generate(&env);
        let context = PaymentContext {
            network_domain: BytesN::from_array(&env, &[1; 32]),
            vault,
            token,
            verifier_domain: BytesN::from_array(&env, &[2; 32]),
            action: PaymentAction::Transfer,
            action_id: BytesN::from_array(&env, &[3; 32]),
            expiry: 100,
            public_account: None,
            public_amount: 0,
            output_count: 4,
            append_count: 4,
            emergency: false,
            fee: PaymentFeeConfig {
                epoch: 0,
                protocol_fee: 0,
                protocol_identity: identity(&env, 10),
            },
            relay_quote_digest: U256::from_u32(&env, 4),
            relay_fee: 0,
            relay_identity: identity(&env, 20),
            attachment_hash: U256::from_u32(&env, 5),
        };
        assert_eq!(payment_context_fields(&env, &context).unwrap().len(), 32);
        let mut changed = context.clone();
        changed.expiry += 1;
        assert_ne!(
            payment_context_digest(&env, &context).unwrap(),
            payment_context_digest(&env, &changed).unwrap(),
        );

        assert_eq!(
            payment_attachment_hash(&env, &Bytes::new(&env)),
            Err(PaymentSignalError::InvalidShape),
        );
        let attachment = Bytes::from_array(&env, &[7; PAYMENT_ATTACHMENT_LENGTH as usize]);
        assert!(payment_attachment_hash(&env, &attachment).is_ok());
    }

    #[test]
    fn relay_quote_xdr_matches_javascript_client() {
        let env = Env::default();
        let quote = UnsignedRelayQuote {
            network_domain: BytesN::from_array(&env, &[4; 32]),
            vault: Address::from_str(
                &env,
                "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
            ),
            token: Address::from_str(
                &env,
                "CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ",
            ),
            action_id: BytesN::from_array(&env, &[3; 32]),
            quote_id: BytesN::from_array(&env, &[9; 32]),
            signing_key: BytesN::from_array(&env, &[10; 32]),
            payment_identity: PaymentIdentity {
                spend_public_key: U256::from_u32(&env, 6),
                viewing_public_key_x: U256::from_u32(&env, 7),
                viewing_public_key_y: U256::from_u32(&env, 8),
            },
            fee: 0,
            expiry: 1_780_000_120,
        };
        let digest: BytesN<32> = env.crypto().sha256(&relay_quote_message(&env, &quote)).into();
        assert_eq!(
            digest,
            BytesN::from_array(
                &env,
                &[
                    0x08, 0x2b, 0x85, 0x45, 0x2b, 0x08, 0xdc, 0x2d, 0x68, 0x6f, 0x28, 0x0e,
                    0x41, 0xa3, 0xd8, 0x9a, 0x03, 0xd8, 0x13, 0x90, 0xb2, 0xc2, 0xa2, 0x9a,
                    0xe5, 0xdd, 0x1f, 0x6d, 0xbf, 0x6d, 0x9a, 0x31,
                ],
            ),
        );
    }
}
