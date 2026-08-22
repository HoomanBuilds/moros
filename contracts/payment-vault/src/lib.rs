#![no_std]

use payment_types::{
    payment_attachment_hash, payment_context_digest, relay_quote_digest, relay_quote_message,
    unsigned_relay_quote, PaymentAction, PaymentContext, PaymentFeeConfig, PaymentIdentity,
    PaymentProofStatement, PaymentTransition, RelayQuote, MAX_PAYMENT_AMOUNT,
    PAYMENT_OUTPUT_ENVELOPE_LENGTH,
};
use privacy_types::{
    is_canonical_field, is_valid_babyjub_encryption_point, merkle_node, output_envelope_hash,
};
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, Bytes, BytesN, Env, Vec, U256,
};

#[cfg(test)]
mod test;

const EXPECTED_USDC_DECIMALS: u32 = 7;
const MIN_TREE_LEVELS: u32 = 8;
const MAX_TREE_LEVELS: u32 = 31;
const MIN_ROOT_HISTORY: u32 = 8;
const MAX_ROOT_HISTORY: u32 = 128;
const MAX_ACTION_LIFETIME: u64 = 86_400;
const MIN_FEE_DELAY: u64 = 3_600;
const FEE_GRACE: u64 = 3_600;
const MAX_KEEP_ALIVE_ITEMS: u32 = 64;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contractclient(crate_path = "soroban_sdk", name = "PaymentVerifierClient")]
pub trait PaymentVerifierInterface {
    fn domain(env: Env) -> BytesN<32>;
    fn verify(env: Env, statement: PaymentProofStatement, proof: Bytes) -> bool;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingFeeConfig {
    pub config: PaymentFeeConfig,
    pub activates_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreviousFeeConfig {
    pub config: PaymentFeeConfig,
    pub valid_until: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentActionRecord {
    pub action: PaymentAction,
    pub context_digest: U256,
    pub first_leaf_index: u32,
    pub output_count: u32,
    pub new_root: U256,
    pub public_amount: i128,
    pub completed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentVaultInfo {
    pub token: Address,
    pub verifier: Address,
    pub verifier_domain: BytesN<32>,
    pub network_domain: BytesN<32>,
    pub tree_levels: u32,
    pub root_history_size: u32,
    pub next_leaf_index: u32,
    pub current_root: U256,
    pub liabilities: i128,
    pub paused: bool,
    pub fee: PaymentFeeConfig,
    pub relay_count: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Token,
    Verifier,
    VerifierDomain,
    NetworkDomain,
    TreeLevels,
    RootHistorySize,
    NextLeafIndex,
    CurrentRoot,
    Frontier,
    EmptySubtrees,
    RootHistory,
    Liabilities,
    Paused,
    Fee,
    PendingFee,
    PreviousFee,
    RelayCount,
    Relay(BytesN<32>),
    Root(U256),
    Nullifier(U256),
    Commitment(U256),
    Action(BytesN<32>),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymentVaultError {
    InvalidConfiguration = 1,
    Paused = 2,
    InvalidAction = 3,
    Expired = 4,
    DuplicateAction = 5,
    InvalidRoot = 6,
    InvalidNullifier = 7,
    SpentNullifier = 8,
    InvalidCommitment = 9,
    DuplicateCommitment = 10,
    InvalidEnvelope = 11,
    InvalidAttachment = 12,
    InvalidProof = 13,
    Capacity = 14,
    InvalidAmount = 15,
    InvalidFee = 16,
    InvalidRelay = 17,
    InsufficientBacking = 18,
    Arithmetic = 19,
}

#[contractevent(topics = ["payment_action"], data_format = "vec")]
pub struct PaymentActionCompleted {
    #[topic]
    pub action_id: BytesN<32>,
    pub action: PaymentAction,
    pub first_leaf_index: u32,
    pub output_count: u32,
    pub new_root: U256,
    pub public_amount: i128,
}

#[contractevent(topics = ["payment_output"], data_format = "vec")]
pub struct PaymentOutputCreated {
    #[topic]
    pub action_id: BytesN<32>,
    pub output_index: u32,
    pub leaf_index: u32,
    pub commitment: U256,
    pub encrypted_output: Bytes,
}

#[contractevent(topics = ["payment_attachment"], data_format = "vec")]
pub struct PaymentAttachmentCreated {
    #[topic]
    pub action_id: BytesN<32>,
    pub attachment_hash: U256,
    pub encrypted_attachment: Bytes,
}

#[contractevent(topics = ["payment_paused"], data_format = "vec")]
pub struct PaymentPauseChanged {
    pub paused: bool,
}

#[contract]
pub struct PaymentVault;

#[contractimpl]
impl PaymentVault {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        verifier: Address,
        network_domain: BytesN<32>,
        tree_levels: u32,
        root_history_size: u32,
        protocol_identity: PaymentIdentity,
        relay_keys: Vec<BytesN<32>>,
    ) {
        if tree_levels < MIN_TREE_LEVELS
            || tree_levels > MAX_TREE_LEVELS
            || root_history_size < MIN_ROOT_HISTORY
            || root_history_size > MAX_ROOT_HISTORY
            || relay_keys.is_empty()
            || Self::is_zero_bytes32(&network_domain)
            || !Self::valid_identity(&env, &protocol_identity)
            || token::Client::new(&env, &token).decimals() != EXPECTED_USDC_DECIMALS
        {
            panic_with_error!(&env, PaymentVaultError::InvalidConfiguration);
        }
        let verifier_domain = PaymentVerifierClient::new(&env, &verifier).domain();
        if Self::is_zero_bytes32(&verifier_domain) {
            panic_with_error!(&env, PaymentVaultError::InvalidConfiguration);
        }

        let mut frontier = Vec::new(&env);
        let mut empty_subtrees = Vec::new(&env);
        let mut root = U256::from_u32(&env, 0);
        for _ in 0..tree_levels {
            frontier.push_back(U256::from_u32(&env, 0));
            empty_subtrees.push_back(root.clone());
            root = merkle_node(&env, &root, &root).unwrap();
        }
        let instance = env.storage().instance();
        instance.set(&DataKey::Admin, &admin);
        instance.set(&DataKey::Token, &token);
        instance.set(&DataKey::Verifier, &verifier);
        instance.set(&DataKey::VerifierDomain, &verifier_domain);
        instance.set(&DataKey::NetworkDomain, &network_domain);
        instance.set(&DataKey::TreeLevels, &tree_levels);
        instance.set(&DataKey::RootHistorySize, &root_history_size);
        instance.set(&DataKey::NextLeafIndex, &0u32);
        instance.set(&DataKey::CurrentRoot, &root);
        instance.set(&DataKey::Frontier, &frontier);
        instance.set(&DataKey::EmptySubtrees, &empty_subtrees);
        instance.set(
            &DataKey::RootHistory,
            &Vec::from_array(&env, [root.clone()]),
        );
        instance.set(&DataKey::Liabilities, &0i128);
        instance.set(&DataKey::Paused, &false);
        instance.set(
            &DataKey::Fee,
            &PaymentFeeConfig {
                epoch: 0,
                protocol_fee: 0,
                protocol_identity,
            },
        );
        instance.set(&DataKey::RelayCount, &0u32);
        env.storage()
            .persistent()
            .set(&DataKey::Root(root.clone()), &true);
        Self::bump_persistent(&env, &DataKey::Root(root));
        for key in relay_keys.iter() {
            Self::add_relay_key(&env, &key);
        }
        Self::bump_instance(&env);
    }

    pub fn deposit(
        env: Env,
        source: Address,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PaymentTransition,
    ) -> PaymentActionRecord {
        Self::require_not_paused(&env);
        source.require_auth();
        if let Some(record) = Self::idempotent_record(&env, &action_id, &transition.statement) {
            return record;
        }
        let amount = transition.statement.public_amount;
        if amount <= 0 {
            panic_with_error!(&env, PaymentVaultError::InvalidAmount);
        }
        let active_fee = Self::active_fee(&env);
        let fee = Self::fee_without_protocol_charge(&active_fee);
        let context = Self::context(
            &env,
            &action_id,
            expiry,
            Some(source.clone()),
            amount,
            false,
            fee,
            U256::from_u32(&env, 0),
            0,
            active_fee.protocol_identity,
            transition.statement.attachment_hash.clone(),
        );
        Self::validate_transition(&env, PaymentAction::Deposit, &context, &transition);
        let token = Self::token(&env);
        token::Client::new(&env, &token).transfer(
            &source,
            &env.current_contract_address(),
            &amount,
        );
        let record = Self::commit_transition(&env, &action_id, transition);
        Self::change_liabilities(&env, amount);
        Self::assert_backing(&env);
        record
    }

    pub fn transfer(
        env: Env,
        action_id: BytesN<32>,
        expiry: u64,
        fee_epoch: u64,
        quote: RelayQuote,
        transition: PaymentTransition,
    ) -> PaymentActionRecord {
        Self::require_not_paused(&env);
        if let Some(record) = Self::idempotent_record(&env, &action_id, &transition.statement) {
            return record;
        }
        let fee = Self::fee_for_epoch(&env, fee_epoch);
        let (quote_digest, relay_fee, relay_identity) =
            Self::validate_quote(&env, &action_id, expiry, &quote);
        let context = Self::context(
            &env,
            &action_id,
            expiry,
            None,
            0,
            false,
            fee,
            quote_digest,
            relay_fee,
            relay_identity,
            transition.statement.attachment_hash.clone(),
        );
        Self::validate_transition(&env, PaymentAction::Transfer, &context, &transition);
        Self::commit_transition(&env, &action_id, transition)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn withdraw(
        env: Env,
        destination: Address,
        action_id: BytesN<32>,
        expiry: u64,
        emergency: bool,
        fee_epoch: u64,
        quote: Option<RelayQuote>,
        transition: PaymentTransition,
    ) -> PaymentActionRecord {
        if let Some(record) = Self::idempotent_record(&env, &action_id, &transition.statement) {
            return record;
        }
        let configured_fee = Self::fee_for_epoch(&env, fee_epoch);
        let (quote_digest, relay_fee, relay_identity) = if emergency {
            if quote.is_some() {
                panic_with_error!(&env, PaymentVaultError::InvalidFee);
            }
            (
                U256::from_u32(&env, 0),
                0,
                configured_fee.protocol_identity.clone(),
            )
        } else {
            let Some(quote) = quote else {
                panic_with_error!(&env, PaymentVaultError::InvalidRelay);
            };
            Self::validate_quote(&env, &action_id, expiry, &quote)
        };
        let fee = if emergency {
            Self::fee_without_protocol_charge(&configured_fee)
        } else {
            configured_fee
        };
        let amount = transition
            .statement
            .public_amount
            .checked_neg()
            .unwrap_or_else(|| panic_with_error!(&env, PaymentVaultError::InvalidAmount));
        if amount <= 0 {
            panic_with_error!(&env, PaymentVaultError::InvalidAmount);
        }
        let context = Self::context(
            &env,
            &action_id,
            expiry,
            Some(destination.clone()),
            -amount,
            emergency,
            fee,
            quote_digest,
            relay_fee,
            relay_identity,
            transition.statement.attachment_hash.clone(),
        );
        Self::validate_transition(&env, PaymentAction::Withdraw, &context, &transition);
        let record = Self::commit_transition(&env, &action_id, transition);
        Self::change_liabilities(&env, -amount);
        let token = Self::token(&env);
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &destination,
            &amount,
        );
        Self::assert_backing(&env);
        record
    }

    pub fn info(env: Env) -> PaymentVaultInfo {
        Self::bump_instance(&env);
        PaymentVaultInfo {
            token: Self::token(&env),
            verifier: env.storage().instance().get(&DataKey::Verifier).unwrap(),
            verifier_domain: env
                .storage()
                .instance()
                .get(&DataKey::VerifierDomain)
                .unwrap(),
            network_domain: env
                .storage()
                .instance()
                .get(&DataKey::NetworkDomain)
                .unwrap(),
            tree_levels: Self::tree_levels(&env),
            root_history_size: env
                .storage()
                .instance()
                .get(&DataKey::RootHistorySize)
                .unwrap(),
            next_leaf_index: Self::next_leaf_index(&env),
            current_root: Self::current_root(&env),
            liabilities: Self::liabilities(&env),
            paused: Self::paused(&env),
            fee: Self::active_fee(&env),
            relay_count: env
                .storage()
                .instance()
                .get(&DataKey::RelayCount)
                .unwrap_or(0),
        }
    }

    pub fn action(env: Env, action_id: BytesN<32>) -> Option<PaymentActionRecord> {
        let key = DataKey::Action(action_id);
        let record = env.storage().persistent().get(&key);
        if record.is_some() {
            Self::bump_persistent(&env, &key);
        }
        record
    }

    pub fn root_accepted(env: Env, root: U256) -> bool {
        Self::root_is_accepted(&env, &root)
    }

    pub fn nullifier_spent(env: Env, nullifier: U256) -> bool {
        let key = DataKey::Nullifier(nullifier);
        let spent = env.storage().persistent().has(&key);
        if spent {
            Self::bump_persistent(&env, &key);
        }
        spent
    }

    pub fn set_paused(env: Env, admin: Address, paused: bool) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &paused);
        PaymentPauseChanged { paused }.publish(&env);
        Self::bump_instance(&env);
    }

    pub fn add_relay(env: Env, admin: Address, signing_key: BytesN<32>) {
        Self::require_admin(&env, &admin);
        Self::add_relay_key(&env, &signing_key);
        Self::bump_instance(&env);
    }

    pub fn remove_relay(env: Env, admin: Address, signing_key: BytesN<32>) {
        Self::require_admin(&env, &admin);
        let key = DataKey::Relay(signing_key);
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, PaymentVaultError::InvalidRelay);
        }
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RelayCount)
            .unwrap_or(0);
        if count <= 1 {
            panic_with_error!(&env, PaymentVaultError::InvalidRelay);
        }
        env.storage().persistent().remove(&key);
        env.storage()
            .instance()
            .set(&DataKey::RelayCount, &(count - 1));
        Self::bump_instance(&env);
    }

    pub fn schedule_fee(
        env: Env,
        admin: Address,
        protocol_fee: i128,
        protocol_identity: PaymentIdentity,
        activates_at: u64,
    ) -> PaymentFeeConfig {
        Self::require_admin(&env, &admin);
        let now = env.ledger().timestamp();
        if !(0..=MAX_PAYMENT_AMOUNT).contains(&protocol_fee)
            || !Self::valid_identity(&env, &protocol_identity)
            || activates_at < now.saturating_add(MIN_FEE_DELAY)
        {
            panic_with_error!(&env, PaymentVaultError::InvalidFee);
        }
        let current = Self::active_fee(&env);
        let config = PaymentFeeConfig {
            epoch: current
                .epoch
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, PaymentVaultError::Arithmetic)),
            protocol_fee,
            protocol_identity,
        };
        env.storage().instance().set(
            &DataKey::PendingFee,
            &PendingFeeConfig {
                config: config.clone(),
                activates_at,
            },
        );
        Self::bump_instance(&env);
        config
    }

    pub fn activate_fee(env: Env) -> PaymentFeeConfig {
        let pending: PendingFeeConfig = env
            .storage()
            .instance()
            .get(&DataKey::PendingFee)
            .unwrap_or_else(|| panic_with_error!(&env, PaymentVaultError::InvalidFee));
        let now = env.ledger().timestamp();
        if now < pending.activates_at {
            panic_with_error!(&env, PaymentVaultError::InvalidFee);
        }
        let current = Self::active_fee(&env);
        env.storage().instance().set(
            &DataKey::PreviousFee,
            &PreviousFeeConfig {
                config: current,
                valid_until: now.saturating_add(FEE_GRACE),
            },
        );
        env.storage().instance().set(&DataKey::Fee, &pending.config);
        env.storage().instance().remove(&DataKey::PendingFee);
        Self::bump_instance(&env);
        pending.config
    }

    pub fn keep_alive(
        env: Env,
        roots: Vec<U256>,
        nullifiers: Vec<U256>,
        commitments: Vec<U256>,
        actions: Vec<BytesN<32>>,
    ) {
        let total = roots
            .len()
            .checked_add(nullifiers.len())
            .and_then(|value| value.checked_add(commitments.len()))
            .and_then(|value| value.checked_add(actions.len()))
            .unwrap_or(MAX_KEEP_ALIVE_ITEMS + 1);
        if total > MAX_KEEP_ALIVE_ITEMS {
            panic_with_error!(&env, PaymentVaultError::InvalidConfiguration);
        }
        for root in roots.iter() {
            Self::bump_if_present(&env, &DataKey::Root(root));
        }
        for nullifier in nullifiers.iter() {
            Self::bump_if_present(&env, &DataKey::Nullifier(nullifier));
        }
        for commitment in commitments.iter() {
            Self::bump_if_present(&env, &DataKey::Commitment(commitment));
        }
        for action in actions.iter() {
            Self::bump_if_present(&env, &DataKey::Action(action));
        }
        Self::bump_instance(&env);
    }

    fn validate_transition(
        env: &Env,
        action: PaymentAction,
        context: &PaymentContext,
        transition: &PaymentTransition,
    ) {
        let now = env.ledger().timestamp();
        if context.expiry < now || context.expiry > now.saturating_add(MAX_ACTION_LIFETIME) {
            panic_with_error!(env, PaymentVaultError::Expired);
        }
        if transition.statement.action != action
            || transition.statement.public_amount != context.public_amount
            || transition.statement.output_commitments.len() != context.output_count
            || transition.encrypted_outputs.len() != context.output_count
            || context.append_count != context.output_count
        {
            panic_with_error!(env, PaymentVaultError::InvalidAction);
        }
        let expected_context = payment_context_digest(env, context)
            .unwrap_or_else(|_| panic_with_error!(env, PaymentVaultError::InvalidAction));
        if transition.statement.context_digest != expected_context {
            panic_with_error!(env, PaymentVaultError::InvalidAction);
        }
        if action == PaymentAction::Deposit {
            if transition.statement.membership_root != U256::from_u32(env, 0) {
                panic_with_error!(env, PaymentVaultError::InvalidRoot);
            }
        } else if !Self::root_is_accepted(env, &transition.statement.membership_root) {
            panic_with_error!(env, PaymentVaultError::InvalidRoot);
        }

        Self::validate_nullifiers(env, &transition.statement.input_nullifiers);
        Self::validate_outputs(env, transition);
        Self::require_capacity(env, context.append_count);
        let verifier: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        if !PaymentVerifierClient::new(env, &verifier)
            .verify(&transition.statement, &transition.proof)
        {
            panic_with_error!(env, PaymentVaultError::InvalidProof);
        }
    }

    fn validate_nullifiers(env: &Env, nullifiers: &Vec<U256>) {
        for left in 0..nullifiers.len() {
            let value = nullifiers.get(left).unwrap();
            if value == U256::from_u32(env, 0) || !is_canonical_field(env, &value) {
                panic_with_error!(env, PaymentVaultError::InvalidNullifier);
            }
            if env
                .storage()
                .persistent()
                .has(&DataKey::Nullifier(value.clone()))
            {
                panic_with_error!(env, PaymentVaultError::SpentNullifier);
            }
            for right in left + 1..nullifiers.len() {
                if value == nullifiers.get(right).unwrap() {
                    panic_with_error!(env, PaymentVaultError::InvalidNullifier);
                }
            }
        }
    }

    fn validate_outputs(env: &Env, transition: &PaymentTransition) {
        let commitments = &transition.statement.output_commitments;
        for left in 0..commitments.len() {
            let commitment = commitments.get(left).unwrap();
            if commitment == U256::from_u32(env, 0) || !is_canonical_field(env, &commitment) {
                panic_with_error!(env, PaymentVaultError::InvalidCommitment);
            }
            if env
                .storage()
                .persistent()
                .has(&DataKey::Commitment(commitment.clone()))
            {
                panic_with_error!(env, PaymentVaultError::DuplicateCommitment);
            }
            for right in left + 1..commitments.len() {
                if commitment == commitments.get(right).unwrap() {
                    panic_with_error!(env, PaymentVaultError::DuplicateCommitment);
                }
            }
            let envelope = transition.encrypted_outputs.get(left).unwrap();
            if envelope.len() != PAYMENT_OUTPUT_ENVELOPE_LENGTH {
                panic_with_error!(env, PaymentVaultError::InvalidEnvelope);
            }
            let hash = output_envelope_hash(env, &envelope)
                .unwrap_or_else(|_| panic_with_error!(env, PaymentVaultError::InvalidEnvelope));
            if transition.statement.output_envelope_hashes.get(left) != Some(hash) {
                panic_with_error!(env, PaymentVaultError::InvalidEnvelope);
            }
        }
        if transition.statement.action == PaymentAction::Transfer {
            let hash = payment_attachment_hash(env, &transition.attachment)
                .unwrap_or_else(|_| panic_with_error!(env, PaymentVaultError::InvalidAttachment));
            if hash != transition.statement.attachment_hash {
                panic_with_error!(env, PaymentVaultError::InvalidAttachment);
            }
        } else if !transition.attachment.is_empty()
            || transition.statement.attachment_hash != U256::from_u32(env, 0)
        {
            panic_with_error!(env, PaymentVaultError::InvalidAttachment);
        }
    }

    fn commit_transition(
        env: &Env,
        action_id: &BytesN<32>,
        transition: PaymentTransition,
    ) -> PaymentActionRecord {
        let first_leaf_index = Self::next_leaf_index(env);
        for nullifier in transition.statement.input_nullifiers.iter() {
            let key = DataKey::Nullifier(nullifier);
            env.storage().persistent().set(&key, &true);
            Self::bump_persistent(env, &key);
        }
        for commitment in transition.statement.output_commitments.iter() {
            let key = DataKey::Commitment(commitment);
            env.storage().persistent().set(&key, &true);
            Self::bump_persistent(env, &key);
        }
        let new_root = Self::append_commitments(env, &transition.statement.output_commitments);
        let record = PaymentActionRecord {
            action: transition.statement.action,
            context_digest: transition.statement.context_digest.clone(),
            first_leaf_index,
            output_count: transition.statement.output_commitments.len(),
            new_root: new_root.clone(),
            public_amount: transition.statement.public_amount,
            completed_at: env.ledger().timestamp(),
        };
        let action_key = DataKey::Action(action_id.clone());
        env.storage().persistent().set(&action_key, &record);
        Self::bump_persistent(env, &action_key);

        for index in 0..transition.statement.output_commitments.len() {
            PaymentOutputCreated {
                action_id: action_id.clone(),
                output_index: index,
                leaf_index: first_leaf_index + index,
                commitment: transition.statement.output_commitments.get(index).unwrap(),
                encrypted_output: transition.encrypted_outputs.get(index).unwrap(),
            }
            .publish(env);
        }
        if transition.statement.action == PaymentAction::Transfer {
            PaymentAttachmentCreated {
                action_id: action_id.clone(),
                attachment_hash: transition.statement.attachment_hash,
                encrypted_attachment: transition.attachment,
            }
            .publish(env);
        }
        PaymentActionCompleted {
            action_id: action_id.clone(),
            action: record.action,
            first_leaf_index,
            output_count: record.output_count,
            new_root,
            public_amount: record.public_amount,
        }
        .publish(env);
        Self::bump_instance(env);
        record
    }

    fn append_commitments(env: &Env, commitments: &Vec<U256>) -> U256 {
        if commitments.is_empty() {
            return Self::current_root(env);
        }
        let levels = Self::tree_levels(env);
        let mut frontier: Vec<U256> = env.storage().instance().get(&DataKey::Frontier).unwrap();
        let empty_subtrees: Vec<U256> = env
            .storage()
            .instance()
            .get(&DataKey::EmptySubtrees)
            .unwrap();
        let mut next = Self::next_leaf_index(env);
        let mut root = Self::current_root(env);
        for commitment in commitments.iter() {
            let mut node = commitment;
            let mut position = next;
            for level in 0..levels {
                if position & 1 == 0 {
                    frontier.set(level, node.clone());
                    let empty = empty_subtrees.get(level).unwrap();
                    node = merkle_node(env, &node, &empty).unwrap();
                } else {
                    let left = frontier.get(level).unwrap();
                    node = merkle_node(env, &left, &node).unwrap();
                }
                position >>= 1;
            }
            root = node;
            next = next
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(env, PaymentVaultError::Arithmetic));
        }
        env.storage().instance().set(&DataKey::Frontier, &frontier);
        env.storage().instance().set(&DataKey::NextLeafIndex, &next);
        env.storage().instance().set(&DataKey::CurrentRoot, &root);
        Self::record_root(env, root.clone());
        root
    }

    fn record_root(env: &Env, root: U256) {
        let mut history: Vec<U256> = env.storage().instance().get(&DataKey::RootHistory).unwrap();
        let limit: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RootHistorySize)
            .unwrap();
        if history.len() >= limit {
            let expired = history.get(0).unwrap();
            history.remove(0);
            env.storage().persistent().remove(&DataKey::Root(expired));
        }
        history.push_back(root.clone());
        let key = DataKey::Root(root);
        env.storage().persistent().set(&key, &true);
        Self::bump_persistent(env, &key);
        env.storage()
            .instance()
            .set(&DataKey::RootHistory, &history);
    }

    #[allow(clippy::too_many_arguments)]
    fn context(
        env: &Env,
        action_id: &BytesN<32>,
        expiry: u64,
        public_account: Option<Address>,
        public_amount: i128,
        emergency: bool,
        fee: PaymentFeeConfig,
        relay_quote_digest: U256,
        relay_fee: i128,
        relay_identity: PaymentIdentity,
        attachment_hash: U256,
    ) -> PaymentContext {
        PaymentContext {
            network_domain: env
                .storage()
                .instance()
                .get(&DataKey::NetworkDomain)
                .unwrap(),
            vault: env.current_contract_address(),
            token: Self::token(env),
            verifier_domain: env
                .storage()
                .instance()
                .get(&DataKey::VerifierDomain)
                .unwrap(),
            action: if public_amount > 0 {
                PaymentAction::Deposit
            } else if public_amount < 0 {
                PaymentAction::Withdraw
            } else {
                PaymentAction::Transfer
            },
            action_id: action_id.clone(),
            expiry,
            public_account,
            public_amount,
            output_count: if emergency {
                0
            } else if public_amount > 0 {
                2
            } else if public_amount < 0 {
                3
            } else {
                4
            },
            append_count: if emergency {
                0
            } else if public_amount > 0 {
                2
            } else if public_amount < 0 {
                3
            } else {
                4
            },
            emergency,
            fee,
            relay_quote_digest,
            relay_fee,
            relay_identity,
            attachment_hash,
        }
    }

    fn validate_quote(
        env: &Env,
        action_id: &BytesN<32>,
        action_expiry: u64,
        quote: &RelayQuote,
    ) -> (U256, i128, PaymentIdentity) {
        let now = env.ledger().timestamp();
        if quote.expiry < now
            || quote.expiry > action_expiry
            || !(0..=MAX_PAYMENT_AMOUNT).contains(&quote.fee)
            || !Self::valid_identity(env, &quote.payment_identity)
            || !env
                .storage()
                .persistent()
                .has(&DataKey::Relay(quote.signing_key.clone()))
        {
            panic_with_error!(env, PaymentVaultError::InvalidRelay);
        }
        let unsigned = unsigned_relay_quote(
            env.storage()
                .instance()
                .get(&DataKey::NetworkDomain)
                .unwrap(),
            env.current_contract_address(),
            Self::token(env),
            action_id.clone(),
            quote,
        );
        env.crypto().ed25519_verify(
            &quote.signing_key,
            &relay_quote_message(env, &unsigned),
            &quote.signature,
        );
        let digest = relay_quote_digest(env, &unsigned)
            .unwrap_or_else(|_| panic_with_error!(env, PaymentVaultError::InvalidRelay));
        (digest, quote.fee, quote.payment_identity.clone())
    }

    fn idempotent_record(
        env: &Env,
        action_id: &BytesN<32>,
        statement: &PaymentProofStatement,
    ) -> Option<PaymentActionRecord> {
        if Self::is_zero_bytes32(action_id) {
            panic_with_error!(env, PaymentVaultError::InvalidAction);
        }
        let key = DataKey::Action(action_id.clone());
        let record: Option<PaymentActionRecord> = env.storage().persistent().get(&key);
        if let Some(record) = record {
            Self::bump_persistent(env, &key);
            if record.action == statement.action
                && record.context_digest == statement.context_digest
            {
                return Some(record);
            }
            panic_with_error!(env, PaymentVaultError::DuplicateAction);
        }
        None
    }

    fn require_capacity(env: &Env, append_count: u32) {
        let capacity = 1u64 << Self::tree_levels(env);
        if u64::from(Self::next_leaf_index(env)) + u64::from(append_count) > capacity {
            panic_with_error!(env, PaymentVaultError::Capacity);
        }
    }

    fn change_liabilities(env: &Env, delta: i128) {
        let liabilities = Self::liabilities(env)
            .checked_add(delta)
            .unwrap_or_else(|| panic_with_error!(env, PaymentVaultError::Arithmetic));
        if liabilities < 0 || liabilities > MAX_PAYMENT_AMOUNT {
            panic_with_error!(env, PaymentVaultError::InsufficientBacking);
        }
        env.storage()
            .instance()
            .set(&DataKey::Liabilities, &liabilities);
    }

    fn assert_backing(env: &Env) {
        let balance =
            token::Client::new(env, &Self::token(env)).balance(&env.current_contract_address());
        if balance < Self::liabilities(env) {
            panic_with_error!(env, PaymentVaultError::InsufficientBacking);
        }
    }

    fn fee_for_epoch(env: &Env, epoch: u64) -> PaymentFeeConfig {
        let current = Self::active_fee(env);
        if current.epoch == epoch {
            return current;
        }
        let previous: Option<PreviousFeeConfig> =
            env.storage().instance().get(&DataKey::PreviousFee);
        if let Some(previous) = previous {
            if previous.config.epoch == epoch && env.ledger().timestamp() <= previous.valid_until {
                return previous.config;
            }
        }
        panic_with_error!(env, PaymentVaultError::InvalidFee);
    }

    fn active_fee(env: &Env) -> PaymentFeeConfig {
        env.storage().instance().get(&DataKey::Fee).unwrap()
    }

    fn fee_without_protocol_charge(config: &PaymentFeeConfig) -> PaymentFeeConfig {
        PaymentFeeConfig {
            epoch: config.epoch,
            protocol_fee: 0,
            protocol_identity: config.protocol_identity.clone(),
        }
    }

    fn add_relay_key(env: &Env, signing_key: &BytesN<32>) {
        if Self::is_zero_bytes32(signing_key) {
            panic_with_error!(env, PaymentVaultError::InvalidRelay);
        }
        let key = DataKey::Relay(signing_key.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(env, PaymentVaultError::InvalidRelay);
        }
        env.storage().persistent().set(&key, &true);
        Self::bump_persistent(env, &key);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RelayCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::RelayCount, &(count + 1));
    }

    fn valid_identity(env: &Env, identity: &PaymentIdentity) -> bool {
        identity.spend_public_key != U256::from_u32(env, 0)
            && is_canonical_field(env, &identity.spend_public_key)
            && is_valid_babyjub_encryption_point(
                env,
                &identity.viewing_public_key_x,
                &identity.viewing_public_key_y,
            )
    }

    fn root_is_accepted(env: &Env, root: &U256) -> bool {
        if !is_canonical_field(env, root) {
            return false;
        }
        let key = DataKey::Root(root.clone());
        let accepted = env.storage().persistent().has(&key);
        if accepted {
            Self::bump_persistent(env, &key);
        }
        accepted
    }

    fn require_not_paused(env: &Env) {
        if Self::paused(env) {
            panic_with_error!(env, PaymentVaultError::Paused);
        }
    }

    fn require_admin(env: &Env, admin: &Address) {
        let configured: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if configured != *admin {
            panic_with_error!(env, PaymentVaultError::InvalidConfiguration);
        }
        admin.require_auth();
    }

    fn token(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    fn tree_levels(env: &Env) -> u32 {
        env.storage().instance().get(&DataKey::TreeLevels).unwrap()
    }

    fn next_leaf_index(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::NextLeafIndex)
            .unwrap()
    }

    fn current_root(env: &Env) -> U256 {
        env.storage().instance().get(&DataKey::CurrentRoot).unwrap()
    }

    fn liabilities(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Liabilities).unwrap()
    }

    fn paused(env: &Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap()
    }

    fn is_zero_bytes32(value: &BytesN<32>) -> bool {
        value.to_array().iter().all(|byte| *byte == 0)
    }

    fn bump_if_present(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            Self::bump_persistent(env, key);
        }
    }

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn bump_persistent(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}
