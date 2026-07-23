#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, Bytes, BytesN, Env, Vec, U256,
};

use privacy_types::{
    address_limbs, bytes32_limbs, empty_merkle_root, empty_operation_binding,
    is_valid_babyjub_encryption_point, merkle_node, operation_context_digest, output_envelope_hash,
    set_binding_field, tagged_poseidon2_hash, zero_fields, OUTPUT_ENVELOPE_LENGTH,
};
pub use privacy_types::{
    BatchProofStatement, BatchQuote, BindingKind, OperationBinding, OperationContext, ProofAction,
    ProofStatement,
};

#[cfg(test)]
mod test;

const EXPECTED_USDC_DECIMALS: u32 = 7;
const MIN_TREE_LEVELS: u32 = 8;
const MAX_TREE_LEVELS: u32 = 31;
const MIN_ROOT_HISTORY: u32 = 8;
const MAX_ROOT_HISTORY: u32 = 128;
const ORDER_CIPHERTEXT_FIELDS: u32 = 4;
const ACCEPTED_TREE_LEVELS: u32 = 6;
const ACCEPTED_LEAF_HASH_TAG: u32 = 1009;
const MAX_PROOF_LENGTH: u32 = 512;
const MAX_PRIVATE_BATCH_SIZE: u32 = 8;
const MAX_ACTION_LIFETIME: u64 = 86_400;
const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000;
const MAX_KEEP_ALIVE_ITEMS: u32 = 16;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;
const BN254_SCALAR_MODULUS: [u8; 32] = [
    48, 100, 78, 114, 225, 49, 160, 41, 184, 80, 69, 182, 129, 129, 88, 93, 40, 51, 232, 72, 121,
    185, 112, 145, 67, 225, 245, 147, 240, 0, 0, 1,
];

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityBinding {
    pub liquidity_vault: Address,
    pub share_commitment: BytesN<32>,
    pub shares: i128,
    pub expected_assets: i128,
    pub expected_version: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExitRequestBinding {
    pub liquidity_vault: Address,
    pub exit_id: BytesN<32>,
    pub shares: i128,
    pub minimum_payment: i128,
    pub destination: BytesN<32>,
    pub exit_expiry: u64,
    pub expected_version: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExitCancelBinding {
    pub liquidity_vault: Address,
    pub exit_id: BytesN<32>,
    pub shares_remaining: i128,
    pub minimum_payment_remaining: i128,
    pub destination: BytesN<32>,
    pub exit_expiry: u64,
    pub expected_version: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExitMatchBinding {
    pub liquidity_vault: Address,
    pub exit_id: BytesN<32>,
    pub shares: i128,
    pub payment: i128,
    pub shares_remaining: i128,
    pub minimum_payment_remaining: i128,
    pub destination: BytesN<32>,
    pub exit_expiry: u64,
    pub market_state_version: u64,
    pub equity_if_yes: i128,
    pub equity_if_no: i128,
    pub conditional_lp_fees: i128,
    pub state_updated_at: u64,
    pub maximum_state_age: u64,
    pub expected_version: u64,
    pub minimum_for_fill: i128,
    pub next_minimum_payment: i128,
    pub remaining_destination: BytesN<32>,
    pub remaining_shares: i128,
    pub market_expiry: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EpochPhase {
    Collecting,
    Sealed,
    Executed,
    Refundable,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Pending,
    Executed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketOutcome {
    Yes,
    No,
    Void,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketSide {
    Yes,
    No,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlementState {
    Pending,
    Yes,
    No,
    Void,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketInfo {
    pub asset: soroban_sdk::Symbol,
    pub threshold: i128,
    pub expiry: u64,
    pub finalize_after: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketPrivateConfig {
    pub batcher: Address,
    pub liquidity_vault: Address,
    pub resolver: Address,
    pub rules_hash: BytesN<32>,
    pub funding: i128,
    pub fee_bps: u32,
    pub lp_fee_share_bps: u32,
    pub lot_size: i128,
    pub fixed_batch_size: u32,
    pub minimum_side_count: u32,
    pub maximum_price_movement: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketFeeState {
    pub escrow: i128,
    pub rounding_receivable: i128,
    pub conditional_lp_fee: i128,
    pub conditional_protocol_fee: i128,
    pub vested: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketRegistration {
    pub market: Address,
    pub epoch_duration: u64,
    pub refund_delay: u64,
    pub committee_epoch: u64,
    pub committee_config_hash: BytesN<32>,
    pub committee_public_key_x: U256,
    pub committee_public_key_y: U256,
    pub current_epoch: u64,
    pub expiry: u64,
    pub finalize_after: u64,
    pub lot_size: i128,
    pub fixed_batch_size: u32,
    pub minimum_side_count: u32,
    pub fee_bps: u32,
    pub lp_fee_share_bps: u32,
    pub maximum_price_movement: i128,
    pub rules_hash: BytesN<32>,
    pub finalized: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpochState {
    pub market: Address,
    pub epoch: u64,
    pub phase: EpochPhase,
    pub market_state_version: u64,
    pub accepted_root: U256,
    pub accepted_count: u32,
    pub first_sequence: u64,
    pub last_sequence: u64,
    pub opened_at: u64,
    pub cutoff: u64,
    pub refund_at: u64,
    pub committee_epoch: u64,
    pub committee_config_hash: BytesN<32>,
    pub committee_public_key_x: U256,
    pub committee_public_key_y: U256,
    pub allocation_root: Option<U256>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EncryptedOrder {
    pub c1_x: U256,
    pub c1_y: U256,
    pub c2_x: U256,
    pub c2_y: U256,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderBinding {
    pub market: Address,
    pub epoch: u64,
    pub market_state_version: u64,
    pub position_commitment: U256,
    pub lot_size: i128,
    pub fee_bps: u32,
    pub fixed_batch_size: u32,
    pub minimum_side_count: u32,
    pub maximum_price_movement: i128,
    pub rules_hash: BytesN<32>,
    pub refund_at: u64,
    pub committee_epoch: u64,
    pub committee_config_hash: BytesN<32>,
    pub committee_public_key_x: U256,
    pub committee_public_key_y: U256,
    pub encrypted_order: EncryptedOrder,
    pub old_accepted_root: U256,
    pub new_accepted_root: U256,
    pub accepted_leaf_index: u32,
    pub sequence: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderRecord {
    pub sequence: u64,
    pub market: Address,
    pub epoch: u64,
    pub action_id: BytesN<32>,
    pub position_commitment: U256,
    pub encrypted_order: EncryptedOrder,
    pub accepted_at: u64,
    pub refund_at: u64,
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedLeaf {
    pub market: Address,
    pub epoch: u64,
    pub sequence: u64,
    pub action_id: BytesN<32>,
    pub position_commitment: U256,
    pub encrypted_order: EncryptedOrder,
    pub committee_epoch: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchSubmission {
    pub yes_count: u32,
    pub no_count: u32,
    pub committee_epoch: u64,
    pub aggregate_ciphertext: EncryptedOrder,
    pub decryption_proof_hash: BytesN<32>,
    pub committee_statement_hash: BytesN<32>,
    pub allocation_root: U256,
    pub included_root: U256,
    pub proof: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRecord {
    pub market: Address,
    pub epoch: u64,
    pub accepted_root: U256,
    pub allocation_root: U256,
    pub included_root: U256,
    pub quote: BatchQuote,
    pub user_market_charge: i128,
    pub executed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketAccounting {
    pub user_market_charges: i128,
    pub rounding_advanced: i128,
    pub fee_escrow: i128,
    pub conditional_lp_fee: i128,
    pub conditional_protocol_fee: i128,
    pub finalized_outcome: SettlementState,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundBinding {
    pub market: Address,
    pub epoch: u64,
    pub accepted_root: U256,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllocationBinding {
    pub market: Address,
    pub epoch: u64,
    pub allocation_root: U256,
    pub outcome: SettlementState,
    pub lot_size: i128,
    pub quote: BatchQuote,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivateTransition {
    pub proof: Bytes,
    pub membership_root: U256,
    pub append_root: U256,
    pub new_root: U256,
    pub input_nullifiers: Vec<U256>,
    pub output_commitments: Vec<U256>,
    pub encrypted_outputs: Vec<Bytes>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputRecord {
    pub commitment: U256,
    pub leaf_index: u32,
    pub root: U256,
    pub action_id: BytesN<32>,
    pub encrypted_output: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RootRecord {
    pub root: U256,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultInfo {
    pub token: Address,
    pub factory: Address,
    pub governance: Address,
    pub verifier: Address,
    pub network_domain: BytesN<32>,
    pub verifier_domain: BytesN<32>,
    pub treasury_key: BytesN<32>,
    pub levels: u32,
    pub root_history_size: u32,
    pub max_root_age: u32,
    pub output_envelope_length: u32,
    pub order_ciphertext_fields: u32,
    pub next_leaf_index: u32,
    pub current_root: U256,
    pub shielded_liabilities: i128,
    pub rounding_reserve: i128,
    pub rounding_receivable: i128,
    pub protocol_fees: i128,
    pub deposits_paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundingResult {
    pub accepted_assets: i128,
    pub unused_assets: i128,
    pub shares_minted: i128,
    pub state_version: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExitStatus {
    Open,
    Matched,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExitIntent {
    pub shares_remaining: i128,
    pub minimum_payment_remaining: i128,
    pub destination: BytesN<32>,
    pub expiry: u64,
    pub status: ExitStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExitFill {
    pub shares_transferred: i128,
    pub shares_remaining: i128,
    pub seller_payment: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketSnapshot {
    pub state_version: u64,
    pub equity_if_yes: i128,
    pub equity_if_no: i128,
    pub conditional_lp_fees: i128,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Factory,
    Governance,
    Verifier,
    NetworkDomain,
    VerifierDomain,
    TreasuryKey,
    Levels,
    RootHistorySize,
    MaxRootAge,
    NextLeafIndex,
    CurrentRoot,
    CurrentRootSlot,
    Liabilities,
    RoundingReserve,
    RoundingReceivable,
    ProtocolFees,
    DepositsPaused,
    Root(u32),
    Nullifier(U256),
    Commitment(U256),
    Output(u32),
    Action(BytesN<32>),
    Registration(Address),
    Epoch(Address, u64),
    AcceptedFrontier(Address, u64, u32),
    MarketSequence(Address),
    Order(Address, u64),
    Batch(Address, u64),
    MarketAccounting(Address),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidConfiguration = 1,
    InvalidAmount = 2,
    InvalidExpiry = 3,
    InvalidProof = 4,
    InvalidProofStatement = 5,
    UnknownRoot = 6,
    StaleRoot = 7,
    RootMismatch = 8,
    DuplicateRoot = 9,
    DuplicateNullifier = 10,
    SpentNullifier = 11,
    DuplicateCommitment = 12,
    DuplicateAction = 13,
    InvalidEnvelope = 14,
    TreeFull = 15,
    TransferMismatch = 16,
    InsufficientBacking = 17,
    DepositsPaused = 18,
    TooManyItems = 19,
    Arithmetic = 20,
    MarketNotRegistered = 21,
    DuplicateMarket = 22,
    InvalidEpoch = 23,
    InvalidPhase = 24,
    EpochFull = 25,
    TooEarly = 26,
    StaleState = 27,
    InvalidBatch = 28,
    OrderNotFound = 29,
    InvalidOrder = 30,
    AlreadyFinalized = 31,
    InsufficientRoundingReserve = 32,
    ExitNotFound = 33,
    InvalidExit = 34,
}

#[contractevent(topics = ["shielded_output"], data_format = "vec")]
pub struct ShieldedOutput {
    #[topic]
    pub commitment: U256,
    pub leaf_index: u32,
    pub root: U256,
    pub action_id: BytesN<32>,
    pub encrypted_output: Bytes,
}

#[contractevent(topics = ["nullifier_spent"], data_format = "vec")]
pub struct NullifierSpent {
    #[topic]
    pub nullifier: U256,
    pub action_id: BytesN<32>,
}

#[contractevent(topics = ["vault_transition"], data_format = "vec")]
pub struct VaultTransition {
    #[topic]
    pub action_id: BytesN<32>,
    pub action: ProofAction,
    pub first_leaf_index: u32,
    pub new_root: U256,
}

#[contractevent(topics = ["market_registered"], data_format = "vec")]
pub struct MarketRegistered {
    #[topic]
    pub market: Address,
    pub epoch: u64,
    pub cutoff: u64,
    pub refund_at: u64,
}

#[contractevent(topics = ["private_order"], data_format = "vec")]
pub struct PrivateOrderAccepted {
    #[topic]
    pub market: Address,
    pub epoch: u64,
    pub sequence: u64,
    pub accepted_count: u32,
    pub accepted_root: U256,
}

#[contractevent(topics = ["epoch_sealed"], data_format = "vec")]
pub struct EpochSealed {
    #[topic]
    pub market: Address,
    pub epoch: u64,
    pub accepted_count: u32,
    pub accepted_root: U256,
    pub refund_at: u64,
}

#[contractevent(topics = ["epoch_executed"], data_format = "vec")]
pub struct EpochExecuted {
    #[topic]
    pub market: Address,
    pub epoch: u64,
    pub accepted_count: u32,
    pub allocation_root: U256,
    pub market_charge: i128,
    pub fee_escrow: i128,
}

#[contractevent(topics = ["epoch_refundable"], data_format = "vec")]
pub struct EpochRefundable {
    #[topic]
    pub market: Address,
    pub epoch: u64,
    pub accepted_count: u32,
}

#[contractevent(topics = ["market_finalized"], data_format = "vec")]
pub struct PrivateMarketFinalized {
    #[topic]
    pub market: Address,
    pub outcome: MarketOutcome,
    pub payout_received: i128,
    pub lp_fee: i128,
    pub protocol_fee: i128,
}

#[contractclient(crate_path = "soroban_sdk", name = "ProofVerifierClient")]
pub trait ProofVerifier {
    fn domain(env: Env) -> BytesN<32>;
    fn verify(env: Env, statement: ProofStatement, proof: Bytes) -> bool;
    fn verify_batch(env: Env, statement: BatchProofStatement, proof: Bytes) -> bool;
}

#[contractclient(crate_path = "soroban_sdk", name = "LiquidityVaultClient")]
pub trait LiquidityVault {
    fn fund_received(
        env: Env,
        controller: Address,
        share_commitment: BytesN<32>,
        amount: i128,
        prior_unallocated_balance: i128,
        expected_version: u64,
    ) -> FundingResult;

    fn unfund(env: Env, controller: Address, shares: i128, expected_version: u64) -> i128;

    fn redeem_terminal(env: Env, controller: Address, shares: i128, expected_version: u64) -> i128;

    fn unallocated_balance(env: Env) -> i128;
    fn state_version(env: Env) -> u64;
    fn market_snapshot(env: Env) -> Option<MarketSnapshot>;
    fn exit_intent(env: Env, exit_id: BytesN<32>) -> Option<ExitIntent>;
    fn request_exit(
        env: Env,
        controller: Address,
        exit_id: BytesN<32>,
        shares: i128,
        minimum_payment: i128,
        destination: BytesN<32>,
        expiry: u64,
        expected_version: u64,
    );
    fn match_exit(
        env: Env,
        controller: Address,
        exit_id: BytesN<32>,
        shares: i128,
        payment: i128,
        market_state_version: u64,
        equity_if_yes: i128,
        equity_if_no: i128,
        conditional_lp_fees: i128,
        state_updated_at: u64,
        maximum_state_age: u64,
        remaining_destination: BytesN<32>,
        expected_version: u64,
    ) -> ExitFill;
    fn cancel_exit(env: Env, controller: Address, exit_id: BytesN<32>, expected_version: u64);
}

#[contractclient(crate_path = "soroban_sdk", name = "MarketClient")]
pub trait Market {
    fn private_config(env: Env) -> Option<MarketPrivateConfig>;
    fn market_info(env: Env) -> MarketInfo;
    fn state_version(env: Env) -> u64;
    fn outcome(env: Env) -> Option<MarketOutcome>;
    fn quote_private_batch(
        env: Env,
        expected_version: u64,
        yes_count: u32,
        no_count: u32,
    ) -> BatchQuote;
    fn apply_private_batch(
        env: Env,
        batcher: Address,
        expected_version: u64,
        yes_count: u32,
        no_count: u32,
    ) -> BatchQuote;
    fn apply_private_batch_received(
        env: Env,
        batcher: Address,
        expected_version: u64,
        yes_count: u32,
        no_count: u32,
        prior_unallocated_balance: i128,
    ) -> BatchQuote;
    fn fee_state(env: Env) -> MarketFeeState;
    fn unallocated_balance(env: Env) -> i128;
    fn record_vested_fees(
        env: Env,
        batcher: Address,
        lp_fee: i128,
        prior_unallocated_balance: i128,
        expected_version: u64,
    ) -> MarketFeeState;
    fn redeem(env: Env, trader: Address, side: MarketSide) -> i128;
    fn settle_liquidity(env: Env) -> i128;
}

#[contract]
pub struct ShieldedCollateralVault;

#[contractimpl]
impl ShieldedCollateralVault {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        token: Address,
        factory: Address,
        governance: Address,
        verifier: Address,
        network_domain: BytesN<32>,
        verifier_domain: BytesN<32>,
        treasury_key: BytesN<32>,
        genesis_root: U256,
        levels: u32,
        root_history_size: u32,
        max_root_age: u32,
    ) {
        let decimals = token::Client::new(&env, &token).decimals();
        let deployed_verifier_domain = ProofVerifierClient::new(&env, &verifier).domain();
        if decimals != EXPECTED_USDC_DECIMALS
            || levels < MIN_TREE_LEVELS
            || levels > MAX_TREE_LEVELS
            || root_history_size < MIN_ROOT_HISTORY
            || root_history_size > MAX_ROOT_HISTORY
            || max_root_age == 0
            || Self::is_zero_bytes(&network_domain)
            || Self::is_zero_bytes(&verifier_domain)
            || deployed_verifier_domain != verifier_domain
            || Self::is_zero_bytes(&treasury_key)
            || !Self::canonical_field(
                &env,
                &U256::from_be_bytes(&env, &Bytes::from(treasury_key.clone())),
            )
            || !Self::canonical_field(&env, &genesis_root)
            || genesis_root == U256::from_u32(&env, 0)
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }

        let instance = env.storage().instance();
        instance.set(&DataKey::Token, &token);
        instance.set(&DataKey::Factory, &factory);
        instance.set(&DataKey::Governance, &governance);
        instance.set(&DataKey::Verifier, &verifier);
        instance.set(&DataKey::NetworkDomain, &network_domain);
        instance.set(&DataKey::VerifierDomain, &verifier_domain);
        instance.set(&DataKey::TreasuryKey, &treasury_key);
        instance.set(&DataKey::Levels, &levels);
        instance.set(&DataKey::RootHistorySize, &root_history_size);
        instance.set(&DataKey::MaxRootAge, &max_root_age);
        instance.set(&DataKey::NextLeafIndex, &0u32);
        instance.set(&DataKey::CurrentRoot, &genesis_root);
        instance.set(&DataKey::CurrentRootSlot, &0u32);
        instance.set(&DataKey::Liabilities, &0i128);
        instance.set(&DataKey::RoundingReserve, &0i128);
        instance.set(&DataKey::RoundingReceivable, &0i128);
        instance.set(&DataKey::ProtocolFees, &0i128);
        instance.set(&DataKey::DepositsPaused, &false);
        Self::store_root(&env, 0, &genesis_root);
        Self::bump_instance(&env);
    }

    pub fn info(env: Env) -> VaultInfo {
        Self::bump_instance(&env);
        let instance = env.storage().instance();
        VaultInfo {
            token: instance.get(&DataKey::Token).unwrap(),
            factory: instance.get(&DataKey::Factory).unwrap(),
            governance: instance.get(&DataKey::Governance).unwrap(),
            verifier: instance.get(&DataKey::Verifier).unwrap(),
            network_domain: instance.get(&DataKey::NetworkDomain).unwrap(),
            verifier_domain: instance.get(&DataKey::VerifierDomain).unwrap(),
            treasury_key: instance.get(&DataKey::TreasuryKey).unwrap(),
            levels: instance.get(&DataKey::Levels).unwrap(),
            root_history_size: instance.get(&DataKey::RootHistorySize).unwrap(),
            max_root_age: instance.get(&DataKey::MaxRootAge).unwrap(),
            output_envelope_length: OUTPUT_ENVELOPE_LENGTH,
            order_ciphertext_fields: ORDER_CIPHERTEXT_FIELDS,
            next_leaf_index: instance.get(&DataKey::NextLeafIndex).unwrap_or(0),
            current_root: instance.get(&DataKey::CurrentRoot).unwrap(),
            shielded_liabilities: instance.get(&DataKey::Liabilities).unwrap_or(0),
            rounding_reserve: instance.get(&DataKey::RoundingReserve).unwrap_or(0),
            rounding_receivable: instance.get(&DataKey::RoundingReceivable).unwrap_or(0),
            protocol_fees: instance.get(&DataKey::ProtocolFees).unwrap_or(0),
            deposits_paused: instance.get(&DataKey::DepositsPaused).unwrap_or(false),
        }
    }

    pub fn context_digest(
        env: Env,
        action: ProofAction,
        action_id: BytesN<32>,
        public_account: Option<Address>,
        public_amount: i128,
        market: Option<Address>,
        binding: OperationBinding,
        expiry: u64,
    ) -> U256 {
        Self::bump_instance(&env);
        let instance = env.storage().instance();
        let context = OperationContext {
            network_domain: instance.get(&DataKey::NetworkDomain).unwrap(),
            vault: env.current_contract_address(),
            token: instance.get(&DataKey::Token).unwrap(),
            verifier_domain: instance.get(&DataKey::VerifierDomain).unwrap(),
            action,
            action_id,
            public_account,
            public_amount,
            market,
            binding,
            expiry,
        };
        operation_context_digest(&env, &context)
            .unwrap_or_else(|_| panic_with_error!(&env, Error::InvalidProofStatement))
    }

    pub fn order_binding(
        env: Env,
        market: Address,
        epoch_number: u64,
        action_id: BytesN<32>,
        position_commitment: U256,
        encrypted_order: EncryptedOrder,
    ) -> OrderBinding {
        let registration = Self::market_registration(&env, &market);
        let epoch = Self::epoch_state(&env, &market, epoch_number);
        if registration.finalized
            || registration.current_epoch != epoch_number
            || epoch.phase != EpochPhase::Collecting
            || epoch.accepted_count >= registration.fixed_batch_size
            || !Self::valid_encrypted_order(&env, &encrypted_order)
            || !Self::canonical_nonzero_field(&env, &position_commitment)
        {
            panic_with_error!(&env, Error::InvalidOrder);
        }
        Self::build_order_binding(
            &env,
            &registration,
            &epoch,
            market,
            action_id,
            position_commitment,
            encrypted_order,
        )
    }

    pub fn register_market(
        env: Env,
        factory: Address,
        market: Address,
        epoch_duration: u64,
        refund_delay: u64,
        committee_epoch: u64,
        committee_config_hash: BytesN<32>,
        committee_public_key_x: U256,
        committee_public_key_y: U256,
    ) {
        let configured_factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        if factory != configured_factory {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        factory.require_auth();
        let registration_key = DataKey::Registration(market.clone());
        if env.storage().persistent().has(&registration_key) {
            panic_with_error!(&env, Error::DuplicateMarket);
        }
        if epoch_duration == 0
            || refund_delay == 0
            || committee_epoch == 0
            || Self::is_zero_bytes(&committee_config_hash)
            || !is_valid_babyjub_encryption_point(
                &env,
                &committee_public_key_x,
                &committee_public_key_y,
            )
            || epoch_duration
                .checked_add(refund_delay)
                .is_none_or(|duration| duration > MAX_ACTION_LIFETIME)
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        let client = MarketClient::new(&env, &market);
        let private = client
            .private_config()
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidConfiguration));
        let info = client.market_info();
        if private.batcher != env.current_contract_address()
            || private.fixed_batch_size < 8
            || private.fixed_batch_size > MAX_PRIVATE_BATCH_SIZE
            || private.minimum_side_count < 2
            || private
                .minimum_side_count
                .checked_mul(2)
                .is_none_or(|count| count > private.fixed_batch_size)
            || env.ledger().timestamp() >= info.expiry
            || info
                .expiry
                .checked_add(refund_delay)
                .is_none_or(|refund_at| refund_at > info.finalize_after)
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        let registration = MarketRegistration {
            market: market.clone(),
            epoch_duration,
            refund_delay,
            committee_epoch,
            committee_config_hash,
            committee_public_key_x,
            committee_public_key_y,
            current_epoch: 0,
            expiry: info.expiry,
            finalize_after: info.finalize_after,
            lot_size: private.lot_size,
            fixed_batch_size: private.fixed_batch_size,
            minimum_side_count: private.minimum_side_count,
            fee_bps: private.fee_bps,
            lp_fee_share_bps: private.lp_fee_share_bps,
            maximum_price_movement: private.maximum_price_movement,
            rules_hash: private.rules_hash,
            finalized: false,
        };
        let epoch = Self::new_epoch(&env, &registration, 0, client.state_version());
        env.storage()
            .persistent()
            .set(&registration_key, &registration);
        let epoch_key = DataKey::Epoch(market.clone(), 0);
        env.storage().persistent().set(&epoch_key, &epoch);
        let accounting_key = DataKey::MarketAccounting(market.clone());
        env.storage().persistent().set(
            &accounting_key,
            &MarketAccounting {
                user_market_charges: 0,
                rounding_advanced: 0,
                fee_escrow: 0,
                conditional_lp_fee: 0,
                conditional_protocol_fee: 0,
                finalized_outcome: SettlementState::Pending,
            },
        );
        Self::bump_persistent(&env, &registration_key);
        Self::bump_persistent(&env, &epoch_key);
        Self::bump_persistent(&env, &accounting_key);
        MarketRegistered {
            market,
            epoch: 0,
            cutoff: epoch.cutoff,
            refund_at: epoch.refund_at,
        }
        .publish(&env);
    }

    pub fn fund_rounding_reserve(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::validate_amount(&env, amount);
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let client = token::Client::new(&env, &token);
        let before = client.balance(&env.current_contract_address());
        client.transfer(&from, &env.current_contract_address(), &amount);
        let after = client.balance(&env.current_contract_address());
        if after.checked_sub(before) != Some(amount) {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        Self::increase_instance_total(&env, DataKey::RoundingReserve, amount);
        Self::assert_backing(&env);
    }

    pub fn withdraw_rounding_reserve(
        env: Env,
        governance: Address,
        recipient: Address,
        amount: i128,
    ) {
        let configured: Address = env.storage().instance().get(&DataKey::Governance).unwrap();
        if governance != configured {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        governance.require_auth();
        Self::validate_amount(&env, amount);
        Self::decrease_instance_total(
            &env,
            DataKey::RoundingReserve,
            amount,
            Error::InsufficientRoundingReserve,
        );
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );
        Self::assert_backing(&env);
    }

    pub fn deposit(
        env: Env,
        from: Address,
        amount: i128,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
    ) {
        from.require_auth();
        if env
            .storage()
            .instance()
            .get(&DataKey::DepositsPaused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::DepositsPaused);
        }
        Self::validate_amount(&env, amount);
        Self::validate_expiry(&env, expiry);
        Self::execute_transition(
            &env,
            ProofAction::Deposit,
            action_id.clone(),
            Some(from.clone()),
            amount,
            None,
            Self::empty_binding(&env),
            expiry,
            transition,
            0,
        );

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token);
        let before = token_client.balance(&env.current_contract_address());
        token_client.transfer(&from, &env.current_contract_address(), &amount);
        let after = token_client.balance(&env.current_contract_address());
        if after.checked_sub(before) != Some(amount) {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        let liabilities: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Liabilities)
            .unwrap_or(0);
        let updated = liabilities
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        env.storage()
            .instance()
            .set(&DataKey::Liabilities, &updated);
        Self::assert_backing(&env);
    }

    pub fn private_transfer(
        env: Env,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_expiry(&env, expiry);
        Self::execute_transition(
            &env,
            ProofAction::Transfer,
            action_id,
            None,
            0,
            None,
            Self::empty_binding(&env),
            expiry,
            transition,
            2,
        );
        Self::assert_backing(&env);
    }

    pub fn withdraw(
        env: Env,
        recipient: Address,
        amount: i128,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_amount(&env, amount);
        Self::validate_expiry(&env, expiry);
        Self::execute_transition(
            &env,
            ProofAction::Withdraw,
            action_id,
            Some(recipient.clone()),
            -amount,
            None,
            Self::empty_binding(&env),
            expiry,
            transition,
            2,
        );

        let liabilities: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Liabilities)
            .unwrap_or(0);
        let updated = liabilities
            .checked_sub(amount)
            .filter(|value| *value >= 0)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InsufficientBacking));
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token);
        let before = token_client.balance(&env.current_contract_address());
        if before < amount {
            panic_with_error!(&env, Error::InsufficientBacking);
        }
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);
        let after = token_client.balance(&env.current_contract_address());
        if before.checked_sub(after) != Some(amount) {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        env.storage()
            .instance()
            .set(&DataKey::Liabilities, &updated);
        Self::assert_backing(&env);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn fund_liquidity(
        env: Env,
        liquidity_vault: Address,
        amount: i128,
        expected_shares: i128,
        share_commitment: BytesN<32>,
        expected_version: u64,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
    ) -> FundingResult {
        Self::validate_amount(&env, amount);
        Self::validate_amount(&env, expected_shares);
        Self::validate_expiry(&env, expiry);
        let share_field = U256::from_be_bytes(&env, &Bytes::from(share_commitment.clone()));
        if !Self::canonical_nonzero_field(&env, &share_field)
            || transition.output_commitments.len() != 2
            || transition.output_commitments.get(1) != Some(share_field)
        {
            panic_with_error!(&env, Error::InvalidProofStatement);
        }
        let binding = LiquidityBinding {
            liquidity_vault: liquidity_vault.clone(),
            share_commitment: share_commitment.clone(),
            shares: expected_shares,
            expected_assets: amount,
            expected_version,
        };
        let operation_binding = Self::liquidity_operation_binding(&env, &binding);
        Self::execute_transition(
            &env,
            ProofAction::LiquidityFund,
            action_id,
            None,
            -amount,
            Some(liquidity_vault.clone()),
            operation_binding,
            expiry,
            transition,
            2,
        );

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let current = env.current_contract_address();
        let liquidity_client = LiquidityVaultClient::new(&env, &liquidity_vault);
        let prior_unallocated = liquidity_client.unallocated_balance();
        let token_client = token::Client::new(&env, &token);
        let before = token_client.balance(&current);
        token_client.transfer(&current, &liquidity_vault, &amount);
        let result = liquidity_client.fund_received(
            &current,
            &share_commitment,
            &amount,
            &prior_unallocated,
            &expected_version,
        );
        let after = token_client.balance(&current);
        if result.accepted_assets != amount
            || result.unused_assets != 0
            || result.shares_minted != expected_shares
            || before.checked_sub(after) != Some(amount)
        {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        Self::decrease_liabilities(&env, amount);
        Self::assert_backing(&env);
        result
    }

    #[allow(clippy::too_many_arguments)]
    pub fn unfund_liquidity(
        env: Env,
        liquidity_vault: Address,
        shares: i128,
        expected_assets: i128,
        remaining_share_commitment: BytesN<32>,
        expected_version: u64,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
    ) -> i128 {
        Self::receive_liquidity(
            &env,
            ProofAction::LiquidityExit,
            liquidity_vault,
            shares,
            expected_assets,
            remaining_share_commitment,
            expected_version,
            action_id,
            expiry,
            transition,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn redeem_liquidity(
        env: Env,
        liquidity_vault: Address,
        shares: i128,
        expected_assets: i128,
        remaining_share_commitment: BytesN<32>,
        expected_version: u64,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
    ) -> i128 {
        Self::receive_liquidity(
            &env,
            ProofAction::LiquidityRedeem,
            liquidity_vault,
            shares,
            expected_assets,
            remaining_share_commitment,
            expected_version,
            action_id,
            expiry,
            transition,
            true,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn request_liquidity_exit(
        env: Env,
        market: Address,
        liquidity_vault: Address,
        exit_id: BytesN<32>,
        shares: i128,
        minimum_payment: i128,
        destination: BytesN<32>,
        exit_expiry: u64,
        expected_version: u64,
        action_id: BytesN<32>,
        action_expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_amount(&env, shares);
        Self::validate_nonnegative_amount(&env, minimum_payment);
        Self::validate_expiry(&env, action_expiry);
        let registration = Self::active_exit_market(&env, &market, &liquidity_vault);
        if exit_expiry <= env.ledger().timestamp() || exit_expiry > registration.expiry {
            panic_with_error!(&env, Error::InvalidExit);
        }
        let destination_field = U256::from_be_bytes(&env, &Bytes::from(destination.clone()));
        if !Self::canonical_nonzero_field(&env, &destination_field)
            || transition.output_commitments.len() != 2
            || transition.output_commitments.get(1) != Some(destination_field)
        {
            panic_with_error!(&env, Error::InvalidProofStatement);
        }
        let binding = ExitRequestBinding {
            liquidity_vault: liquidity_vault.clone(),
            exit_id: exit_id.clone(),
            shares,
            minimum_payment,
            destination: destination.clone(),
            exit_expiry,
            expected_version,
        };
        Self::execute_transition(
            &env,
            ProofAction::ExitRequest,
            action_id,
            None,
            0,
            Some(market),
            Self::exit_request_operation_binding(&env, &binding),
            action_expiry,
            transition,
            2,
        );
        LiquidityVaultClient::new(&env, &liquidity_vault).request_exit(
            &env.current_contract_address(),
            &exit_id,
            &shares,
            &minimum_payment,
            &destination,
            &exit_expiry,
            &expected_version,
        );
        Self::assert_backing(&env);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn cancel_liquidity_exit(
        env: Env,
        market: Address,
        liquidity_vault: Address,
        exit_id: BytesN<32>,
        expected_version: u64,
        action_id: BytesN<32>,
        action_expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_expiry(&env, action_expiry);
        Self::linked_liquidity_market(&env, &market, &liquidity_vault);
        let client = LiquidityVaultClient::new(&env, &liquidity_vault);
        let intent = client
            .exit_intent(&exit_id)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ExitNotFound));
        if intent.status != ExitStatus::Open
            || intent.shares_remaining <= 0
            || intent.minimum_payment_remaining < 0
        {
            panic_with_error!(&env, Error::InvalidExit);
        }
        let binding = ExitCancelBinding {
            liquidity_vault: liquidity_vault.clone(),
            exit_id: exit_id.clone(),
            shares_remaining: intent.shares_remaining,
            minimum_payment_remaining: intent.minimum_payment_remaining,
            destination: intent.destination,
            exit_expiry: intent.expiry,
            expected_version,
        };
        Self::execute_transition(
            &env,
            ProofAction::ExitCancel,
            action_id,
            None,
            0,
            Some(market),
            Self::exit_cancel_operation_binding(&env, &binding),
            action_expiry,
            transition,
            1,
        );
        client.cancel_exit(&env.current_contract_address(), &exit_id, &expected_version);
        Self::assert_backing(&env);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn match_liquidity_exit(
        env: Env,
        market: Address,
        liquidity_vault: Address,
        exit_id: BytesN<32>,
        shares: i128,
        payment: i128,
        market_state_version: u64,
        equity_if_yes: i128,
        equity_if_no: i128,
        conditional_lp_fees: i128,
        state_updated_at: u64,
        maximum_state_age: u64,
        remaining_destination: BytesN<32>,
        expected_version: u64,
        action_id: BytesN<32>,
        action_expiry: u64,
        transition: PrivateTransition,
    ) -> ExitFill {
        Self::validate_amount(&env, shares);
        Self::validate_nonnegative_amount(&env, payment);
        Self::validate_nonnegative_amount(&env, equity_if_yes);
        Self::validate_nonnegative_amount(&env, equity_if_no);
        Self::validate_nonnegative_amount(&env, conditional_lp_fees);
        Self::validate_expiry(&env, action_expiry);
        let registration = Self::active_exit_market(&env, &market, &liquidity_vault);
        let client = LiquidityVaultClient::new(&env, &liquidity_vault);
        let intent = client
            .exit_intent(&exit_id)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ExitNotFound));
        let snapshot = client
            .market_snapshot()
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidExit));
        if intent.status != ExitStatus::Open
            || env.ledger().timestamp() > intent.expiry
            || shares > intent.shares_remaining
            || snapshot.state_version != market_state_version
            || snapshot.equity_if_yes != equity_if_yes
            || snapshot.equity_if_no != equity_if_no
            || snapshot.conditional_lp_fees != conditional_lp_fees
            || snapshot.updated_at != state_updated_at
            || maximum_state_age == 0
        {
            panic_with_error!(&env, Error::InvalidExit);
        }
        let minimum_for_fill = Self::minimum_exit_payment(
            &env,
            intent.minimum_payment_remaining,
            shares,
            intent.shares_remaining,
        );
        if payment < minimum_for_fill {
            panic_with_error!(&env, Error::InvalidExit);
        }
        let remaining_shares = intent
            .shares_remaining
            .checked_sub(shares)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        let next_minimum_payment = intent
            .minimum_payment_remaining
            .checked_sub(minimum_for_fill)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        let remaining_field =
            U256::from_be_bytes(&env, &Bytes::from(remaining_destination.clone()));
        if transition.output_commitments.len() != 4
            || (remaining_shares > 0
                && (!Self::canonical_nonzero_field(&env, &remaining_field)
                    || transition.output_commitments.get(3) != Some(remaining_field)))
            || (remaining_shares == 0 && !Self::is_zero_bytes(&remaining_destination))
        {
            panic_with_error!(&env, Error::InvalidProofStatement);
        }
        let binding = ExitMatchBinding {
            liquidity_vault: liquidity_vault.clone(),
            exit_id: exit_id.clone(),
            shares,
            payment,
            shares_remaining: intent.shares_remaining,
            minimum_payment_remaining: intent.minimum_payment_remaining,
            destination: intent.destination,
            exit_expiry: intent.expiry,
            market_state_version,
            equity_if_yes,
            equity_if_no,
            conditional_lp_fees,
            state_updated_at,
            maximum_state_age,
            expected_version,
            minimum_for_fill,
            next_minimum_payment,
            remaining_destination: remaining_destination.clone(),
            remaining_shares,
            market_expiry: registration.expiry,
        };
        Self::execute_transition(
            &env,
            ProofAction::ExitMatch,
            action_id,
            None,
            0,
            Some(market),
            Self::exit_match_operation_binding(&env, &binding),
            action_expiry,
            transition,
            3,
        );
        let fill = client.match_exit(
            &env.current_contract_address(),
            &exit_id,
            &shares,
            &payment,
            &market_state_version,
            &equity_if_yes,
            &equity_if_no,
            &conditional_lp_fees,
            &state_updated_at,
            &maximum_state_age,
            &remaining_destination,
            &expected_version,
        );
        if fill.shares_transferred != shares
            || fill.shares_remaining != remaining_shares
            || fill.seller_payment != payment
        {
            panic_with_error!(&env, Error::InvalidExit);
        }
        Self::assert_backing(&env);
        fill
    }

    pub fn accept_order(
        env: Env,
        market: Address,
        epoch_number: u64,
        action_id: BytesN<32>,
        position_commitment: U256,
        encrypted_order: EncryptedOrder,
        transition: PrivateTransition,
    ) -> OrderRecord {
        let registration = Self::market_registration(&env, &market);
        if registration.finalized || registration.current_epoch != epoch_number {
            panic_with_error!(&env, Error::InvalidEpoch);
        }
        let epoch_key = DataKey::Epoch(market.clone(), epoch_number);
        let mut epoch: EpochState = env
            .storage()
            .persistent()
            .get(&epoch_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidEpoch));
        if epoch.phase != EpochPhase::Collecting {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        if env.ledger().timestamp() >= epoch.cutoff {
            panic_with_error!(&env, Error::TooEarly);
        }
        if epoch.accepted_count >= registration.fixed_batch_size {
            panic_with_error!(&env, Error::EpochFull);
        }
        let client = MarketClient::new(&env, &market);
        if client.outcome().is_some() || client.state_version() != epoch.market_state_version {
            panic_with_error!(&env, Error::StaleState);
        }
        if !Self::valid_encrypted_order(&env, &encrypted_order)
            || !Self::canonical_nonzero_field(&env, &position_commitment)
            || transition.output_commitments.len() != 2
            || transition.output_commitments.get(1) != Some(position_commitment.clone())
        {
            panic_with_error!(&env, Error::InvalidOrder);
        }
        let binding = Self::build_order_binding(
            &env,
            &registration,
            &epoch,
            market.clone(),
            action_id.clone(),
            position_commitment.clone(),
            encrypted_order.clone(),
        );
        let sequence = binding.sequence;
        let accepted_leaf_index = binding.accepted_leaf_index;
        let new_accepted_root = binding.new_accepted_root.clone();
        let operation_binding = Self::order_operation_binding(&env, &binding);
        Self::execute_transition(
            &env,
            ProofAction::Order,
            action_id.clone(),
            None,
            0,
            Some(market.clone()),
            operation_binding,
            epoch.refund_at,
            transition,
            2,
        );

        let leaf = AcceptedLeaf {
            market: market.clone(),
            epoch: epoch_number,
            sequence,
            action_id: action_id.clone(),
            position_commitment: position_commitment.clone(),
            encrypted_order: encrypted_order.clone(),
            committee_epoch: epoch.committee_epoch,
        };
        Self::store_accepted_frontier(
            &env,
            &market,
            epoch_number,
            accepted_leaf_index,
            Self::accepted_leaf_hash(&env, &leaf),
        );
        let sequence_key = DataKey::MarketSequence(market.clone());
        env.storage().persistent().set(&sequence_key, &sequence);
        Self::bump_persistent(&env, &sequence_key);
        let record = OrderRecord {
            sequence,
            market: market.clone(),
            epoch: epoch_number,
            action_id,
            position_commitment,
            encrypted_order,
            accepted_at: env.ledger().timestamp(),
            refund_at: epoch.refund_at,
            status: OrderStatus::Pending,
        };
        let order_key = DataKey::Order(market.clone(), sequence);
        env.storage().persistent().set(&order_key, &record);
        Self::bump_persistent(&env, &order_key);
        epoch.accepted_count = epoch
            .accepted_count
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        if epoch.accepted_count == 1 {
            epoch.first_sequence = sequence;
        }
        epoch.last_sequence = sequence;
        epoch.accepted_root = new_accepted_root.clone();
        env.storage().persistent().set(&epoch_key, &epoch);
        Self::bump_persistent(&env, &epoch_key);
        PrivateOrderAccepted {
            market,
            epoch: epoch_number,
            sequence,
            accepted_count: epoch.accepted_count,
            accepted_root: new_accepted_root,
        }
        .publish(&env);
        record
    }

    pub fn seal_epoch(env: Env, market: Address, epoch_number: u64) -> EpochState {
        let registration = Self::market_registration(&env, &market);
        if registration.current_epoch != epoch_number {
            panic_with_error!(&env, Error::InvalidEpoch);
        }
        let key = DataKey::Epoch(market.clone(), epoch_number);
        let mut epoch: EpochState = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidEpoch));
        if epoch.phase != EpochPhase::Collecting {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        if env.ledger().timestamp() < epoch.cutoff
            && epoch.accepted_count < registration.fixed_batch_size
        {
            panic_with_error!(&env, Error::TooEarly);
        }
        epoch.phase = EpochPhase::Sealed;
        env.storage().persistent().set(&key, &epoch);
        Self::bump_persistent(&env, &key);
        EpochSealed {
            market,
            epoch: epoch_number,
            accepted_count: epoch.accepted_count,
            accepted_root: epoch.accepted_root.clone(),
            refund_at: epoch.refund_at,
        }
        .publish(&env);
        epoch
    }

    pub fn make_epoch_refundable(env: Env, market: Address, epoch_number: u64) -> EpochState {
        let key = DataKey::Epoch(market.clone(), epoch_number);
        let mut epoch: EpochState = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidEpoch));
        if epoch.phase == EpochPhase::Collecting && env.ledger().timestamp() >= epoch.cutoff {
            epoch.phase = EpochPhase::Sealed;
        }
        if epoch.phase != EpochPhase::Sealed {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        if env.ledger().timestamp() < epoch.refund_at {
            panic_with_error!(&env, Error::TooEarly);
        }
        epoch.phase = EpochPhase::Refundable;
        env.storage().persistent().set(&key, &epoch);
        Self::bump_persistent(&env, &key);
        EpochRefundable {
            market,
            epoch: epoch_number,
            accepted_count: epoch.accepted_count,
        }
        .publish(&env);
        epoch
    }

    pub fn submit_batch(
        env: Env,
        market: Address,
        epoch_number: u64,
        submission: BatchSubmission,
    ) -> BatchRecord {
        let registration = Self::market_registration(&env, &market);
        if registration.current_epoch != epoch_number
            || submission.committee_epoch != registration.committee_epoch
            || submission.proof.is_empty()
            || submission.proof.len() > MAX_PROOF_LENGTH
            || !Self::valid_encrypted_order(&env, &submission.aggregate_ciphertext)
            || Self::is_zero_bytes(&submission.decryption_proof_hash)
            || Self::is_zero_bytes(&submission.committee_statement_hash)
            || !Self::canonical_nonzero_field(&env, &submission.allocation_root)
            || !Self::canonical_nonzero_field(&env, &submission.included_root)
        {
            panic_with_error!(&env, Error::InvalidBatch);
        }
        let epoch_key = DataKey::Epoch(market.clone(), epoch_number);
        let mut epoch: EpochState = env
            .storage()
            .persistent()
            .get(&epoch_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidEpoch));
        if epoch.phase != EpochPhase::Sealed {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        let sequence_count = epoch
            .last_sequence
            .checked_sub(epoch.first_sequence)
            .and_then(|distance| distance.checked_add(1))
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidBatch));
        if env.ledger().timestamp() >= epoch.refund_at
            || epoch.accepted_count != registration.fixed_batch_size
            || sequence_count != u64::from(epoch.accepted_count)
            || submission
                .yes_count
                .checked_add(submission.no_count)
                .is_none_or(|count| count != epoch.accepted_count)
            || submission.yes_count < registration.minimum_side_count
            || submission.no_count < registration.minimum_side_count
        {
            panic_with_error!(&env, Error::InvalidBatch);
        }
        let client = MarketClient::new(&env, &market);
        if client.state_version() != epoch.market_state_version || client.outcome().is_some() {
            panic_with_error!(&env, Error::StaleState);
        }
        let quote = client.quote_private_batch(
            &epoch.market_state_version,
            &submission.yes_count,
            &submission.no_count,
        );
        let statement = BatchProofStatement {
            network_domain: env
                .storage()
                .instance()
                .get(&DataKey::NetworkDomain)
                .unwrap(),
            vault: env.current_contract_address(),
            market: market.clone(),
            epoch: epoch_number,
            accepted_root: epoch.accepted_root.clone(),
            accepted_count: epoch.accepted_count,
            first_sequence: epoch.first_sequence,
            last_sequence: epoch.last_sequence,
            committee_epoch: epoch.committee_epoch,
            committee_config_hash: epoch.committee_config_hash.clone(),
            committee_public_key_x: epoch.committee_public_key_x.clone(),
            committee_public_key_y: epoch.committee_public_key_y.clone(),
            aggregate_ciphertext: Vec::from_array(
                &env,
                [
                    submission.aggregate_ciphertext.c1_x,
                    submission.aggregate_ciphertext.c1_y,
                    submission.aggregate_ciphertext.c2_x,
                    submission.aggregate_ciphertext.c2_y,
                ],
            ),
            decryption_proof_hash: submission.decryption_proof_hash,
            committee_statement_hash: submission.committee_statement_hash,
            allocation_root: submission.allocation_root.clone(),
            included_root: submission.included_root.clone(),
            lot_size: registration.lot_size,
            quote: quote.clone(),
        };
        let verifier: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        if !ProofVerifierClient::new(&env, &verifier).verify_batch(&statement, &submission.proof) {
            panic_with_error!(&env, Error::InvalidProof);
        }
        let reserve: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RoundingReserve)
            .unwrap_or(0);
        if reserve < quote.rounding_contribution {
            panic_with_error!(&env, Error::InsufficientRoundingReserve);
        }
        let prior_unallocated = client.unallocated_balance();
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &market,
            &quote.aggregate_market_charge,
        );
        let applied = client.apply_private_batch_received(
            &env.current_contract_address(),
            &epoch.market_state_version,
            &submission.yes_count,
            &submission.no_count,
            &prior_unallocated,
        );
        if applied != quote {
            panic_with_error!(&env, Error::InvalidBatch);
        }
        let user_market_charge = quote
            .aggregate_market_charge
            .checked_sub(quote.rounding_contribution)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        Self::decrease_liabilities(&env, user_market_charge);
        Self::decrease_instance_total(
            &env,
            DataKey::RoundingReserve,
            quote.rounding_contribution,
            Error::InsufficientRoundingReserve,
        );
        Self::increase_instance_total(
            &env,
            DataKey::RoundingReceivable,
            quote.rounding_contribution,
        );
        Self::increase_market_accounting(&env, &market, &quote, user_market_charge);

        let record = BatchRecord {
            market: market.clone(),
            epoch: epoch_number,
            accepted_root: epoch.accepted_root.clone(),
            allocation_root: submission.allocation_root.clone(),
            included_root: submission.included_root,
            quote: quote.clone(),
            user_market_charge,
            executed_at: env.ledger().timestamp(),
        };
        let batch_key = DataKey::Batch(market.clone(), epoch_number);
        env.storage().persistent().set(&batch_key, &record);
        Self::bump_persistent(&env, &batch_key);
        for sequence in epoch.first_sequence..=epoch.last_sequence {
            let order_key = DataKey::Order(market.clone(), sequence);
            let mut order: OrderRecord = env
                .storage()
                .persistent()
                .get(&order_key)
                .unwrap_or_else(|| panic_with_error!(&env, Error::OrderNotFound));
            if order.epoch != epoch_number || order.status != OrderStatus::Pending {
                panic_with_error!(&env, Error::InvalidOrder);
            }
            order.status = OrderStatus::Executed;
            env.storage().persistent().set(&order_key, &order);
            Self::bump_persistent(&env, &order_key);
        }
        epoch.phase = EpochPhase::Executed;
        epoch.allocation_root = Some(submission.allocation_root.clone());
        env.storage().persistent().set(&epoch_key, &epoch);
        Self::bump_persistent(&env, &epoch_key);
        EpochExecuted {
            market,
            epoch: epoch_number,
            accepted_count: epoch.accepted_count,
            allocation_root: submission.allocation_root,
            market_charge: quote.aggregate_market_charge,
            fee_escrow: quote.fee_escrow,
        }
        .publish(&env);
        Self::assert_backing(&env);
        record
    }

    pub fn open_next_epoch(env: Env, market: Address, prior_epoch: u64) -> EpochState {
        let registration_key = DataKey::Registration(market.clone());
        let mut registration = Self::market_registration(&env, &market);
        if registration.finalized
            || registration.current_epoch != prior_epoch
            || env.ledger().timestamp() >= registration.expiry
        {
            panic_with_error!(&env, Error::InvalidEpoch);
        }
        let prior_key = DataKey::Epoch(market.clone(), prior_epoch);
        let prior: EpochState = env
            .storage()
            .persistent()
            .get(&prior_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidEpoch));
        if prior.phase != EpochPhase::Executed && prior.phase != EpochPhase::Refundable {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        let next_number = prior_epoch
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        let market_version = MarketClient::new(&env, &market).state_version();
        let next = Self::new_epoch(&env, &registration, next_number, market_version);
        registration.current_epoch = next_number;
        env.storage()
            .persistent()
            .set(&registration_key, &registration);
        let next_key = DataKey::Epoch(market, next_number);
        env.storage().persistent().set(&next_key, &next);
        Self::bump_persistent(&env, &registration_key);
        Self::bump_persistent(&env, &next_key);
        next
    }

    pub fn refund_order(
        env: Env,
        market: Address,
        epoch_number: u64,
        action_id: BytesN<32>,
        action_expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_expiry(&env, action_expiry);
        let epoch = Self::epoch_state(&env, &market, epoch_number);
        if epoch.phase != EpochPhase::Refundable {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        let binding = RefundBinding {
            market: market.clone(),
            epoch: epoch_number,
            accepted_root: epoch.accepted_root,
        };
        let operation_binding = Self::refund_operation_binding(&env, &binding);
        Self::execute_transition(
            &env,
            ProofAction::Refund,
            action_id,
            None,
            0,
            Some(market),
            operation_binding,
            action_expiry,
            transition,
            1,
        );
        Self::assert_backing(&env);
    }

    pub fn recover_execution_change(
        env: Env,
        market: Address,
        epoch_number: u64,
        action_id: BytesN<32>,
        action_expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_expiry(&env, action_expiry);
        let epoch = Self::epoch_state(&env, &market, epoch_number);
        if epoch.phase != EpochPhase::Executed {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        let batch = Self::batch_record(&env, &market, epoch_number);
        let registration = Self::market_registration(&env, &market);
        let binding = AllocationBinding {
            market: market.clone(),
            epoch: epoch_number,
            allocation_root: batch.allocation_root,
            outcome: SettlementState::Pending,
            lot_size: registration.lot_size,
            quote: batch.quote,
        };
        let operation_binding = Self::allocation_operation_binding(&env, &binding);
        Self::execute_transition(
            &env,
            ProofAction::ExecutionChange,
            action_id,
            None,
            0,
            Some(market),
            operation_binding,
            action_expiry,
            transition,
            1,
        );
        Self::assert_backing(&env);
    }

    pub fn claim_position(
        env: Env,
        market: Address,
        epoch_number: u64,
        action_id: BytesN<32>,
        action_expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_expiry(&env, action_expiry);
        let epoch = Self::epoch_state(&env, &market, epoch_number);
        if epoch.phase != EpochPhase::Executed {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        let accounting = Self::market_accounting(&env, &market);
        let outcome = accounting.finalized_outcome;
        if outcome == SettlementState::Pending {
            panic_with_error!(&env, Error::TooEarly);
        }
        let batch = Self::batch_record(&env, &market, epoch_number);
        let registration = Self::market_registration(&env, &market);
        let binding = AllocationBinding {
            market: market.clone(),
            epoch: epoch_number,
            allocation_root: batch.allocation_root,
            outcome,
            lot_size: registration.lot_size,
            quote: batch.quote,
        };
        let operation_binding = Self::allocation_operation_binding(&env, &binding);
        let action = if outcome == SettlementState::Void {
            ProofAction::Refund
        } else {
            ProofAction::Claim
        };
        Self::execute_transition(
            &env,
            action,
            action_id,
            None,
            0,
            Some(market),
            operation_binding,
            action_expiry,
            transition,
            1,
        );
        Self::assert_backing(&env);
    }

    pub fn finalize_market(env: Env, market: Address) -> MarketAccounting {
        let registration_key = DataKey::Registration(market.clone());
        let mut registration = Self::market_registration(&env, &market);
        if registration.finalized {
            panic_with_error!(&env, Error::AlreadyFinalized);
        }
        let client = MarketClient::new(&env, &market);
        let outcome = client
            .outcome()
            .unwrap_or_else(|| panic_with_error!(&env, Error::TooEarly));
        let accounting_key = DataKey::MarketAccounting(market.clone());
        let mut accounting = Self::market_accounting(&env, &market);
        if accounting.finalized_outcome != SettlementState::Pending {
            panic_with_error!(&env, Error::AlreadyFinalized);
        }
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let current = env.current_contract_address();
        let mut payout_received = 0;
        let mut lp_fee = 0;
        let mut protocol_fee = 0;

        match outcome {
            MarketOutcome::Yes | MarketOutcome::No => {
                let before = token_client.balance(&current);
                client.redeem(&current, &MarketSide::Yes);
                client.redeem(&current, &MarketSide::No);
                let after = token_client.balance(&current);
                payout_received = after
                    .checked_sub(before)
                    .unwrap_or_else(|| panic_with_error!(&env, Error::TransferMismatch));
                Self::increase_liabilities(&env, payout_received);

                let fee_state = client.fee_state();
                if fee_state.escrow != accounting.fee_escrow
                    || fee_state.rounding_receivable != accounting.rounding_advanced
                    || fee_state.conditional_lp_fee != accounting.conditional_lp_fee
                    || fee_state.conditional_protocol_fee != accounting.conditional_protocol_fee
                    || fee_state.vested
                    || accounting
                        .rounding_advanced
                        .checked_add(accounting.conditional_lp_fee)
                        .and_then(|value| value.checked_add(accounting.conditional_protocol_fee))
                        != Some(accounting.fee_escrow)
                {
                    panic_with_error!(&env, Error::InvalidBatch);
                }
                lp_fee = accounting.conditional_lp_fee;
                protocol_fee = accounting.conditional_protocol_fee;
                let prior_unallocated = client.unallocated_balance();
                if lp_fee > 0 {
                    token_client.transfer(&current, &market, &lp_fee);
                }
                let vested = client.record_vested_fees(
                    &current,
                    &lp_fee,
                    &prior_unallocated,
                    &client.state_version(),
                );
                if !vested.vested {
                    panic_with_error!(&env, Error::InvalidBatch);
                }
                Self::decrease_liabilities(&env, accounting.fee_escrow);
                Self::decrease_instance_total(
                    &env,
                    DataKey::RoundingReceivable,
                    accounting.rounding_advanced,
                    Error::InvalidBatch,
                );
                Self::increase_instance_total(
                    &env,
                    DataKey::RoundingReserve,
                    accounting.rounding_advanced,
                );
                Self::increase_instance_total(&env, DataKey::ProtocolFees, protocol_fee);
                client.settle_liquidity();
            }
            MarketOutcome::Void => {
                Self::increase_liabilities(&env, accounting.user_market_charges);
                Self::decrease_instance_total(
                    &env,
                    DataKey::RoundingReceivable,
                    accounting.rounding_advanced,
                    Error::InvalidBatch,
                );
                Self::increase_instance_total(
                    &env,
                    DataKey::RoundingReserve,
                    accounting.rounding_advanced,
                );
            }
        }
        accounting.finalized_outcome = match outcome {
            MarketOutcome::Yes => SettlementState::Yes,
            MarketOutcome::No => SettlementState::No,
            MarketOutcome::Void => SettlementState::Void,
        };
        registration.finalized = true;
        env.storage().persistent().set(&accounting_key, &accounting);
        env.storage()
            .persistent()
            .set(&registration_key, &registration);
        Self::bump_persistent(&env, &accounting_key);
        Self::bump_persistent(&env, &registration_key);
        PrivateMarketFinalized {
            market,
            outcome,
            payout_received,
            lp_fee,
            protocol_fee,
        }
        .publish(&env);
        Self::assert_backing(&env);
        accounting
    }

    pub fn shield_protocol_fees(
        env: Env,
        amount: i128,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
    ) {
        Self::validate_amount(&env, amount);
        Self::validate_expiry(&env, expiry);
        let available: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolFees)
            .unwrap_or(0);
        if available < amount {
            panic_with_error!(&env, Error::InsufficientBacking);
        }
        let treasury_key: BytesN<32> = env.storage().instance().get(&DataKey::TreasuryKey).unwrap();
        Self::execute_transition(
            &env,
            ProofAction::Treasury,
            action_id,
            None,
            amount,
            None,
            Self::treasury_operation_binding(&env, &treasury_key),
            expiry,
            transition,
            0,
        );
        Self::decrease_instance_total(
            &env,
            DataKey::ProtocolFees,
            amount,
            Error::InsufficientBacking,
        );
        Self::increase_liabilities(&env, amount);
        Self::assert_backing(&env);
    }

    pub fn registration(env: Env, market: Address) -> Option<MarketRegistration> {
        let key = DataKey::Registration(market);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn epoch(env: Env, market: Address, epoch_number: u64) -> Option<EpochState> {
        let key = DataKey::Epoch(market, epoch_number);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn order(env: Env, market: Address, sequence: u64) -> Option<OrderRecord> {
        let key = DataKey::Order(market, sequence);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn batch(env: Env, market: Address, epoch_number: u64) -> Option<BatchRecord> {
        let key = DataKey::Batch(market, epoch_number);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn accounting(env: Env, market: Address) -> Option<MarketAccounting> {
        let key = DataKey::MarketAccounting(market);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn set_deposits_paused(env: Env, governance: Address, paused: bool) {
        let configured: Address = env.storage().instance().get(&DataKey::Governance).unwrap();
        if governance != configured {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        governance.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::DepositsPaused, &paused);
        Self::bump_instance(&env);
    }

    pub fn output(env: Env, index: u32) -> Option<OutputRecord> {
        let key = DataKey::Output(index);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn is_spent(env: Env, nullifier: U256) -> bool {
        let key = DataKey::Nullifier(nullifier);
        let spent = env.storage().persistent().has(&key);
        if spent {
            Self::bump_persistent(&env, &key);
        }
        spent
    }

    pub fn is_known_root(env: Env, root: U256) -> bool {
        Self::known_root(&env, &root)
    }

    pub fn unallocated_balance(env: Env) -> i128 {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let balance = token::Client::new(&env, &token).balance(&env.current_contract_address());
        balance
            .checked_sub(Self::accounted_balance(&env))
            .unwrap_or(0)
    }

    pub fn keep_alive(env: Env, nullifiers: Vec<U256>, output_indexes: Vec<u32>) {
        if nullifiers.len() > MAX_KEEP_ALIVE_ITEMS || output_indexes.len() > MAX_KEEP_ALIVE_ITEMS {
            panic_with_error!(&env, Error::TooManyItems);
        }
        for nullifier in nullifiers.iter() {
            let key = DataKey::Nullifier(nullifier);
            if env.storage().persistent().has(&key) {
                Self::bump_persistent(&env, &key);
            }
        }
        for index in output_indexes.iter() {
            let key = DataKey::Output(index);
            if env.storage().persistent().has(&key) {
                Self::bump_persistent(&env, &key);
            }
        }
        Self::bump_instance(&env);
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_transition(
        env: &Env,
        action: ProofAction,
        action_id: BytesN<32>,
        public_account: Option<Address>,
        public_amount: i128,
        market: Option<Address>,
        binding: OperationBinding,
        expiry: u64,
        transition: PrivateTransition,
        expected_nullifiers: u32,
    ) {
        Self::bump_instance(env);
        if Self::is_zero_bytes(&action_id) {
            panic_with_error!(env, Error::InvalidProofStatement);
        }
        let action_key = DataKey::Action(action_id.clone());
        if env.storage().persistent().has(&action_key) {
            panic_with_error!(env, Error::DuplicateAction);
        }
        if transition.proof.is_empty() || transition.proof.len() > MAX_PROOF_LENGTH {
            panic_with_error!(env, Error::InvalidProof);
        }
        let output_count = if action == ProofAction::ExitMatch {
            4
        } else {
            2
        };
        if transition.input_nullifiers.len() != expected_nullifiers
            || transition.output_commitments.len() != output_count
            || transition.encrypted_outputs.len() != output_count
        {
            panic_with_error!(env, Error::InvalidProofStatement);
        }

        let info = Self::info(env.clone());
        if transition.append_root != info.current_root {
            panic_with_error!(env, Error::RootMismatch);
        }
        if !Self::known_root(env, &transition.membership_root) {
            panic_with_error!(env, Error::UnknownRoot);
        }
        if transition.new_root == transition.append_root
            || !Self::canonical_nonzero_field(env, &transition.new_root)
            || Self::known_root(env, &transition.new_root)
        {
            panic_with_error!(env, Error::DuplicateRoot);
        }
        let capacity = 1u32
            .checked_shl(info.levels)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        let next_leaf_index = info.next_leaf_index;
        if next_leaf_index
            .checked_add(output_count)
            .is_none_or(|next| next > capacity)
        {
            panic_with_error!(env, Error::TreeFull);
        }

        for i in 0..transition.input_nullifiers.len() {
            let nullifier = transition.input_nullifiers.get(i).unwrap();
            if !Self::canonical_nonzero_field(env, &nullifier) {
                panic_with_error!(env, Error::InvalidProofStatement);
            }
            for prior in 0..i {
                if transition.input_nullifiers.get(prior).unwrap() == nullifier {
                    panic_with_error!(env, Error::DuplicateNullifier);
                }
            }
            if env
                .storage()
                .persistent()
                .has(&DataKey::Nullifier(nullifier))
            {
                panic_with_error!(env, Error::SpentNullifier);
            }
        }

        for i in 0..output_count {
            let commitment = transition.output_commitments.get(i).unwrap();
            let encrypted = transition.encrypted_outputs.get(i).unwrap();
            if !Self::canonical_nonzero_field(env, &commitment) {
                panic_with_error!(env, Error::InvalidProofStatement);
            }
            if encrypted.len() != info.output_envelope_length {
                panic_with_error!(env, Error::InvalidEnvelope);
            }
            output_envelope_hash(env, &encrypted)
                .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidEnvelope));
            if env
                .storage()
                .persistent()
                .has(&DataKey::Commitment(commitment.clone()))
            {
                panic_with_error!(env, Error::DuplicateCommitment);
            }
            for prior in 0..i {
                if transition.output_commitments.get(prior).unwrap() == commitment {
                    panic_with_error!(env, Error::DuplicateCommitment);
                }
            }
        }

        let digest = Self::context_digest(
            env.clone(),
            action,
            action_id.clone(),
            public_account,
            public_amount,
            market,
            binding,
            expiry,
        );
        let mut output_envelope_hashes = Vec::new(env);
        for encrypted in transition.encrypted_outputs.iter() {
            output_envelope_hashes.push_back(
                output_envelope_hash(env, &encrypted)
                    .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidEnvelope)),
            );
        }
        let statement = ProofStatement {
            action,
            context_digest: digest,
            membership_root: transition.membership_root.clone(),
            append_root: transition.append_root.clone(),
            new_root: transition.new_root.clone(),
            input_nullifiers: transition.input_nullifiers.clone(),
            output_commitments: transition.output_commitments.clone(),
            output_envelope_hashes,
            first_leaf_index: next_leaf_index,
            public_amount,
        };
        let verifier: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        if !ProofVerifierClient::new(env, &verifier).verify(&statement, &transition.proof) {
            panic_with_error!(env, Error::InvalidProof);
        }

        for nullifier in transition.input_nullifiers.iter() {
            let key = DataKey::Nullifier(nullifier.clone());
            env.storage().persistent().set(&key, &true);
            Self::bump_persistent(env, &key);
            NullifierSpent {
                nullifier,
                action_id: action_id.clone(),
            }
            .publish(env);
        }

        for i in 0..output_count {
            let index = next_leaf_index
                .checked_add(i)
                .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
            let commitment = transition.output_commitments.get(i).unwrap();
            let output = OutputRecord {
                commitment: commitment.clone(),
                leaf_index: index,
                root: transition.new_root.clone(),
                action_id: action_id.clone(),
                encrypted_output: transition.encrypted_outputs.get(i).unwrap(),
            };
            let commitment_key = DataKey::Commitment(commitment.clone());
            let output_key = DataKey::Output(index);
            env.storage().persistent().set(&commitment_key, &index);
            env.storage().persistent().set(&output_key, &output);
            Self::bump_persistent(env, &commitment_key);
            Self::bump_persistent(env, &output_key);
            ShieldedOutput {
                commitment,
                leaf_index: index,
                root: transition.new_root.clone(),
                action_id: action_id.clone(),
                encrypted_output: output.encrypted_output,
            }
            .publish(env);
        }

        let next = next_leaf_index
            .checked_add(output_count)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        env.storage().instance().set(&DataKey::NextLeafIndex, &next);
        env.storage()
            .instance()
            .set(&DataKey::CurrentRoot, &transition.new_root);
        let next_slot = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::CurrentRootSlot)
            .unwrap_or(0)
            .checked_add(1)
            .map(|slot| slot % info.root_history_size)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        env.storage()
            .instance()
            .set(&DataKey::CurrentRootSlot, &next_slot);
        Self::store_root(env, next_slot, &transition.new_root);
        env.storage().persistent().set(&action_key, &action);
        Self::bump_persistent(env, &action_key);
        VaultTransition {
            action_id,
            action,
            first_leaf_index: next_leaf_index,
            new_root: transition.new_root,
        }
        .publish(env);
    }

    fn known_root(env: &Env, root: &U256) -> bool {
        let instance = env.storage().instance();
        let history: u32 = instance.get(&DataKey::RootHistorySize).unwrap();
        let max_age: u32 = instance.get(&DataKey::MaxRootAge).unwrap();
        let now = env.ledger().sequence();
        let current: U256 = instance.get(&DataKey::CurrentRoot).unwrap();
        for slot in 0..history {
            let key = DataKey::Root(slot);
            if let Some(record) = env.storage().persistent().get::<_, RootRecord>(&key) {
                if &record.root == root {
                    if current != *root && now.saturating_sub(record.ledger) > max_age {
                        panic_with_error!(env, Error::StaleRoot);
                    }
                    Self::bump_persistent(env, &key);
                    return true;
                }
            }
        }
        false
    }

    fn store_root(env: &Env, slot: u32, root: &U256) {
        let key = DataKey::Root(slot);
        let record = RootRecord {
            root: root.clone(),
            ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&key, &record);
        Self::bump_persistent(env, &key);
    }

    fn market_registration(env: &Env, market: &Address) -> MarketRegistration {
        let key = DataKey::Registration(market.clone());
        let registration = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(env, Error::MarketNotRegistered));
        Self::bump_persistent(env, &key);
        registration
    }

    fn epoch_state(env: &Env, market: &Address, epoch: u64) -> EpochState {
        let key = DataKey::Epoch(market.clone(), epoch);
        let state = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(env, Error::InvalidEpoch));
        Self::bump_persistent(env, &key);
        state
    }

    fn batch_record(env: &Env, market: &Address, epoch: u64) -> BatchRecord {
        let key = DataKey::Batch(market.clone(), epoch);
        let record = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(env, Error::InvalidBatch));
        Self::bump_persistent(env, &key);
        record
    }

    fn market_accounting(env: &Env, market: &Address) -> MarketAccounting {
        let key = DataKey::MarketAccounting(market.clone());
        let accounting = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(env, Error::MarketNotRegistered));
        Self::bump_persistent(env, &key);
        accounting
    }

    fn new_epoch(
        env: &Env,
        registration: &MarketRegistration,
        epoch: u64,
        market_state_version: u64,
    ) -> EpochState {
        let now = env.ledger().timestamp();
        let cutoff = now
            .checked_add(registration.epoch_duration)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
            .min(registration.expiry);
        let refund_at = cutoff
            .checked_add(registration.refund_delay)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        if cutoff <= now || refund_at > registration.finalize_after {
            panic_with_error!(env, Error::InvalidEpoch);
        }
        EpochState {
            market: registration.market.clone(),
            epoch,
            phase: EpochPhase::Collecting,
            market_state_version,
            accepted_root: empty_merkle_root(env, ACCEPTED_TREE_LEVELS),
            accepted_count: 0,
            first_sequence: 0,
            last_sequence: 0,
            opened_at: now,
            cutoff,
            refund_at,
            committee_epoch: registration.committee_epoch,
            committee_config_hash: registration.committee_config_hash.clone(),
            committee_public_key_x: registration.committee_public_key_x.clone(),
            committee_public_key_y: registration.committee_public_key_y.clone(),
            allocation_root: None,
        }
    }

    fn accepted_leaf_hash(env: &Env, leaf: &AcceptedLeaf) -> U256 {
        let (market_high, market_low) = address_limbs(env, &leaf.market);
        let (action_high, action_low) = bytes32_limbs(env, &leaf.action_id);
        let fields = Vec::from_array(
            env,
            [
                market_high,
                market_low,
                U256::from_u128(env, leaf.epoch as u128),
                U256::from_u128(env, leaf.sequence as u128),
                action_high,
                action_low,
                leaf.position_commitment.clone(),
                leaf.encrypted_order.c1_x.clone(),
                leaf.encrypted_order.c1_y.clone(),
                leaf.encrypted_order.c2_x.clone(),
                leaf.encrypted_order.c2_y.clone(),
                U256::from_u128(env, leaf.committee_epoch as u128),
            ],
        );
        tagged_poseidon2_hash(env, ACCEPTED_LEAF_HASH_TAG, &fields)
            .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidOrder))
    }

    fn build_order_binding(
        env: &Env,
        registration: &MarketRegistration,
        epoch: &EpochState,
        market: Address,
        action_id: BytesN<32>,
        position_commitment: U256,
        encrypted_order: EncryptedOrder,
    ) -> OrderBinding {
        let sequence = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::MarketSequence(market.clone()))
            .unwrap_or(0)
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        let leaf = AcceptedLeaf {
            market: market.clone(),
            epoch: epoch.epoch,
            sequence,
            action_id,
            position_commitment: position_commitment.clone(),
            encrypted_order: encrypted_order.clone(),
            committee_epoch: epoch.committee_epoch,
        };
        let new_accepted_root = Self::calculate_accepted_root(
            env,
            &market,
            epoch.epoch,
            epoch.accepted_count,
            Self::accepted_leaf_hash(env, &leaf),
        );
        OrderBinding {
            market,
            epoch: epoch.epoch,
            market_state_version: epoch.market_state_version,
            position_commitment,
            lot_size: registration.lot_size,
            fee_bps: registration.fee_bps,
            fixed_batch_size: registration.fixed_batch_size,
            minimum_side_count: registration.minimum_side_count,
            maximum_price_movement: registration.maximum_price_movement,
            rules_hash: registration.rules_hash.clone(),
            refund_at: epoch.refund_at,
            committee_epoch: epoch.committee_epoch,
            committee_config_hash: epoch.committee_config_hash.clone(),
            committee_public_key_x: epoch.committee_public_key_x.clone(),
            committee_public_key_y: epoch.committee_public_key_y.clone(),
            encrypted_order,
            old_accepted_root: epoch.accepted_root.clone(),
            new_accepted_root,
            accepted_leaf_index: epoch.accepted_count,
            sequence,
        }
    }

    fn calculate_accepted_root(
        env: &Env,
        market: &Address,
        epoch: u64,
        leaf_index: u32,
        leaf: U256,
    ) -> U256 {
        if leaf_index >= 1u32 << ACCEPTED_TREE_LEVELS {
            panic_with_error!(env, Error::EpochFull);
        }
        let mut node = leaf;
        let mut index = leaf_index;
        let mut zero = U256::from_u32(env, 0);
        for level in 0..ACCEPTED_TREE_LEVELS {
            if index & 1 == 0 {
                node = merkle_node(env, &node, &zero)
                    .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidOrder));
            } else {
                let key = DataKey::AcceptedFrontier(market.clone(), epoch, level);
                let left: U256 = env
                    .storage()
                    .persistent()
                    .get(&key)
                    .unwrap_or_else(|| panic_with_error!(env, Error::InvalidOrder));
                node = merkle_node(env, &left, &node)
                    .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidOrder));
            }
            zero = merkle_node(env, &zero, &zero)
                .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidOrder));
            index >>= 1;
        }
        node
    }

    fn store_accepted_frontier(
        env: &Env,
        market: &Address,
        epoch: u64,
        leaf_index: u32,
        leaf: U256,
    ) {
        let mut node = leaf;
        let mut index = leaf_index;
        let mut zero = U256::from_u32(env, 0);
        for level in 0..ACCEPTED_TREE_LEVELS {
            if index & 1 == 0 {
                let key = DataKey::AcceptedFrontier(market.clone(), epoch, level);
                env.storage().persistent().set(&key, &node);
                Self::bump_persistent(env, &key);
                node = merkle_node(env, &node, &zero)
                    .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidOrder));
            } else {
                let key = DataKey::AcceptedFrontier(market.clone(), epoch, level);
                let left: U256 = env
                    .storage()
                    .persistent()
                    .get(&key)
                    .unwrap_or_else(|| panic_with_error!(env, Error::InvalidOrder));
                node = merkle_node(env, &left, &node)
                    .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidOrder));
            }
            zero = merkle_node(env, &zero, &zero)
                .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidOrder));
            index >>= 1;
        }
    }

    fn increase_market_accounting(
        env: &Env,
        market: &Address,
        quote: &BatchQuote,
        user_market_charge: i128,
    ) {
        let key = DataKey::MarketAccounting(market.clone());
        let mut accounting = Self::market_accounting(env, market);
        if accounting.finalized_outcome != SettlementState::Pending {
            panic_with_error!(env, Error::AlreadyFinalized);
        }
        accounting.user_market_charges = accounting
            .user_market_charges
            .checked_add(user_market_charge)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        accounting.rounding_advanced = accounting
            .rounding_advanced
            .checked_add(quote.rounding_contribution)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        accounting.fee_escrow = accounting
            .fee_escrow
            .checked_add(quote.fee_escrow)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        accounting.conditional_lp_fee = accounting
            .conditional_lp_fee
            .checked_add(quote.conditional_lp_fee)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        accounting.conditional_protocol_fee = accounting
            .conditional_protocol_fee
            .checked_add(quote.conditional_protocol_fee)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        env.storage().persistent().set(&key, &accounting);
        Self::bump_persistent(env, &key);
    }

    fn increase_instance_total(env: &Env, key: DataKey, amount: i128) {
        if amount < 0 {
            panic_with_error!(env, Error::Arithmetic);
        }
        let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
        let updated = current
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        env.storage().instance().set(&key, &updated);
    }

    fn decrease_instance_total(env: &Env, key: DataKey, amount: i128, error: Error) {
        if amount < 0 {
            panic_with_error!(env, Error::Arithmetic);
        }
        let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
        let updated = current
            .checked_sub(amount)
            .filter(|value| *value >= 0)
            .unwrap_or_else(|| panic_with_error!(env, error));
        env.storage().instance().set(&key, &updated);
    }

    #[allow(clippy::too_many_arguments)]
    fn receive_liquidity(
        env: &Env,
        action: ProofAction,
        liquidity_vault: Address,
        shares: i128,
        expected_assets: i128,
        remaining_share_commitment: BytesN<32>,
        expected_version: u64,
        action_id: BytesN<32>,
        expiry: u64,
        transition: PrivateTransition,
        terminal: bool,
    ) -> i128 {
        Self::validate_amount(env, shares);
        Self::validate_amount(env, expected_assets);
        Self::validate_expiry(env, expiry);
        let remaining_field =
            U256::from_be_bytes(env, &Bytes::from(remaining_share_commitment.clone()));
        if !Self::canonical_nonzero_field(env, &remaining_field)
            || transition.output_commitments.len() != 2
            || transition.output_commitments.get(1) != Some(remaining_field)
        {
            panic_with_error!(env, Error::InvalidProofStatement);
        }
        let binding = LiquidityBinding {
            liquidity_vault: liquidity_vault.clone(),
            share_commitment: remaining_share_commitment,
            shares,
            expected_assets,
            expected_version,
        };
        let operation_binding = Self::liquidity_operation_binding(env, &binding);
        Self::execute_transition(
            env,
            action,
            action_id,
            None,
            expected_assets,
            Some(liquidity_vault.clone()),
            operation_binding,
            expiry,
            transition,
            2,
        );

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let current = env.current_contract_address();
        let token_client = token::Client::new(env, &token);
        let before = token_client.balance(&current);
        let client = LiquidityVaultClient::new(env, &liquidity_vault);
        let received = if terminal {
            client.redeem_terminal(&current, &shares, &expected_version)
        } else {
            client.unfund(&current, &shares, &expected_version)
        };
        let after = token_client.balance(&current);
        if received != expected_assets || after.checked_sub(before) != Some(expected_assets) {
            panic_with_error!(env, Error::TransferMismatch);
        }
        Self::increase_liabilities(env, expected_assets);
        Self::assert_backing(env);
        received
    }

    fn canonical_nonzero_field(env: &Env, value: &U256) -> bool {
        value != &U256::from_u32(env, 0) && Self::canonical_field(env, value)
    }

    fn canonical_field(env: &Env, value: &U256) -> bool {
        let modulus = U256::from_be_bytes(env, &Bytes::from_array(env, &BN254_SCALAR_MODULUS));
        value < &modulus
    }

    fn valid_encrypted_order(env: &Env, order: &EncryptedOrder) -> bool {
        is_valid_babyjub_encryption_point(env, &order.c1_x, &order.c1_y)
            && is_valid_babyjub_encryption_point(env, &order.c2_x, &order.c2_y)
    }

    fn is_zero_bytes(value: &BytesN<32>) -> bool {
        value.to_array().iter().all(|byte| *byte == 0)
    }

    fn validate_amount(env: &Env, amount: i128) {
        if amount <= 0 || amount > MAX_AMOUNT {
            panic_with_error!(env, Error::InvalidAmount);
        }
    }

    fn validate_nonnegative_amount(env: &Env, amount: i128) {
        if amount < 0 || amount > MAX_AMOUNT {
            panic_with_error!(env, Error::InvalidAmount);
        }
    }

    fn validate_expiry(env: &Env, expiry: u64) {
        let now = env.ledger().timestamp();
        if expiry < now || expiry > now.saturating_add(MAX_ACTION_LIFETIME) {
            panic_with_error!(env, Error::InvalidExpiry);
        }
    }

    fn linked_liquidity_market(
        env: &Env,
        market: &Address,
        liquidity_vault: &Address,
    ) -> MarketRegistration {
        let registration = Self::market_registration(env, market);
        let private = MarketClient::new(env, market)
            .private_config()
            .unwrap_or_else(|| panic_with_error!(env, Error::InvalidExit));
        if private.liquidity_vault != *liquidity_vault {
            panic_with_error!(env, Error::InvalidExit);
        }
        registration
    }

    fn active_exit_market(
        env: &Env,
        market: &Address,
        liquidity_vault: &Address,
    ) -> MarketRegistration {
        let registration = Self::linked_liquidity_market(env, market, liquidity_vault);
        if registration.finalized
            || env.ledger().timestamp() >= registration.expiry
            || MarketClient::new(env, market).outcome().is_some()
        {
            panic_with_error!(env, Error::InvalidExit);
        }
        registration
    }

    fn minimum_exit_payment(
        env: &Env,
        minimum_remaining: i128,
        shares: i128,
        shares_remaining: i128,
    ) -> i128 {
        if minimum_remaining < 0
            || shares <= 0
            || shares_remaining <= 0
            || shares > shares_remaining
        {
            panic_with_error!(env, Error::InvalidExit);
        }
        if shares == shares_remaining {
            return minimum_remaining;
        }
        minimum_remaining
            .checked_mul(shares)
            .and_then(|value| value.checked_add(shares_remaining - 1))
            .and_then(|value| value.checked_div(shares_remaining))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
    }

    fn increase_liabilities(env: &Env, amount: i128) {
        let liabilities: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Liabilities)
            .unwrap_or(0);
        let updated = liabilities
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        env.storage()
            .instance()
            .set(&DataKey::Liabilities, &updated);
    }

    fn decrease_liabilities(env: &Env, amount: i128) {
        let liabilities: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Liabilities)
            .unwrap_or(0);
        let updated = liabilities
            .checked_sub(amount)
            .filter(|value| *value >= 0)
            .unwrap_or_else(|| panic_with_error!(env, Error::InsufficientBacking));
        env.storage()
            .instance()
            .set(&DataKey::Liabilities, &updated);
    }

    fn empty_binding(env: &Env) -> OperationBinding {
        empty_operation_binding(env)
    }

    fn liquidity_operation_binding(env: &Env, binding: &LiquidityBinding) -> OperationBinding {
        let mut fields = zero_fields(env);
        let (vault_high, vault_low) = address_limbs(env, &binding.liquidity_vault);
        Self::set_operation_field(env, &mut fields, 0, vault_high);
        Self::set_operation_field(env, &mut fields, 1, vault_low);
        Self::set_operation_field(
            env,
            &mut fields,
            2,
            U256::from_be_bytes(env, &Bytes::from(binding.share_commitment.clone())),
        );
        Self::set_operation_field(env, &mut fields, 3, Self::binding_i128(env, binding.shares));
        Self::set_operation_field(
            env,
            &mut fields,
            4,
            Self::binding_i128(env, binding.expected_assets),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            5,
            U256::from_u128(env, binding.expected_version as u128),
        );
        OperationBinding {
            kind: BindingKind::Liquidity,
            fields,
        }
    }

    fn exit_request_operation_binding(env: &Env, binding: &ExitRequestBinding) -> OperationBinding {
        let mut fields = zero_fields(env);
        let (vault_high, vault_low) = address_limbs(env, &binding.liquidity_vault);
        let (exit_high, exit_low) = bytes32_limbs(env, &binding.exit_id);
        let (destination_high, destination_low) = bytes32_limbs(env, &binding.destination);
        Self::set_operation_field(env, &mut fields, 0, vault_high);
        Self::set_operation_field(env, &mut fields, 1, vault_low);
        Self::set_operation_field(env, &mut fields, 2, exit_high);
        Self::set_operation_field(env, &mut fields, 3, exit_low);
        Self::set_operation_field(env, &mut fields, 4, Self::binding_i128(env, binding.shares));
        Self::set_operation_field(
            env,
            &mut fields,
            5,
            Self::binding_i128(env, binding.minimum_payment),
        );
        Self::set_operation_field(env, &mut fields, 6, destination_high);
        Self::set_operation_field(env, &mut fields, 7, destination_low);
        Self::set_operation_field(
            env,
            &mut fields,
            8,
            U256::from_u128(env, binding.exit_expiry as u128),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            9,
            U256::from_u128(env, binding.expected_version as u128),
        );
        OperationBinding {
            kind: BindingKind::ExitRequest,
            fields,
        }
    }

    fn exit_cancel_operation_binding(env: &Env, binding: &ExitCancelBinding) -> OperationBinding {
        let mut fields = zero_fields(env);
        let (vault_high, vault_low) = address_limbs(env, &binding.liquidity_vault);
        let (exit_high, exit_low) = bytes32_limbs(env, &binding.exit_id);
        let (destination_high, destination_low) = bytes32_limbs(env, &binding.destination);
        Self::set_operation_field(env, &mut fields, 0, vault_high);
        Self::set_operation_field(env, &mut fields, 1, vault_low);
        Self::set_operation_field(env, &mut fields, 2, exit_high);
        Self::set_operation_field(env, &mut fields, 3, exit_low);
        Self::set_operation_field(
            env,
            &mut fields,
            4,
            Self::binding_i128(env, binding.shares_remaining),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            5,
            Self::binding_i128(env, binding.minimum_payment_remaining),
        );
        Self::set_operation_field(env, &mut fields, 6, destination_high);
        Self::set_operation_field(env, &mut fields, 7, destination_low);
        Self::set_operation_field(
            env,
            &mut fields,
            8,
            U256::from_u128(env, binding.exit_expiry as u128),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            9,
            U256::from_u128(env, binding.expected_version as u128),
        );
        OperationBinding {
            kind: BindingKind::ExitCancel,
            fields,
        }
    }

    fn exit_match_operation_binding(env: &Env, binding: &ExitMatchBinding) -> OperationBinding {
        let mut fields = zero_fields(env);
        let (vault_high, vault_low) = address_limbs(env, &binding.liquidity_vault);
        let (exit_high, exit_low) = bytes32_limbs(env, &binding.exit_id);
        let (destination_high, destination_low) = bytes32_limbs(env, &binding.destination);
        let (remaining_high, remaining_low) = bytes32_limbs(env, &binding.remaining_destination);
        let values = [
            vault_high,
            vault_low,
            exit_high,
            exit_low,
            Self::binding_i128(env, binding.shares),
            Self::binding_i128(env, binding.payment),
            Self::binding_i128(env, binding.shares_remaining),
            Self::binding_i128(env, binding.minimum_payment_remaining),
            destination_high,
            destination_low,
            U256::from_u128(env, binding.exit_expiry as u128),
            U256::from_u128(env, binding.market_state_version as u128),
            Self::binding_i128(env, binding.equity_if_yes),
            Self::binding_i128(env, binding.equity_if_no),
            Self::binding_i128(env, binding.conditional_lp_fees),
            U256::from_u128(env, binding.state_updated_at as u128),
            U256::from_u128(env, binding.maximum_state_age as u128),
            U256::from_u128(env, binding.expected_version as u128),
            Self::binding_i128(env, binding.minimum_for_fill),
            Self::binding_i128(env, binding.next_minimum_payment),
            remaining_high,
            remaining_low,
            Self::binding_i128(env, binding.remaining_shares),
            U256::from_u128(env, binding.market_expiry as u128),
        ];
        for (index, value) in values.iter().enumerate() {
            Self::set_operation_field(env, &mut fields, index as u32, value.clone());
        }
        OperationBinding {
            kind: BindingKind::ExitMatch,
            fields,
        }
    }

    fn order_operation_binding(env: &Env, binding: &OrderBinding) -> OperationBinding {
        let mut fields = zero_fields(env);
        Self::set_operation_field(
            env,
            &mut fields,
            0,
            U256::from_u128(env, binding.epoch as u128),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            1,
            U256::from_u128(env, binding.market_state_version as u128),
        );
        Self::set_operation_field(env, &mut fields, 2, binding.position_commitment.clone());
        Self::set_operation_field(
            env,
            &mut fields,
            3,
            Self::binding_i128(env, binding.lot_size),
        );
        Self::set_operation_field(env, &mut fields, 4, U256::from_u32(env, binding.fee_bps));
        Self::set_operation_field(
            env,
            &mut fields,
            5,
            U256::from_u32(env, binding.fixed_batch_size),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            6,
            U256::from_u32(env, binding.minimum_side_count),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            7,
            Self::binding_i128(env, binding.maximum_price_movement),
        );
        let (rules_high, rules_low) = bytes32_limbs(env, &binding.rules_hash);
        Self::set_operation_field(env, &mut fields, 8, rules_high);
        Self::set_operation_field(env, &mut fields, 9, rules_low);
        Self::set_operation_field(
            env,
            &mut fields,
            10,
            U256::from_u128(env, binding.refund_at as u128),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            11,
            U256::from_u128(env, binding.committee_epoch as u128),
        );
        let (committee_high, committee_low) = bytes32_limbs(env, &binding.committee_config_hash);
        Self::set_operation_field(env, &mut fields, 12, committee_high);
        Self::set_operation_field(env, &mut fields, 13, committee_low);
        Self::set_operation_field(env, &mut fields, 14, binding.committee_public_key_x.clone());
        Self::set_operation_field(env, &mut fields, 15, binding.committee_public_key_y.clone());
        Self::set_operation_field(env, &mut fields, 16, binding.encrypted_order.c1_x.clone());
        Self::set_operation_field(env, &mut fields, 17, binding.encrypted_order.c1_y.clone());
        Self::set_operation_field(env, &mut fields, 18, binding.encrypted_order.c2_x.clone());
        Self::set_operation_field(env, &mut fields, 19, binding.encrypted_order.c2_y.clone());
        Self::set_operation_field(env, &mut fields, 20, binding.old_accepted_root.clone());
        Self::set_operation_field(env, &mut fields, 21, binding.new_accepted_root.clone());
        Self::set_operation_field(
            env,
            &mut fields,
            22,
            U256::from_u32(env, binding.accepted_leaf_index),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            23,
            U256::from_u128(env, binding.sequence as u128),
        );
        OperationBinding {
            kind: BindingKind::Order,
            fields,
        }
    }

    fn refund_operation_binding(env: &Env, binding: &RefundBinding) -> OperationBinding {
        let mut fields = zero_fields(env);
        Self::set_operation_field(
            env,
            &mut fields,
            0,
            U256::from_u128(env, binding.epoch as u128),
        );
        Self::set_operation_field(env, &mut fields, 1, binding.accepted_root.clone());
        OperationBinding {
            kind: BindingKind::Refund,
            fields,
        }
    }

    fn allocation_operation_binding(env: &Env, binding: &AllocationBinding) -> OperationBinding {
        let mut fields = zero_fields(env);
        Self::set_operation_field(
            env,
            &mut fields,
            0,
            U256::from_u128(env, binding.epoch as u128),
        );
        Self::set_operation_field(env, &mut fields, 1, binding.allocation_root.clone());
        let outcome = match binding.outcome {
            SettlementState::Pending => 0,
            SettlementState::Yes => 1,
            SettlementState::No => 2,
            SettlementState::Void => 3,
        };
        Self::set_operation_field(env, &mut fields, 2, U256::from_u32(env, outcome));
        let quote = &binding.quote;
        Self::set_operation_field(
            env,
            &mut fields,
            3,
            U256::from_u128(env, quote.state_version as u128),
        );
        Self::set_operation_field(env, &mut fields, 4, U256::from_u32(env, quote.batch_size));
        Self::set_operation_field(env, &mut fields, 5, U256::from_u32(env, quote.yes_count));
        Self::set_operation_field(env, &mut fields, 6, U256::from_u32(env, quote.no_count));
        Self::set_operation_field(
            env,
            &mut fields,
            7,
            Self::binding_i128(env, quote.pre_yes_price),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            8,
            Self::binding_i128(env, quote.post_yes_price),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            9,
            Self::binding_i128(env, quote.yes_price),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            10,
            Self::binding_i128(env, quote.no_price),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            11,
            Self::binding_i128(env, quote.aggregate_market_charge),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            12,
            Self::binding_i128(env, quote.yes_market_cost),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            13,
            Self::binding_i128(env, quote.no_market_cost),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            14,
            Self::binding_i128(env, quote.yes_charge_per_position),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            15,
            Self::binding_i128(env, quote.no_charge_per_position),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            16,
            Self::binding_i128(env, quote.rounding_contribution),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            17,
            Self::binding_i128(env, quote.fee_per_position),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            18,
            Self::binding_i128(env, quote.fee_escrow),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            19,
            Self::binding_i128(env, quote.conditional_lp_fee),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            20,
            Self::binding_i128(env, quote.conditional_protocol_fee),
        );
        Self::set_operation_field(
            env,
            &mut fields,
            21,
            Self::binding_i128(env, binding.lot_size),
        );
        OperationBinding {
            kind: BindingKind::Allocation,
            fields,
        }
    }

    fn treasury_operation_binding(env: &Env, treasury_key: &BytesN<32>) -> OperationBinding {
        let mut fields = zero_fields(env);
        let (high, low) = bytes32_limbs(env, treasury_key);
        Self::set_operation_field(env, &mut fields, 0, high);
        Self::set_operation_field(env, &mut fields, 1, low);
        OperationBinding {
            kind: BindingKind::Treasury,
            fields,
        }
    }

    fn set_operation_field(env: &Env, fields: &mut Vec<U256>, index: u32, value: U256) {
        set_binding_field(fields, index, value)
            .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidProofStatement));
    }

    fn binding_i128(env: &Env, value: i128) -> U256 {
        if value < 0 {
            panic_with_error!(env, Error::InvalidProofStatement);
        }
        U256::from_u128(env, value as u128)
    }

    fn assert_backing(env: &Env) {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let balance = token::Client::new(env, &token).balance(&env.current_contract_address());
        let accounted = Self::accounted_balance(env);
        if balance < accounted {
            panic_with_error!(env, Error::InsufficientBacking);
        }
    }

    fn accounted_balance(env: &Env) -> i128 {
        let liabilities: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Liabilities)
            .unwrap_or(0);
        let rounding_reserve: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RoundingReserve)
            .unwrap_or(0);
        let protocol_fees: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolFees)
            .unwrap_or(0);
        liabilities
            .checked_add(rounding_reserve)
            .and_then(|value| value.checked_add(protocol_fees))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
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
