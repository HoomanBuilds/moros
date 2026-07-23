#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, Symbol, Vec,
};

#[cfg(test)]
mod test;

const BPS: i128 = 10_000;
const USDC_DECIMALS: u32 = 7;
const VIRTUAL_ASSETS: i128 = 1_000_000;
const VIRTUAL_SHARES: i128 = 1_000_000;
const MAX_ACTIVE_ALLOCATIONS: u32 = 16;
const MAX_QUEUE_SCAN: u32 = 16;
const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CellPhase {
    Funding,
    Ready,
    Active,
    Cancelled,
    Settled,
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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CellMarketSnapshot {
    pub state_version: u64,
    pub equity_if_yes: i128,
    pub equity_if_no: i128,
    pub conditional_lp_fees: i128,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CellInfo {
    pub token: Address,
    pub factory: Address,
    pub share_controller: Address,
    pub proposal_id: BytesN<32>,
    pub target_assets: i128,
    pub funded_assets: i128,
    pub total_shares: i128,
    pub locked_shares: i128,
    pub terminal_assets: i128,
    pub funding_deadline: u64,
    pub activation_cutoff: u64,
    pub decimals: u32,
    pub phase: CellPhase,
    pub market: Option<Address>,
    pub state_version: u64,
}

#[contractclient(crate_path = "soroban_sdk", name = "MarketLiquidityCellClient")]
pub trait MarketLiquidityCell {
    fn info(env: Env) -> CellInfo;
    fn market_snapshot(env: Env) -> Option<CellMarketSnapshot>;
    fn fund_received(
        env: Env,
        controller: Address,
        share_commitment: BytesN<32>,
        amount: i128,
        prior_unallocated_balance: i128,
        expected_version: u64,
    ) -> FundingResult;
    fn redeem_terminal(env: Env, controller: Address, shares: i128, expected_version: u64) -> i128;
    fn state_version(env: Env) -> u64;
    fn unallocated_balance(env: Env) -> i128;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RiskPolicy {
    pub deposit_cap: i128,
    pub max_active_allocations: u32,
    pub max_deployed_bps: u32,
    pub max_market_bps: u32,
    pub max_group_bps: u32,
    pub minimum_idle_bps: u32,
    pub withdrawal_window: u64,
    pub max_withdrawal_bps: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CandidateStatus {
    Pending,
    Allocated,
    Skipped,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AllocationStatus {
    Deployed,
    Harvested,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllocationCandidate {
    pub sequence: u64,
    pub proposal_id: BytesN<32>,
    pub liquidity_vault: Address,
    pub asset: Symbol,
    pub risk_group: Symbol,
    pub target_assets: i128,
    pub funding_deadline: u64,
    pub status: CandidateStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolAllocation {
    pub proposal_id: BytesN<32>,
    pub liquidity_vault: Address,
    pub asset: Symbol,
    pub risk_group: Symbol,
    pub principal: i128,
    pub cell_shares: i128,
    pub terminal_assets: i128,
    pub status: AllocationStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolInfo {
    pub token: Address,
    pub factory: Address,
    pub shared_vault: Address,
    pub governance: Address,
    pub policy: RiskPolicy,
    pub idle_assets: i128,
    pub total_shares: i128,
    pub deployed_principal: i128,
    pub active_allocations: u32,
    pub queue_head: u64,
    pub queue_tail: u64,
    pub pending_candidates: u32,
    pub allocation_cursor: u64,
    pub state_version: u64,
    pub withdrawal_window_started_at: u64,
    pub withdrawal_window_limit: i128,
    pub withdrawal_window_used: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolNav {
    pub deposit_nav: i128,
    pub withdrawal_nav: i128,
    pub idle_assets: i128,
    pub funding_assets: i128,
    pub terminal_assets: i128,
    pub active_floor_assets: i128,
    pub active_ceiling_assets: i128,
    pub conditional_fees_excluded: i128,
    pub immediate_assets: i128,
    pub limiter_resets_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedemptionPreview {
    pub shares: i128,
    pub assets: i128,
    pub immediate_assets: i128,
    pub can_redeem_now: bool,
    pub limiter_resets_at: u64,
    pub state_version: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Factory,
    SharedVault,
    Governance,
    Policy,
    IdleAssets,
    TotalShares,
    DeployedPrincipal,
    StateVersion,
    QueueHead,
    QueueTail,
    PendingCandidates,
    AllocationCursor,
    Candidate(u64),
    CandidateVault(Address),
    CandidateProposal(BytesN<32>),
    Allocation(Address),
    ActiveAllocations,
    GroupExposure(Symbol),
    ShareCommitment(BytesN<32>),
    WindowStart,
    WindowLimit,
    WindowUsed,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidConfiguration = 1,
    InvalidAmount = 2,
    WrongFactory = 3,
    WrongController = 4,
    StaleState = 5,
    DuplicateCandidate = 6,
    InvalidCandidate = 7,
    DuplicateCommitment = 8,
    InsufficientIdle = 9,
    WithdrawalLimited = 10,
    AllocationNotFound = 11,
    InvalidCell = 12,
    InvalidPhase = 13,
    TransferMismatch = 14,
    Arithmetic = 15,
}

#[contractevent(topics = ["pool_deposit"], data_format = "vec")]
pub struct PoolDeposit {
    pub assets: i128,
    pub shares: i128,
    pub total_shares: i128,
    pub state_version: u64,
}

#[contractevent(topics = ["pool_redeem"], data_format = "vec")]
pub struct PoolRedeem {
    pub assets: i128,
    pub shares: i128,
    pub total_shares: i128,
    pub state_version: u64,
}

#[contractevent(topics = ["pool_candidate"], data_format = "vec")]
pub struct PoolCandidate {
    #[topic]
    pub sequence: u64,
    pub proposal_id: BytesN<32>,
    pub liquidity_vault: Address,
    pub target_assets: i128,
}

#[contractevent(topics = ["pool_allocation"], data_format = "vec")]
pub struct PoolAllocationEvent {
    #[topic]
    pub sequence: u64,
    pub liquidity_vault: Address,
    pub risk_group: Symbol,
    pub principal: i128,
    pub state_version: u64,
}

#[contractevent(topics = ["pool_harvest"], data_format = "vec")]
pub struct PoolHarvest {
    pub liquidity_vault: Address,
    pub principal: i128,
    pub terminal_assets: i128,
    pub realized_pnl: i128,
    pub state_version: u64,
}

#[contract]
pub struct PooledLiquidityVault;

#[contractimpl]
impl PooledLiquidityVault {
    pub fn __constructor(
        env: Env,
        token: Address,
        factory: Address,
        shared_vault: Address,
        governance: Address,
        policy: RiskPolicy,
    ) {
        if token::Client::new(&env, &token).decimals() != USDC_DECIMALS
            || !Self::valid_policy(&policy)
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        let storage = env.storage().instance();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Factory, &factory);
        storage.set(&DataKey::SharedVault, &shared_vault);
        storage.set(&DataKey::Governance, &governance);
        storage.set(&DataKey::Policy, &policy);
        storage.set(&DataKey::IdleAssets, &0i128);
        storage.set(&DataKey::TotalShares, &0i128);
        storage.set(&DataKey::DeployedPrincipal, &0i128);
        storage.set(&DataKey::StateVersion, &0u64);
        storage.set(&DataKey::QueueHead, &0u64);
        storage.set(&DataKey::QueueTail, &0u64);
        storage.set(&DataKey::PendingCandidates, &0u32);
        storage.set(&DataKey::AllocationCursor, &0u64);
        storage.set(&DataKey::ActiveAllocations, &Vec::<Address>::new(&env));
        storage.set(&DataKey::WindowStart, &env.ledger().timestamp());
        storage.set(&DataKey::WindowLimit, &0i128);
        storage.set(&DataKey::WindowUsed, &0i128);
        Self::bump(&env);
    }

    pub fn info(env: Env) -> PoolInfo {
        Self::bump(&env);
        let storage = env.storage().instance();
        let active: Vec<Address> = storage
            .get(&DataKey::ActiveAllocations)
            .unwrap_or_else(|| Vec::new(&env));
        PoolInfo {
            token: storage.get(&DataKey::Token).unwrap(),
            factory: storage.get(&DataKey::Factory).unwrap(),
            shared_vault: storage.get(&DataKey::SharedVault).unwrap(),
            governance: storage.get(&DataKey::Governance).unwrap(),
            policy: storage.get(&DataKey::Policy).unwrap(),
            idle_assets: storage.get(&DataKey::IdleAssets).unwrap_or(0),
            total_shares: storage.get(&DataKey::TotalShares).unwrap_or(0),
            deployed_principal: storage.get(&DataKey::DeployedPrincipal).unwrap_or(0),
            active_allocations: active.len(),
            queue_head: storage.get(&DataKey::QueueHead).unwrap_or(0),
            queue_tail: storage.get(&DataKey::QueueTail).unwrap_or(0),
            pending_candidates: storage.get(&DataKey::PendingCandidates).unwrap_or(0),
            allocation_cursor: storage.get(&DataKey::AllocationCursor).unwrap_or(0),
            state_version: storage.get(&DataKey::StateVersion).unwrap_or(0),
            withdrawal_window_started_at: storage.get(&DataKey::WindowStart).unwrap_or(0),
            withdrawal_window_limit: storage.get(&DataKey::WindowLimit).unwrap_or(0),
            withdrawal_window_used: storage.get(&DataKey::WindowUsed).unwrap_or(0),
        }
    }

    pub fn nav(env: Env) -> PoolNav {
        Self::pool_nav(&env)
    }

    pub fn state_version(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::StateVersion)
            .unwrap_or(0)
    }

    pub fn unallocated_balance(env: Env) -> i128 {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let raw = token::Client::new(&env, &token).balance(&env.current_contract_address());
        let idle: i128 = env
            .storage()
            .instance()
            .get(&DataKey::IdleAssets)
            .unwrap_or(0);
        raw.checked_sub(idle)
            .filter(|value| *value >= 0)
            .unwrap_or_else(|| panic_with_error!(&env, Error::TransferMismatch))
    }

    pub fn group_exposure(env: Env, risk_group: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::GroupExposure(risk_group))
            .unwrap_or(0)
    }

    pub fn candidate(env: Env, sequence: u64) -> Option<AllocationCandidate> {
        let key = DataKey::Candidate(sequence);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn allocation(env: Env, liquidity_vault: Address) -> Option<PoolAllocation> {
        let key = DataKey::Allocation(liquidity_vault);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn preview_deposit(env: Env, assets: i128) -> i128 {
        Self::validate_amount(&env, assets);
        let nav = Self::pool_nav(&env);
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);
        Self::shares_for_deposit(&env, assets, total_shares, nav.deposit_nav)
    }

    pub fn preview_redeem(env: Env, shares: i128) -> RedemptionPreview {
        Self::validate_amount(&env, shares);
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);
        if shares > total_shares {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let nav = Self::pool_nav(&env);
        let active: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveAllocations)
            .unwrap_or_else(|| Vec::new(&env));
        let assets = Self::assets_for_redemption(
            &env,
            shares,
            total_shares,
            nav.withdrawal_nav,
            nav.idle_assets,
            active.is_empty(),
        );
        RedemptionPreview {
            shares,
            assets,
            immediate_assets: nav.immediate_assets,
            can_redeem_now: assets > 0 && assets <= nav.immediate_assets,
            limiter_resets_at: nav.limiter_resets_at,
            state_version: Self::state_version(env),
        }
    }

    pub fn fund_received(
        env: Env,
        controller: Address,
        share_commitment: BytesN<32>,
        amount: i128,
        prior_unallocated_balance: i128,
        expected_version: u64,
    ) -> FundingResult {
        Self::require_controller(&env, &controller);
        Self::require_version(&env, expected_version);
        Self::validate_amount(&env, amount);
        if prior_unallocated_balance < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let commitment_key = DataKey::ShareCommitment(share_commitment);
        if env.storage().persistent().has(&commitment_key) {
            panic_with_error!(&env, Error::DuplicateCommitment);
        }
        let nav = Self::pool_nav(&env);
        let policy: RiskPolicy = env.storage().instance().get(&DataKey::Policy).unwrap();
        if nav
            .deposit_nav
            .checked_add(amount)
            .is_none_or(|value| value > policy.deposit_cap)
        {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let raw = token::Client::new(&env, &token).balance(&env.current_contract_address());
        let idle: i128 = env
            .storage()
            .instance()
            .get(&DataKey::IdleAssets)
            .unwrap_or(0);
        let unallocated = raw
            .checked_sub(idle)
            .unwrap_or_else(|| panic_with_error!(&env, Error::TransferMismatch));
        if unallocated
            != prior_unallocated_balance
                .checked_add(amount)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic))
        {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);
        let shares = Self::shares_for_deposit(&env, amount, total_shares, nav.deposit_nav);
        let updated_idle = idle
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        let updated_shares = total_shares
            .checked_add(shares)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        env.storage()
            .instance()
            .set(&DataKey::IdleAssets, &updated_idle);
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &updated_shares);
        env.storage().persistent().set(&commitment_key, &shares);
        Self::bump_persistent(&env, &commitment_key);
        let state_version = Self::increment_version(&env);
        Self::bump(&env);
        PoolDeposit {
            assets: amount,
            shares,
            total_shares: updated_shares,
            state_version,
        }
        .publish(&env);
        FundingResult {
            accepted_assets: amount,
            unused_assets: 0,
            shares_minted: shares,
            state_version,
        }
    }

    pub fn unfund(env: Env, controller: Address, shares: i128, expected_version: u64) -> i128 {
        Self::require_controller(&env, &controller);
        Self::require_version(&env, expected_version);
        Self::validate_amount(&env, shares);
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);
        if shares > total_shares {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let nav = Self::pool_nav(&env);
        let active: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveAllocations)
            .unwrap_or_else(|| Vec::new(&env));
        let assets = Self::assets_for_redemption(
            &env,
            shares,
            total_shares,
            nav.withdrawal_nav,
            nav.idle_assets,
            active.is_empty(),
        );
        if assets <= 0 || assets > nav.idle_assets {
            panic_with_error!(&env, Error::InsufficientIdle);
        }
        let mut used: i128 = env
            .storage()
            .instance()
            .get(&DataKey::WindowUsed)
            .unwrap_or(0);
        let policy: RiskPolicy = env.storage().instance().get(&DataKey::Policy).unwrap();
        let remaining_idle = nav
            .idle_assets
            .checked_sub(assets)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        if !active.is_empty() {
            Self::rotate_withdrawal_window(&env, nav.withdrawal_nav);
            let limit: i128 = env
                .storage()
                .instance()
                .get(&DataKey::WindowLimit)
                .unwrap_or(0);
            used = env
                .storage()
                .instance()
                .get(&DataKey::WindowUsed)
                .unwrap_or(0);
            if used.checked_add(assets).is_none_or(|value| value > limit) {
                panic_with_error!(&env, Error::WithdrawalLimited);
            }
            let remaining_nav = nav
                .withdrawal_nav
                .checked_sub(assets)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
            let required_idle = Self::mul_div_ceil(
                &env,
                remaining_nav,
                i128::from(policy.minimum_idle_bps),
                BPS,
            );
            if remaining_idle < required_idle {
                panic_with_error!(&env, Error::InsufficientIdle);
            }
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let current = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let before = token_client.balance(&current);
        token_client.transfer(&current, &controller, &assets);
        let after = token_client.balance(&current);
        if before.checked_sub(after) != Some(assets) {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        let updated_shares = total_shares
            .checked_sub(shares)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        env.storage()
            .instance()
            .set(&DataKey::IdleAssets, &remaining_idle);
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &updated_shares);
        if !active.is_empty() {
            env.storage().instance().set(
                &DataKey::WindowUsed,
                &used
                    .checked_add(assets)
                    .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
            );
        }
        let state_version = Self::increment_version(&env);
        Self::bump(&env);
        PoolRedeem {
            assets,
            shares,
            total_shares: updated_shares,
            state_version,
        }
        .publish(&env);
        assets
    }

    #[allow(clippy::too_many_arguments)]
    pub fn register_candidate(
        env: Env,
        factory: Address,
        proposal_id: BytesN<32>,
        liquidity_vault: Address,
        asset: Symbol,
        risk_group: Symbol,
        target_assets: i128,
        funding_deadline: u64,
    ) -> u64 {
        Self::require_factory(&env, &factory);
        Self::validate_amount(&env, target_assets);
        if funding_deadline <= env.ledger().timestamp()
            || env
                .storage()
                .persistent()
                .has(&DataKey::CandidateVault(liquidity_vault.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::CandidateProposal(proposal_id.clone()))
        {
            panic_with_error!(&env, Error::DuplicateCandidate);
        }
        let info = MarketLiquidityCellClient::new(&env, &liquidity_vault).info();
        Self::validate_cell(
            &env,
            &info,
            &proposal_id,
            &liquidity_vault,
            target_assets,
            funding_deadline,
        );
        if info.phase != CellPhase::Funding || info.funded_assets != 0 || info.total_shares != 0 {
            panic_with_error!(&env, Error::InvalidCandidate);
        }
        let sequence: u64 = env
            .storage()
            .instance()
            .get(&DataKey::QueueTail)
            .unwrap_or(0);
        let next = sequence
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        let candidate = AllocationCandidate {
            sequence,
            proposal_id: proposal_id.clone(),
            liquidity_vault: liquidity_vault.clone(),
            asset,
            risk_group,
            target_assets,
            funding_deadline,
            status: CandidateStatus::Pending,
        };
        let key = DataKey::Candidate(sequence);
        env.storage().persistent().set(&key, &candidate);
        env.storage()
            .persistent()
            .set(&DataKey::CandidateVault(liquidity_vault.clone()), &sequence);
        env.storage()
            .persistent()
            .set(&DataKey::CandidateProposal(proposal_id.clone()), &sequence);
        Self::bump_persistent(&env, &key);
        env.storage().instance().set(&DataKey::QueueTail, &next);
        let pending: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingCandidates)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::PendingCandidates,
            &pending
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
        );
        Self::increment_version(&env);
        Self::bump(&env);
        PoolCandidate {
            sequence,
            proposal_id,
            liquidity_vault,
            target_assets,
        }
        .publish(&env);
        sequence
    }

    pub fn allocate_next(env: Env) -> Option<PoolAllocation> {
        let mut head: u64 = env
            .storage()
            .instance()
            .get(&DataKey::QueueHead)
            .unwrap_or(0);
        let tail: u64 = env
            .storage()
            .instance()
            .get(&DataKey::QueueTail)
            .unwrap_or(0);
        let mut pending: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingCandidates)
            .unwrap_or(0);
        if head >= tail || pending == 0 {
            return None;
        }
        let mut cursor: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AllocationCursor)
            .unwrap_or(head);
        if cursor < head || cursor >= tail {
            cursor = head;
        }
        let mut scanned = 0u32;
        let mut changed = false;
        let (sequence, key, mut candidate, cell) = loop {
            if scanned >= MAX_QUEUE_SCAN || pending == 0 {
                env.storage()
                    .instance()
                    .set(&DataKey::PendingCandidates, &pending);
                env.storage().instance().set(&DataKey::QueueHead, &head);
                env.storage()
                    .instance()
                    .set(&DataKey::AllocationCursor, &cursor);
                if changed {
                    Self::increment_version(&env);
                    Self::bump(&env);
                }
                return None;
            }
            let sequence = cursor;
            cursor = if cursor.saturating_add(1) >= tail {
                head
            } else {
                cursor + 1
            };
            scanned += 1;
            let key = DataKey::Candidate(sequence);
            let mut candidate: AllocationCandidate = env
                .storage()
                .persistent()
                .get(&key)
                .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidCandidate));
            if candidate.status != CandidateStatus::Pending {
                continue;
            }
            let cell = MarketLiquidityCellClient::new(&env, &candidate.liquidity_vault);
            let info = cell.info();
            if env.ledger().timestamp() > candidate.funding_deadline
                || Self::cell_matches_candidate(&env, &info, &candidate).is_err()
                || info.phase != CellPhase::Funding
                || info.funded_assets != 0
                || info.total_shares != 0
            {
                candidate.status = CandidateStatus::Skipped;
                env.storage().persistent().set(&key, &candidate);
                Self::bump_persistent(&env, &key);
                pending = pending
                    .checked_sub(1)
                    .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
                changed = true;
                if sequence == head {
                    head = Self::compact_head(&env, head, tail);
                    if cursor < head {
                        cursor = head;
                    }
                }
                continue;
            }
            let nav = Self::pool_nav(&env);
            if Self::has_allocation_capacity(&env, &candidate, &nav) {
                break (sequence, key, candidate, cell);
            }
        };
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let current = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let before = token_client.balance(&current);
        let prior_unallocated = cell.unallocated_balance();
        let cell_version = cell.state_version();
        token_client.transfer(
            &current,
            &candidate.liquidity_vault,
            &candidate.target_assets,
        );
        let result = cell.fund_received(
            &current,
            &candidate.proposal_id,
            &candidate.target_assets,
            &prior_unallocated,
            &cell_version,
        );
        let after = token_client.balance(&current);
        if result.accepted_assets != candidate.target_assets
            || result.unused_assets != 0
            || result.shares_minted <= 0
            || before.checked_sub(after) != Some(candidate.target_assets)
        {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        let allocation = PoolAllocation {
            proposal_id: candidate.proposal_id.clone(),
            liquidity_vault: candidate.liquidity_vault.clone(),
            asset: candidate.asset.clone(),
            risk_group: candidate.risk_group.clone(),
            principal: candidate.target_assets,
            cell_shares: result.shares_minted,
            terminal_assets: 0,
            status: AllocationStatus::Deployed,
        };
        let idle: i128 = env
            .storage()
            .instance()
            .get(&DataKey::IdleAssets)
            .unwrap_or(0);
        let deployed: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DeployedPrincipal)
            .unwrap_or(0);
        let group_key = DataKey::GroupExposure(candidate.risk_group.clone());
        let group: i128 = env.storage().persistent().get(&group_key).unwrap_or(0);
        env.storage().instance().set(
            &DataKey::IdleAssets,
            &idle
                .checked_sub(candidate.target_assets)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
        );
        env.storage().instance().set(
            &DataKey::DeployedPrincipal,
            &deployed
                .checked_add(candidate.target_assets)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
        );
        env.storage().persistent().set(
            &group_key,
            &group
                .checked_add(candidate.target_assets)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
        );
        Self::bump_persistent(&env, &group_key);
        let allocation_key = DataKey::Allocation(candidate.liquidity_vault.clone());
        env.storage().persistent().set(&allocation_key, &allocation);
        Self::bump_persistent(&env, &allocation_key);
        let mut active: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveAllocations)
            .unwrap_or_else(|| Vec::new(&env));
        active.push_back(candidate.liquidity_vault.clone());
        env.storage()
            .instance()
            .set(&DataKey::ActiveAllocations, &active);
        candidate.status = CandidateStatus::Allocated;
        env.storage().persistent().set(&key, &candidate);
        Self::bump_persistent(&env, &key);
        pending = pending
            .checked_sub(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        if sequence == head {
            head = Self::compact_head(&env, head, tail);
        }
        if pending == 0 {
            cursor = tail;
        } else if cursor < head || cursor >= tail {
            cursor = head;
        }
        env.storage()
            .instance()
            .set(&DataKey::PendingCandidates, &pending);
        env.storage().instance().set(&DataKey::QueueHead, &head);
        env.storage()
            .instance()
            .set(&DataKey::AllocationCursor, &cursor);
        let state_version = Self::increment_version(&env);
        Self::bump(&env);
        PoolAllocationEvent {
            sequence,
            liquidity_vault: candidate.liquidity_vault,
            risk_group: candidate.risk_group,
            principal: candidate.target_assets,
            state_version,
        }
        .publish(&env);
        Some(allocation)
    }

    pub fn harvest(env: Env, liquidity_vault: Address) -> i128 {
        let key = DataKey::Allocation(liquidity_vault.clone());
        let mut allocation: PoolAllocation = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::AllocationNotFound));
        if allocation.status != AllocationStatus::Deployed {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        let cell = MarketLiquidityCellClient::new(&env, &liquidity_vault);
        let info = cell.info();
        if (info.phase != CellPhase::Cancelled && info.phase != CellPhase::Settled)
            || info.total_shares != allocation.cell_shares
            || info.terminal_assets < 0
        {
            panic_with_error!(&env, Error::InvalidCell);
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let current = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let before = token_client.balance(&current);
        let received = cell.redeem_terminal(&current, &allocation.cell_shares, &info.state_version);
        let after = token_client.balance(&current);
        if received < 0 || after.checked_sub(before) != Some(received) {
            panic_with_error!(&env, Error::TransferMismatch);
        }
        let idle: i128 = env
            .storage()
            .instance()
            .get(&DataKey::IdleAssets)
            .unwrap_or(0);
        let deployed: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DeployedPrincipal)
            .unwrap_or(0);
        let group_key = DataKey::GroupExposure(allocation.risk_group.clone());
        let group: i128 = env.storage().persistent().get(&group_key).unwrap_or(0);
        env.storage().instance().set(
            &DataKey::IdleAssets,
            &idle
                .checked_add(received)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
        );
        env.storage().instance().set(
            &DataKey::DeployedPrincipal,
            &deployed
                .checked_sub(allocation.principal)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
        );
        env.storage().persistent().set(
            &group_key,
            &group
                .checked_sub(allocation.principal)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
        );
        Self::bump_persistent(&env, &group_key);
        let mut active: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveAllocations)
            .unwrap_or_else(|| Vec::new(&env));
        let index = active
            .first_index_of(&liquidity_vault)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidCell));
        active.remove(index);
        env.storage()
            .instance()
            .set(&DataKey::ActiveAllocations, &active);
        allocation.status = AllocationStatus::Harvested;
        allocation.terminal_assets = received;
        env.storage().persistent().set(&key, &allocation);
        Self::bump_persistent(&env, &key);
        let state_version = Self::increment_version(&env);
        Self::bump(&env);
        PoolHarvest {
            liquidity_vault,
            principal: allocation.principal,
            terminal_assets: received,
            realized_pnl: received
                .checked_sub(allocation.principal)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic)),
            state_version,
        }
        .publish(&env);
        received
    }

    pub fn extend_ttl(env: Env) {
        Self::bump(&env);
    }

    fn pool_nav(env: &Env) -> PoolNav {
        let storage = env.storage().instance();
        let idle: i128 = storage.get(&DataKey::IdleAssets).unwrap_or(0);
        let active: Vec<Address> = storage
            .get(&DataKey::ActiveAllocations)
            .unwrap_or_else(|| Vec::new(env));
        let mut funding_assets = 0i128;
        let mut terminal_assets = 0i128;
        let mut active_floor_assets = 0i128;
        let mut active_ceiling_assets = 0i128;
        let mut conditional_fees_excluded = 0i128;
        for liquidity_vault in active.iter() {
            let client = MarketLiquidityCellClient::new(env, &liquidity_vault);
            let info = client.info();
            let allocation: PoolAllocation = env
                .storage()
                .persistent()
                .get(&DataKey::Allocation(liquidity_vault.clone()))
                .unwrap_or_else(|| panic_with_error!(env, Error::InvalidCell));
            Self::validate_allocation_cell(env, &allocation, &info);
            match info.phase {
                CellPhase::Funding | CellPhase::Ready => {
                    funding_assets = Self::add(env, funding_assets, info.funded_assets);
                }
                CellPhase::Active => {
                    let snapshot = client
                        .market_snapshot()
                        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidCell));
                    let floor_with_fees = if snapshot.equity_if_yes < snapshot.equity_if_no {
                        snapshot.equity_if_yes
                    } else {
                        snapshot.equity_if_no
                    };
                    let ceiling_with_fees = if snapshot.equity_if_yes > snapshot.equity_if_no {
                        snapshot.equity_if_yes
                    } else {
                        snapshot.equity_if_no
                    };
                    let floor = floor_with_fees
                        .checked_sub(snapshot.conditional_lp_fees)
                        .filter(|value| *value >= 0)
                        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidCell));
                    let ceiling = ceiling_with_fees
                        .checked_sub(snapshot.conditional_lp_fees)
                        .filter(|value| *value >= floor)
                        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidCell));
                    active_floor_assets = Self::add(env, active_floor_assets, floor);
                    active_ceiling_assets = Self::add(env, active_ceiling_assets, ceiling);
                    conditional_fees_excluded =
                        Self::add(env, conditional_fees_excluded, snapshot.conditional_lp_fees);
                }
                CellPhase::Cancelled | CellPhase::Settled => {
                    terminal_assets = Self::add(env, terminal_assets, info.terminal_assets);
                }
            }
        }
        let common = Self::add(env, Self::add(env, idle, funding_assets), terminal_assets);
        let withdrawal_nav = Self::add(env, common, active_floor_assets);
        let deposit_nav = Self::add(env, common, active_ceiling_assets);
        let policy: RiskPolicy = storage.get(&DataKey::Policy).unwrap();
        let required_idle = if active.is_empty() {
            0
        } else {
            Self::mul_div_ceil(
                env,
                withdrawal_nav,
                i128::from(policy.minimum_idle_bps),
                BPS,
            )
        };
        let free_idle = idle.saturating_sub(required_idle);
        let (window_remaining, resets_at) = if active.is_empty() {
            (idle, env.ledger().timestamp())
        } else {
            Self::window_remaining(env, withdrawal_nav, &policy)
        };
        PoolNav {
            deposit_nav,
            withdrawal_nav,
            idle_assets: idle,
            funding_assets,
            terminal_assets,
            active_floor_assets,
            active_ceiling_assets,
            conditional_fees_excluded,
            immediate_assets: if free_idle < window_remaining {
                free_idle
            } else {
                window_remaining
            },
            limiter_resets_at: resets_at,
        }
    }

    fn has_allocation_capacity(env: &Env, candidate: &AllocationCandidate, nav: &PoolNav) -> bool {
        let policy: RiskPolicy = env.storage().instance().get(&DataKey::Policy).unwrap();
        let active: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveAllocations)
            .unwrap_or_else(|| Vec::new(env));
        let deployed: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DeployedPrincipal)
            .unwrap_or(0);
        let group: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::GroupExposure(candidate.risk_group.clone()))
            .unwrap_or(0);
        let risk_nav = nav.withdrawal_nav;
        if risk_nav <= 0
            || active.len() >= policy.max_active_allocations
            || candidate.target_assets > nav.idle_assets
        {
            return false;
        }
        let market_cap = Self::mul_div_floor(env, risk_nav, i128::from(policy.max_market_bps), BPS);
        let deployed_cap =
            Self::mul_div_floor(env, risk_nav, i128::from(policy.max_deployed_bps), BPS);
        let group_cap = Self::mul_div_floor(env, risk_nav, i128::from(policy.max_group_bps), BPS);
        let required_idle =
            Self::mul_div_ceil(env, risk_nav, i128::from(policy.minimum_idle_bps), BPS);
        candidate.target_assets <= market_cap
            && deployed
                .checked_add(candidate.target_assets)
                .is_some_and(|value| value <= deployed_cap)
            && group
                .checked_add(candidate.target_assets)
                .is_some_and(|value| value <= group_cap)
            && nav
                .idle_assets
                .checked_sub(candidate.target_assets)
                .is_some_and(|value| value >= required_idle)
    }

    fn validate_cell(
        env: &Env,
        info: &CellInfo,
        proposal_id: &BytesN<32>,
        liquidity_vault: &Address,
        target_assets: i128,
        funding_deadline: u64,
    ) {
        if info.token != Self::get(env, &DataKey::Token)
            || info.factory != Self::get(env, &DataKey::Factory)
            || info.share_controller != env.current_contract_address()
            || info.proposal_id != *proposal_id
            || info.target_assets != target_assets
            || info.funding_deadline != funding_deadline
            || info.market.is_some()
            || liquidity_vault == &env.current_contract_address()
        {
            panic_with_error!(env, Error::InvalidCell);
        }
    }

    fn cell_matches_candidate(
        env: &Env,
        info: &CellInfo,
        candidate: &AllocationCandidate,
    ) -> Result<(), Error> {
        if info.token != Self::get(env, &DataKey::Token)
            || info.factory != Self::get(env, &DataKey::Factory)
            || info.share_controller != env.current_contract_address()
            || info.proposal_id != candidate.proposal_id
            || info.target_assets != candidate.target_assets
            || info.funding_deadline != candidate.funding_deadline
            || info.market.is_some()
        {
            return Err(Error::InvalidCell);
        }
        Ok(())
    }

    fn validate_allocation_cell(env: &Env, allocation: &PoolAllocation, info: &CellInfo) {
        if allocation.status != AllocationStatus::Deployed
            || info.token != Self::get(env, &DataKey::Token)
            || info.factory != Self::get(env, &DataKey::Factory)
            || info.share_controller != env.current_contract_address()
            || info.proposal_id != allocation.proposal_id
            || info.target_assets != allocation.principal
            || info.total_shares != allocation.cell_shares
        {
            panic_with_error!(env, Error::InvalidCell);
        }
    }

    fn shares_for_deposit(env: &Env, assets: i128, total_shares: i128, deposit_nav: i128) -> i128 {
        let shares = Self::mul_div_floor(
            env,
            assets,
            Self::add(env, total_shares, VIRTUAL_SHARES),
            Self::add(env, deposit_nav, VIRTUAL_ASSETS),
        );
        if shares <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
        shares
    }

    fn assets_for_redemption(
        env: &Env,
        shares: i128,
        total_shares: i128,
        withdrawal_nav: i128,
        idle_assets: i128,
        no_allocations: bool,
    ) -> i128 {
        if shares == total_shares && no_allocations {
            return idle_assets;
        }
        Self::mul_div_floor(
            env,
            shares,
            Self::add(env, withdrawal_nav, VIRTUAL_ASSETS),
            Self::add(env, total_shares, VIRTUAL_SHARES),
        )
    }

    fn window_remaining(env: &Env, withdrawal_nav: i128, policy: &RiskPolicy) -> (i128, u64) {
        let now = env.ledger().timestamp();
        let start: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WindowStart)
            .unwrap_or(now);
        if now >= start.saturating_add(policy.withdrawal_window) {
            let limit = Self::mul_div_floor(
                env,
                withdrawal_nav,
                i128::from(policy.max_withdrawal_bps),
                BPS,
            );
            return (limit, now.saturating_add(policy.withdrawal_window));
        }
        let limit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::WindowLimit)
            .unwrap_or(0);
        let used: i128 = env
            .storage()
            .instance()
            .get(&DataKey::WindowUsed)
            .unwrap_or(0);
        if limit == 0 {
            let next_limit = Self::mul_div_floor(
                env,
                withdrawal_nav,
                i128::from(policy.max_withdrawal_bps),
                BPS,
            );
            return (next_limit, start.saturating_add(policy.withdrawal_window));
        }
        (
            limit.saturating_sub(used),
            start.saturating_add(policy.withdrawal_window),
        )
    }

    fn rotate_withdrawal_window(env: &Env, withdrawal_nav: i128) {
        let policy: RiskPolicy = env.storage().instance().get(&DataKey::Policy).unwrap();
        let now = env.ledger().timestamp();
        let start: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WindowStart)
            .unwrap_or(now);
        let limit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::WindowLimit)
            .unwrap_or(0);
        if limit == 0 || now >= start.saturating_add(policy.withdrawal_window) {
            let next_limit = Self::mul_div_floor(
                env,
                withdrawal_nav,
                i128::from(policy.max_withdrawal_bps),
                BPS,
            );
            env.storage().instance().set(&DataKey::WindowStart, &now);
            env.storage()
                .instance()
                .set(&DataKey::WindowLimit, &next_limit);
            env.storage().instance().set(&DataKey::WindowUsed, &0i128);
        }
    }

    fn compact_head(env: &Env, mut head: u64, tail: u64) -> u64 {
        while head < tail {
            let candidate: AllocationCandidate = env
                .storage()
                .persistent()
                .get(&DataKey::Candidate(head))
                .unwrap_or_else(|| panic_with_error!(env, Error::InvalidCandidate));
            if candidate.status == CandidateStatus::Pending {
                break;
            }
            head = head
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        }
        head
    }

    fn require_controller(env: &Env, controller: &Address) {
        let expected: Address = Self::get(env, &DataKey::SharedVault);
        if controller != &expected {
            panic_with_error!(env, Error::WrongController);
        }
        controller.require_auth();
    }

    fn require_factory(env: &Env, factory: &Address) {
        let expected: Address = Self::get(env, &DataKey::Factory);
        if factory != &expected {
            panic_with_error!(env, Error::WrongFactory);
        }
        factory.require_auth();
    }

    fn require_version(env: &Env, expected: u64) {
        if Self::state_version(env.clone()) != expected {
            panic_with_error!(env, Error::StaleState);
        }
    }

    fn valid_policy(policy: &RiskPolicy) -> bool {
        policy.deposit_cap > 0
            && policy.deposit_cap <= MAX_AMOUNT
            && policy.max_active_allocations > 0
            && policy.max_active_allocations <= MAX_ACTIVE_ALLOCATIONS
            && policy.max_market_bps > 0
            && policy.max_market_bps <= policy.max_group_bps
            && policy.max_group_bps <= policy.max_deployed_bps
            && policy.max_deployed_bps <= 10_000
            && policy.minimum_idle_bps > 0
            && policy.minimum_idle_bps < 10_000
            && policy
                .max_deployed_bps
                .checked_add(policy.minimum_idle_bps)
                .is_some_and(|value| value <= 10_000)
            && policy.withdrawal_window > 0
            && policy.max_withdrawal_bps > 0
            && policy.max_withdrawal_bps <= 10_000
    }

    fn validate_amount(env: &Env, amount: i128) {
        if amount <= 0 || amount > MAX_AMOUNT {
            panic_with_error!(env, Error::InvalidAmount);
        }
    }

    fn add(env: &Env, left: i128, right: i128) -> i128 {
        left.checked_add(right)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
    }

    fn mul_div_floor(env: &Env, left: i128, right: i128, denominator: i128) -> i128 {
        if left < 0 || right < 0 || denominator <= 0 {
            panic_with_error!(env, Error::Arithmetic);
        }
        left.checked_mul(right)
            .and_then(|value| value.checked_div(denominator))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
    }

    fn mul_div_ceil(env: &Env, left: i128, right: i128, denominator: i128) -> i128 {
        let product = left
            .checked_mul(right)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        product
            .checked_add(denominator - 1)
            .and_then(|value| value.checked_div(denominator))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
    }

    fn increment_version(env: &Env) -> u64 {
        let next = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::StateVersion)
            .unwrap_or(0)
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        env.storage().instance().set(&DataKey::StateVersion, &next);
        next
    }

    fn get<T>(env: &Env, key: &DataKey) -> T
    where
        T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>,
    {
        env.storage().instance().get(key).unwrap()
    }

    fn bump(env: &Env) {
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
