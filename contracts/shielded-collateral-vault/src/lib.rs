#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec, U256,
};

#[cfg(test)]
mod test;

const EXPECTED_USDC_DECIMALS: u32 = 7;
const MIN_TREE_LEVELS: u32 = 8;
const MAX_TREE_LEVELS: u32 = 31;
const MIN_ROOT_HISTORY: u32 = 8;
const MAX_ROOT_HISTORY: u32 = 128;
const MIN_ENVELOPE_LENGTH: u32 = 96;
const MAX_ENVELOPE_LENGTH: u32 = 512;
const MAX_PROOF_LENGTH: u32 = 512;
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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransitionContext {
    pub network_domain: BytesN<32>,
    pub vault: Address,
    pub token: Address,
    pub verifier_domain: BytesN<32>,
    pub action: ProofAction,
    pub action_id: BytesN<32>,
    pub public_account: Option<Address>,
    pub public_amount: i128,
    pub market: Option<Address>,
    pub binding: BytesN<32>,
    pub expiry: u64,
}

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
    pub envelope_length: u32,
    pub next_leaf_index: u32,
    pub current_root: U256,
    pub shielded_liabilities: i128,
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
    EnvelopeLength,
    NextLeafIndex,
    CurrentRoot,
    CurrentRootSlot,
    Liabilities,
    DepositsPaused,
    Root(u32),
    Nullifier(U256),
    Commitment(U256),
    Output(u32),
    Action(BytesN<32>),
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

#[contractclient(crate_path = "soroban_sdk", name = "ProofVerifierClient")]
pub trait ProofVerifier {
    fn verify(env: Env, statement: ProofStatement, proof: Bytes) -> bool;
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
        envelope_length: u32,
    ) {
        let decimals = token::Client::new(&env, &token).decimals();
        if decimals != EXPECTED_USDC_DECIMALS
            || levels < MIN_TREE_LEVELS
            || levels > MAX_TREE_LEVELS
            || root_history_size < MIN_ROOT_HISTORY
            || root_history_size > MAX_ROOT_HISTORY
            || max_root_age == 0
            || envelope_length < MIN_ENVELOPE_LENGTH
            || envelope_length > MAX_ENVELOPE_LENGTH
            || Self::is_zero_bytes(&network_domain)
            || Self::is_zero_bytes(&verifier_domain)
            || Self::is_zero_bytes(&treasury_key)
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
        instance.set(&DataKey::EnvelopeLength, &envelope_length);
        instance.set(&DataKey::NextLeafIndex, &0u32);
        instance.set(&DataKey::CurrentRoot, &genesis_root);
        instance.set(&DataKey::CurrentRootSlot, &0u32);
        instance.set(&DataKey::Liabilities, &0i128);
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
            envelope_length: instance.get(&DataKey::EnvelopeLength).unwrap(),
            next_leaf_index: instance.get(&DataKey::NextLeafIndex).unwrap_or(0),
            current_root: instance.get(&DataKey::CurrentRoot).unwrap(),
            shielded_liabilities: instance.get(&DataKey::Liabilities).unwrap_or(0),
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
        binding: BytesN<32>,
        expiry: u64,
    ) -> BytesN<32> {
        Self::bump_instance(&env);
        let instance = env.storage().instance();
        let context = TransitionContext {
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
        env.crypto().sha256(&context.to_xdr(&env)).into()
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
        let binding_digest: BytesN<32> = env.crypto().sha256(&binding.to_xdr(&env)).into();
        Self::execute_transition(
            &env,
            ProofAction::LiquidityFund,
            action_id,
            None,
            -amount,
            Some(liquidity_vault.clone()),
            binding_digest,
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
        let liabilities: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Liabilities)
            .unwrap_or(0);
        balance.checked_sub(liabilities).unwrap_or(0)
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
        binding: BytesN<32>,
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
        if transition.input_nullifiers.len() != expected_nullifiers
            || transition.output_commitments.len() != 2
            || transition.encrypted_outputs.len() != 2
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
            .checked_add(2)
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

        for i in 0..2 {
            let commitment = transition.output_commitments.get(i).unwrap();
            let encrypted = transition.encrypted_outputs.get(i).unwrap();
            if !Self::canonical_nonzero_field(env, &commitment) {
                panic_with_error!(env, Error::InvalidProofStatement);
            }
            if encrypted.len() != info.envelope_length {
                panic_with_error!(env, Error::InvalidEnvelope);
            }
            if env
                .storage()
                .persistent()
                .has(&DataKey::Commitment(commitment.clone()))
                || (i == 1 && transition.output_commitments.get(0).unwrap() == commitment)
            {
                panic_with_error!(env, Error::DuplicateCommitment);
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
        let statement = ProofStatement {
            action,
            context_digest: digest,
            membership_root: transition.membership_root.clone(),
            append_root: transition.append_root.clone(),
            new_root: transition.new_root.clone(),
            input_nullifiers: transition.input_nullifiers.clone(),
            output_commitments: transition.output_commitments.clone(),
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

        for i in 0..2 {
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
            .checked_add(2)
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
        let binding_digest: BytesN<32> = env.crypto().sha256(&binding.to_xdr(env)).into();
        Self::execute_transition(
            env,
            action,
            action_id,
            None,
            expected_assets,
            Some(liquidity_vault.clone()),
            binding_digest,
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

    fn is_zero_bytes(value: &BytesN<32>) -> bool {
        value.to_array().iter().all(|byte| *byte == 0)
    }

    fn validate_amount(env: &Env, amount: i128) {
        if amount <= 0 || amount > MAX_AMOUNT {
            panic_with_error!(env, Error::InvalidAmount);
        }
    }

    fn validate_expiry(env: &Env, expiry: u64) {
        let now = env.ledger().timestamp();
        if expiry < now || expiry > now.saturating_add(MAX_ACTION_LIFETIME) {
            panic_with_error!(env, Error::InvalidExpiry);
        }
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

    fn empty_binding(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0; 32])
    }

    fn assert_backing(env: &Env) {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let balance = token::Client::new(env, &token).balance(&env.current_contract_address());
        let liabilities: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Liabilities)
            .unwrap_or(0);
        if balance < liabilities {
            panic_with_error!(env, Error::InsufficientBacking);
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
