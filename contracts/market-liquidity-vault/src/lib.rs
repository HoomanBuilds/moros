#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, Env,
};

#[cfg(test)]
mod test;

const VIRTUAL_ASSETS: i128 = 1_000_000;
const VIRTUAL_SHARES: i128 = 1_000_000;
const MAX_TRACKED_ASSETS: i128 = 1_000_000_000_000_000_000;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Funding,
    Ready,
    Active,
    Cancelled,
    Settled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExitStatus {
    Open,
    Matched,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalOutcome {
    Yes,
    No,
    Void,
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
pub struct MarketSnapshot {
    pub state_version: u64,
    pub equity_if_yes: i128,
    pub equity_if_no: i128,
    pub conditional_lp_fees: i128,
    pub updated_at: u64,
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
pub struct VaultInfo {
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
    pub phase: Phase,
    pub market: Option<Address>,
    pub state_version: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Factory,
    Controller,
    Proposal,
    Target,
    Funded,
    Shares,
    Locked,
    TerminalAssets,
    TerminalOutcome,
    FundingDeadline,
    ActivationCutoff,
    Decimals,
    Phase,
    Market,
    Version,
    MarketSnapshot,
    Commitment(BytesN<32>),
    Exit(BytesN<32>),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidConfiguration = 1,
    InvalidAmount = 2,
    WrongController = 3,
    WrongFactory = 4,
    WrongMarket = 5,
    InvalidPhase = 6,
    StaleState = 7,
    DeadlinePassed = 8,
    TooEarly = 9,
    FullyFunded = 10,
    DuplicateCommitment = 11,
    InsufficientShares = 12,
    TransferMismatch = 13,
    DuplicateExit = 14,
    ExitNotFound = 15,
    InvalidExit = 16,
    MarketStateMismatch = 17,
    StaleMarketState = 18,
    InvalidTerminalAssets = 19,
    Arithmetic = 20,
}

#[contractevent(topics = ["lp_funded"], data_format = "vec")]
pub struct LpFunded {
    #[topic]
    pub proposal_id: BytesN<32>,
    pub commitment: BytesN<32>,
    pub assets: i128,
    pub shares: i128,
    pub state_version: u64,
}

#[contractevent(topics = ["lp_activated"], data_format = "vec")]
pub struct LpActivated {
    #[topic]
    pub proposal_id: BytesN<32>,
    pub market: Address,
    pub assets: i128,
    pub shares: i128,
    pub state_version: u64,
}

#[contractevent(topics = ["lp_exit"], data_format = "vec")]
pub struct LpExitUpdated {
    #[topic]
    pub exit_id: BytesN<32>,
    pub shares_remaining: i128,
    pub status: ExitStatus,
    pub state_version: u64,
}

#[contractevent(topics = ["lp_terminal"], data_format = "vec")]
pub struct LpTerminal {
    #[topic]
    pub proposal_id: BytesN<32>,
    pub outcome: TerminalOutcome,
    pub assets: i128,
    pub state_version: u64,
}

#[contract]
pub struct MarketLiquidityVault;

#[contractimpl]
impl MarketLiquidityVault {
    pub fn __constructor(
        env: Env,
        token: Address,
        factory: Address,
        share_controller: Address,
        proposal_id: BytesN<32>,
        target_assets: i128,
        funding_deadline: u64,
        activation_cutoff: u64,
        expected_decimals: u32,
    ) {
        let now = env.ledger().timestamp();
        let actual_decimals = token::Client::new(&env, &token).decimals();
        if target_assets <= 0
            || target_assets > MAX_TRACKED_ASSETS
            || funding_deadline <= now
            || activation_cutoff < funding_deadline
            || expected_decimals != 7
            || actual_decimals != expected_decimals
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }

        let storage = env.storage().instance();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Factory, &factory);
        storage.set(&DataKey::Controller, &share_controller);
        storage.set(&DataKey::Proposal, &proposal_id);
        storage.set(&DataKey::Target, &target_assets);
        storage.set(&DataKey::Funded, &0i128);
        storage.set(&DataKey::Shares, &0i128);
        storage.set(&DataKey::Locked, &0i128);
        storage.set(&DataKey::TerminalAssets, &0i128);
        storage.set(&DataKey::FundingDeadline, &funding_deadline);
        storage.set(&DataKey::ActivationCutoff, &activation_cutoff);
        storage.set(&DataKey::Decimals, &expected_decimals);
        storage.set(&DataKey::Phase, &Phase::Funding);
        storage.set(&DataKey::Version, &0u64);
        Self::bump(&env);
    }

    pub fn info(env: Env) -> VaultInfo {
        Self::bump(&env);
        let storage = env.storage().instance();
        VaultInfo {
            token: storage.get(&DataKey::Token).unwrap(),
            factory: storage.get(&DataKey::Factory).unwrap(),
            share_controller: storage.get(&DataKey::Controller).unwrap(),
            proposal_id: storage.get(&DataKey::Proposal).unwrap(),
            target_assets: storage.get(&DataKey::Target).unwrap(),
            funded_assets: storage.get(&DataKey::Funded).unwrap_or(0),
            total_shares: storage.get(&DataKey::Shares).unwrap_or(0),
            locked_shares: storage.get(&DataKey::Locked).unwrap_or(0),
            terminal_assets: storage.get(&DataKey::TerminalAssets).unwrap_or(0),
            funding_deadline: storage.get(&DataKey::FundingDeadline).unwrap(),
            activation_cutoff: storage.get(&DataKey::ActivationCutoff).unwrap(),
            decimals: storage.get(&DataKey::Decimals).unwrap(),
            phase: storage.get(&DataKey::Phase).unwrap(),
            market: storage.get(&DataKey::Market),
            state_version: storage.get(&DataKey::Version).unwrap_or(0),
        }
    }

    pub fn fund(
        env: Env,
        controller: Address,
        share_commitment: BytesN<32>,
        amount: i128,
        expected_version: u64,
    ) -> Result<FundingResult, Error> {
        Self::require_controller(&env, &controller)?;
        Self::require_version(&env, expected_version)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if env.ledger().timestamp() > Self::get::<u64>(&env, &DataKey::FundingDeadline) {
            return Err(Error::DeadlinePassed);
        }
        if Self::get::<Phase>(&env, &DataKey::Phase) != Phase::Funding {
            return Err(Error::InvalidPhase);
        }
        let commitment_key = DataKey::Commitment(share_commitment.clone());
        if env.storage().persistent().has(&commitment_key) {
            return Err(Error::DuplicateCommitment);
        }

        let target = Self::get::<i128>(&env, &DataKey::Target);
        let funded = Self::get::<i128>(&env, &DataKey::Funded);
        let remaining = target.checked_sub(funded).ok_or(Error::Arithmetic)?;
        if remaining == 0 {
            return Err(Error::FullyFunded);
        }
        let accepted = if amount < remaining {
            amount
        } else {
            remaining
        };
        let total_shares = Self::get::<i128>(&env, &DataKey::Shares);
        let shares = accepted
            .checked_mul(
                total_shares
                    .checked_add(VIRTUAL_SHARES)
                    .ok_or(Error::Arithmetic)?,
            )
            .ok_or(Error::Arithmetic)?
            .checked_div(
                funded
                    .checked_add(VIRTUAL_ASSETS)
                    .ok_or(Error::Arithmetic)?,
            )
            .ok_or(Error::Arithmetic)?;
        if shares <= 0 {
            return Err(Error::InvalidAmount);
        }

        Self::transfer_in_exact(&env, &controller, accepted)?;
        let updated_funded = funded.checked_add(accepted).ok_or(Error::Arithmetic)?;
        let updated_shares = total_shares.checked_add(shares).ok_or(Error::Arithmetic)?;
        env.storage()
            .instance()
            .set(&DataKey::Funded, &updated_funded);
        env.storage()
            .instance()
            .set(&DataKey::Shares, &updated_shares);
        if updated_funded == target {
            env.storage().instance().set(&DataKey::Phase, &Phase::Ready);
        }
        env.storage().persistent().set(&commitment_key, &shares);
        Self::bump_key(&env, &commitment_key);
        let state_version = Self::increment_version(&env)?;
        Self::bump(&env);
        LpFunded {
            proposal_id: Self::get(&env, &DataKey::Proposal),
            commitment: share_commitment,
            assets: accepted,
            shares,
            state_version,
        }
        .publish(&env);
        Ok(FundingResult {
            accepted_assets: accepted,
            unused_assets: amount.checked_sub(accepted).ok_or(Error::Arithmetic)?,
            shares_minted: shares,
            state_version,
        })
    }

    pub fn unfund(
        env: Env,
        controller: Address,
        shares: i128,
        expected_version: u64,
    ) -> Result<i128, Error> {
        Self::require_controller(&env, &controller)?;
        Self::require_version(&env, expected_version)?;
        let phase = Self::get::<Phase>(&env, &DataKey::Phase);
        if phase != Phase::Funding && phase != Phase::Ready {
            return Err(Error::InvalidPhase);
        }
        let total_shares = Self::get::<i128>(&env, &DataKey::Shares);
        let funded = Self::get::<i128>(&env, &DataKey::Funded);
        if shares <= 0 || shares > total_shares {
            return Err(Error::InsufficientShares);
        }
        let assets = if shares == total_shares {
            funded
        } else {
            shares
                .checked_mul(funded)
                .ok_or(Error::Arithmetic)?
                .checked_div(total_shares)
                .ok_or(Error::Arithmetic)?
        };
        let remaining_shares = total_shares.checked_sub(shares).ok_or(Error::Arithmetic)?;
        let remaining_assets = funded.checked_sub(assets).ok_or(Error::Arithmetic)?;
        env.storage()
            .instance()
            .set(&DataKey::Shares, &remaining_shares);
        env.storage()
            .instance()
            .set(&DataKey::Funded, &remaining_assets);
        env.storage()
            .instance()
            .set(&DataKey::Phase, &Phase::Funding);
        Self::transfer_out_exact(&env, &controller, assets)?;
        Self::increment_version(&env)?;
        Self::bump(&env);
        Ok(assets)
    }

    pub fn cancel(env: Env, expected_version: u64) -> Result<(), Error> {
        Self::require_version(&env, expected_version)?;
        let phase = Self::get::<Phase>(&env, &DataKey::Phase);
        let now = env.ledger().timestamp();
        let allowed = (phase == Phase::Funding
            && now > Self::get::<u64>(&env, &DataKey::FundingDeadline))
            || (phase == Phase::Ready && now > Self::get::<u64>(&env, &DataKey::ActivationCutoff));
        if !allowed {
            return Err(Error::TooEarly);
        }
        let funded = Self::get::<i128>(&env, &DataKey::Funded);
        env.storage()
            .instance()
            .set(&DataKey::TerminalAssets, &funded);
        env.storage()
            .instance()
            .set(&DataKey::Phase, &Phase::Cancelled);
        Self::increment_version(&env)?;
        Self::bump(&env);
        Ok(())
    }

    pub fn activate(
        env: Env,
        factory: Address,
        market: Address,
        expected_version: u64,
    ) -> Result<i128, Error> {
        Self::require_factory(&env, &factory)?;
        Self::require_version(&env, expected_version)?;
        if Self::get::<Phase>(&env, &DataKey::Phase) != Phase::Ready {
            return Err(Error::InvalidPhase);
        }
        if env.ledger().timestamp() > Self::get::<u64>(&env, &DataKey::ActivationCutoff) {
            return Err(Error::DeadlinePassed);
        }
        let target = Self::get::<i128>(&env, &DataKey::Target);
        if Self::get::<i128>(&env, &DataKey::Funded) != target
            || Self::get::<i128>(&env, &DataKey::Shares) <= 0
        {
            return Err(Error::InvalidConfiguration);
        }
        Self::transfer_out_exact(&env, &market, target)?;
        env.storage().instance().set(&DataKey::Market, &market);
        env.storage()
            .instance()
            .set(&DataKey::Phase, &Phase::Active);
        let state_version = Self::increment_version(&env)?;
        Self::bump(&env);
        LpActivated {
            proposal_id: Self::get(&env, &DataKey::Proposal),
            market,
            assets: target,
            shares: Self::get(&env, &DataKey::Shares),
            state_version,
        }
        .publish(&env);
        Ok(target)
    }

    pub fn sync_market_state(
        env: Env,
        market: Address,
        market_state_version: u64,
        equity_if_yes: i128,
        equity_if_no: i128,
        conditional_lp_fees: i128,
        updated_at: u64,
        expected_version: u64,
    ) -> Result<(), Error> {
        Self::require_market(&env, &market)?;
        Self::require_version(&env, expected_version)?;
        if Self::get::<Phase>(&env, &DataKey::Phase) != Phase::Active
            || equity_if_yes < 0
            || equity_if_no < 0
            || conditional_lp_fees < 0
            || updated_at > env.ledger().timestamp()
        {
            return Err(Error::InvalidConfiguration);
        }
        let previous: Option<MarketSnapshot> =
            env.storage().instance().get(&DataKey::MarketSnapshot);
        if previous
            .as_ref()
            .map(|snapshot| market_state_version <= snapshot.state_version)
            .unwrap_or(false)
        {
            return Err(Error::StaleMarketState);
        }
        env.storage().instance().set(
            &DataKey::MarketSnapshot,
            &MarketSnapshot {
                state_version: market_state_version,
                equity_if_yes,
                equity_if_no,
                conditional_lp_fees,
                updated_at,
            },
        );
        Self::increment_version(&env)?;
        Self::bump(&env);
        Ok(())
    }

    pub fn request_exit(
        env: Env,
        controller: Address,
        exit_id: BytesN<32>,
        shares: i128,
        minimum_payment: i128,
        destination: BytesN<32>,
        expiry: u64,
        expected_version: u64,
    ) -> Result<(), Error> {
        Self::require_controller(&env, &controller)?;
        Self::require_version(&env, expected_version)?;
        if Self::get::<Phase>(&env, &DataKey::Phase) != Phase::Active
            || shares <= 0
            || minimum_payment < 0
            || expiry <= env.ledger().timestamp()
        {
            return Err(Error::InvalidExit);
        }
        let key = DataKey::Exit(exit_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::DuplicateExit);
        }
        let total_shares = Self::get::<i128>(&env, &DataKey::Shares);
        let locked = Self::get::<i128>(&env, &DataKey::Locked);
        if shares > total_shares.checked_sub(locked).ok_or(Error::Arithmetic)? {
            return Err(Error::InsufficientShares);
        }
        env.storage().persistent().set(
            &key,
            &ExitIntent {
                shares_remaining: shares,
                minimum_payment_remaining: minimum_payment,
                destination,
                expiry,
                status: ExitStatus::Open,
            },
        );
        Self::bump_key(&env, &key);
        env.storage().instance().set(
            &DataKey::Locked,
            &locked.checked_add(shares).ok_or(Error::Arithmetic)?,
        );
        let state_version = Self::increment_version(&env)?;
        Self::bump(&env);
        LpExitUpdated {
            exit_id,
            shares_remaining: shares,
            status: ExitStatus::Open,
            state_version,
        }
        .publish(&env);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn match_exit(
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
        expected_version: u64,
    ) -> Result<ExitFill, Error> {
        Self::require_controller(&env, &controller)?;
        Self::require_version(&env, expected_version)?;
        if Self::get::<Phase>(&env, &DataKey::Phase) != Phase::Active
            || shares <= 0
            || payment < 0
            || maximum_state_age == 0
        {
            return Err(Error::InvalidExit);
        }
        let snapshot: MarketSnapshot = env
            .storage()
            .instance()
            .get(&DataKey::MarketSnapshot)
            .ok_or(Error::MarketStateMismatch)?;
        if snapshot.state_version != market_state_version
            || snapshot.equity_if_yes != equity_if_yes
            || snapshot.equity_if_no != equity_if_no
            || snapshot.conditional_lp_fees != conditional_lp_fees
            || snapshot.updated_at != state_updated_at
        {
            return Err(Error::MarketStateMismatch);
        }
        let state_age = env
            .ledger()
            .timestamp()
            .checked_sub(snapshot.updated_at)
            .ok_or(Error::StaleMarketState)?;
        if state_age > maximum_state_age {
            return Err(Error::StaleMarketState);
        }

        let key = DataKey::Exit(exit_id.clone());
        let mut intent: ExitIntent = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::ExitNotFound)?;
        if intent.status != ExitStatus::Open
            || env.ledger().timestamp() > intent.expiry
            || shares > intent.shares_remaining
        {
            return Err(Error::InvalidExit);
        }
        let minimum_for_fill = if shares == intent.shares_remaining {
            intent.minimum_payment_remaining
        } else {
            let numerator = intent
                .minimum_payment_remaining
                .checked_mul(shares)
                .ok_or(Error::Arithmetic)?;
            numerator
                .checked_add(intent.shares_remaining - 1)
                .ok_or(Error::Arithmetic)?
                .checked_div(intent.shares_remaining)
                .ok_or(Error::Arithmetic)?
        };
        if payment < minimum_for_fill {
            return Err(Error::InvalidExit);
        }

        intent.shares_remaining = intent
            .shares_remaining
            .checked_sub(shares)
            .ok_or(Error::Arithmetic)?;
        intent.minimum_payment_remaining = intent
            .minimum_payment_remaining
            .checked_sub(minimum_for_fill)
            .ok_or(Error::Arithmetic)?;
        if intent.shares_remaining == 0 {
            intent.status = ExitStatus::Matched;
        }
        env.storage().persistent().set(&key, &intent);
        Self::bump_key(&env, &key);
        let locked = Self::get::<i128>(&env, &DataKey::Locked);
        env.storage().instance().set(
            &DataKey::Locked,
            &locked.checked_sub(shares).ok_or(Error::Arithmetic)?,
        );
        let state_version = Self::increment_version(&env)?;
        Self::bump(&env);
        LpExitUpdated {
            exit_id,
            shares_remaining: intent.shares_remaining,
            status: intent.status,
            state_version,
        }
        .publish(&env);
        Ok(ExitFill {
            shares_transferred: shares,
            shares_remaining: intent.shares_remaining,
            seller_payment: payment,
        })
    }

    pub fn cancel_exit(
        env: Env,
        controller: Address,
        exit_id: BytesN<32>,
        expected_version: u64,
    ) -> Result<(), Error> {
        Self::require_controller(&env, &controller)?;
        Self::require_version(&env, expected_version)?;
        let phase = Self::get::<Phase>(&env, &DataKey::Phase);
        if phase != Phase::Active && phase != Phase::Settled {
            return Err(Error::InvalidPhase);
        }
        let key = DataKey::Exit(exit_id.clone());
        let mut intent: ExitIntent = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::ExitNotFound)?;
        if intent.status != ExitStatus::Open {
            return Err(Error::InvalidExit);
        }
        let unlocked = intent.shares_remaining;
        intent.status = ExitStatus::Cancelled;
        intent.shares_remaining = 0;
        intent.minimum_payment_remaining = 0;
        env.storage().persistent().set(&key, &intent);
        Self::bump_key(&env, &key);
        let locked = Self::get::<i128>(&env, &DataKey::Locked);
        env.storage().instance().set(
            &DataKey::Locked,
            &locked.checked_sub(unlocked).ok_or(Error::Arithmetic)?,
        );
        let state_version = Self::increment_version(&env)?;
        Self::bump(&env);
        LpExitUpdated {
            exit_id,
            shares_remaining: 0,
            status: ExitStatus::Cancelled,
            state_version,
        }
        .publish(&env);
        Ok(())
    }

    pub fn exit(env: Env, exit_id: BytesN<32>) -> Option<ExitIntent> {
        let key = DataKey::Exit(exit_id);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_key(&env, &key);
        }
        value
    }

    pub fn record_terminal(
        env: Env,
        market: Address,
        returned_assets: i128,
        outcome: TerminalOutcome,
        expected_version: u64,
    ) -> Result<(), Error> {
        Self::require_market(&env, &market)?;
        Self::require_version(&env, expected_version)?;
        if Self::get::<Phase>(&env, &DataKey::Phase) != Phase::Active
            || returned_assets < 0
            || (outcome == TerminalOutcome::Void
                && returned_assets != Self::get::<i128>(&env, &DataKey::Funded))
        {
            return Err(Error::InvalidTerminalAssets);
        }
        Self::transfer_in_exact(&env, &market, returned_assets)?;
        env.storage()
            .instance()
            .set(&DataKey::TerminalAssets, &returned_assets);
        env.storage()
            .instance()
            .set(&DataKey::TerminalOutcome, &outcome);
        env.storage()
            .instance()
            .set(&DataKey::Phase, &Phase::Settled);
        let state_version = Self::increment_version(&env)?;
        Self::bump(&env);
        LpTerminal {
            proposal_id: Self::get(&env, &DataKey::Proposal),
            outcome,
            assets: returned_assets,
            state_version,
        }
        .publish(&env);
        Ok(())
    }

    pub fn redeem_terminal(
        env: Env,
        controller: Address,
        shares: i128,
        expected_version: u64,
    ) -> Result<i128, Error> {
        Self::require_controller(&env, &controller)?;
        Self::require_version(&env, expected_version)?;
        let phase = Self::get::<Phase>(&env, &DataKey::Phase);
        if phase != Phase::Cancelled && phase != Phase::Settled {
            return Err(Error::InvalidPhase);
        }
        let total_shares = Self::get::<i128>(&env, &DataKey::Shares);
        let locked = Self::get::<i128>(&env, &DataKey::Locked);
        if shares <= 0 || shares > total_shares.checked_sub(locked).ok_or(Error::Arithmetic)? {
            return Err(Error::InsufficientShares);
        }
        let assets = Self::get::<i128>(&env, &DataKey::TerminalAssets);
        let payout = if shares == total_shares {
            assets
        } else {
            shares
                .checked_mul(assets)
                .ok_or(Error::Arithmetic)?
                .checked_div(total_shares)
                .ok_or(Error::Arithmetic)?
        };
        let remaining_shares = total_shares.checked_sub(shares).ok_or(Error::Arithmetic)?;
        let remaining_assets = assets.checked_sub(payout).ok_or(Error::Arithmetic)?;
        env.storage()
            .instance()
            .set(&DataKey::Shares, &remaining_shares);
        env.storage()
            .instance()
            .set(&DataKey::TerminalAssets, &remaining_assets);
        if phase == Phase::Cancelled {
            env.storage()
                .instance()
                .set(&DataKey::Funded, &remaining_assets);
        }
        if remaining_shares == 0 {
            env.storage()
                .instance()
                .set(&DataKey::Phase, &Phase::Settled);
        }
        Self::transfer_out_exact(&env, &controller, payout)?;
        Self::increment_version(&env)?;
        Self::bump(&env);
        Ok(payout)
    }

    pub fn unallocated_balance(env: Env) -> Result<i128, Error> {
        let token = Self::get::<Address>(&env, &DataKey::Token);
        let raw = token::Client::new(&env, &token).balance(&env.current_contract_address());
        let phase = Self::get::<Phase>(&env, &DataKey::Phase);
        let accounted = match phase {
            Phase::Funding | Phase::Ready => Self::get::<i128>(&env, &DataKey::Funded),
            Phase::Cancelled | Phase::Settled => Self::get::<i128>(&env, &DataKey::TerminalAssets),
            Phase::Active => 0,
        };
        raw.checked_sub(accounted).ok_or(Error::TransferMismatch)
    }

    pub fn extend_ttl(env: Env) {
        Self::bump(&env);
    }

    fn require_controller(env: &Env, controller: &Address) -> Result<(), Error> {
        let stored = Self::get::<Address>(env, &DataKey::Controller);
        if *controller != stored {
            return Err(Error::WrongController);
        }
        controller.require_auth();
        Ok(())
    }

    fn require_factory(env: &Env, factory: &Address) -> Result<(), Error> {
        let stored = Self::get::<Address>(env, &DataKey::Factory);
        if *factory != stored {
            return Err(Error::WrongFactory);
        }
        factory.require_auth();
        Ok(())
    }

    fn require_market(env: &Env, market: &Address) -> Result<(), Error> {
        let stored: Option<Address> = env.storage().instance().get(&DataKey::Market);
        if stored.as_ref() != Some(market) {
            return Err(Error::WrongMarket);
        }
        market.require_auth();
        Ok(())
    }

    fn require_version(env: &Env, expected: u64) -> Result<(), Error> {
        if Self::get::<u64>(env, &DataKey::Version) != expected {
            return Err(Error::StaleState);
        }
        Ok(())
    }

    fn increment_version(env: &Env) -> Result<u64, Error> {
        let version = Self::get::<u64>(env, &DataKey::Version)
            .checked_add(1)
            .ok_or(Error::Arithmetic)?;
        env.storage().instance().set(&DataKey::Version, &version);
        Ok(version)
    }

    fn transfer_in_exact(env: &Env, from: &Address, amount: i128) -> Result<(), Error> {
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        if amount == 0 {
            return Ok(());
        }
        let token = Self::get::<Address>(env, &DataKey::Token);
        let client = token::Client::new(env, &token);
        let current = env.current_contract_address();
        let before = client.balance(&current);
        client.transfer(from, &current, &amount);
        let received = client
            .balance(&current)
            .checked_sub(before)
            .ok_or(Error::TransferMismatch)?;
        if received != amount {
            return Err(Error::TransferMismatch);
        }
        Ok(())
    }

    fn transfer_out_exact(env: &Env, to: &Address, amount: i128) -> Result<(), Error> {
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        if amount == 0 {
            return Ok(());
        }
        let token = Self::get::<Address>(env, &DataKey::Token);
        let client = token::Client::new(env, &token);
        let current = env.current_contract_address();
        let before = client.balance(&current);
        client.transfer(&current, to, &amount);
        let spent = before
            .checked_sub(client.balance(&current))
            .ok_or(Error::TransferMismatch)?;
        if spent != amount {
            return Err(Error::TransferMismatch);
        }
        Ok(())
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

    fn bump_key(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}
