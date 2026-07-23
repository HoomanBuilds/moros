#![no_std]
//! LMSR prediction-market contract (Soroban).

mod math;

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, Symbol,
};

const MAX_PRIVATE_BATCH_SIZE: u32 = 64;

/// Which outcome a trade is on.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Yes,
    No,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Yes,
    No,
    Void,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    Open,
    Closed,
    Resolved,
    Voided,
}

/// Resolution parameters: the market resolves YES iff the Reflector price of
/// `asset` at/after `expiry` is >= `threshold` (threshold in the oracle's decimals).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketInfo {
    pub asset: Symbol,
    pub threshold: i128,
    pub expiry: u64,
    pub finalize_after: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivateMarketConfig {
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
pub struct FeeState {
    pub escrow: i128,
    pub rounding_receivable: i128,
    pub conditional_lp_fee: i128,
    pub conditional_protocol_fee: i128,
    pub vested: bool,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LiquidityOutcome {
    Yes,
    No,
    Void,
}

#[contractclient(crate_path = "soroban_sdk", name = "LiquidityVaultClient")]
pub trait LiquidityVault {
    fn unallocated_balance(env: Env) -> i128;
    fn state_version(env: Env) -> u64;
    fn record_terminal(
        env: Env,
        market: Address,
        returned_assets: i128,
        outcome: LiquidityOutcome,
        prior_unallocated_balance: i128,
        expected_version: u64,
    );
}

#[contracttype]
enum DataKey {
    Admin,
    Token,
    B,
    QYes,
    QNo,
    Outcome,
    Asset,
    Threshold,
    Expiry,
    FinalizeAfter,
    Decimals,
    Batcher,
    Resolver,
    Funding,
    BatchCollateral,
    AccountedBalance,
    LiquidityVault,
    RulesHash,
    FeeBps,
    LpFeeShareBps,
    LotSize,
    FixedBatchSize,
    MinimumSideCount,
    MaximumPriceMovement,
    StateVersion,
    FeeEscrow,
    RoundingReceivable,
    ConditionalLpFee,
    ConditionalProtocolFee,
    FeesVested,
    PrivateConfigured,
    LiquiditySettled,
    Refund(Address),
    Shares(Address, Side),
}

const MAX_Q: i128 = 1i128 << 60;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    InvalidParams = 3,
    InsufficientShares = 4,
    Unauthorized = 5,
    AlreadyResolved = 6,
    NotResolved = 7,
    Undersolvent = 8,
    MarketClosed = 9,
    TooEarlyToResolve = 10,
    ResolverLocked = 11,
    ConfigurationLocked = 12,
    AlreadySettled = 13,
    StaleState = 14,
}

#[contractevent(topics = ["created"], data_format = "vec")]
pub struct Created {
    pub asset: Symbol,
    pub threshold: i128,
    pub expiry: u64,
    pub finalize_after: u64,
    pub b: i128,
}

#[contractevent(topics = ["buy"], data_format = "vec")]
pub struct Buy {
    #[topic]
    pub trader: Address,
    pub side: Side,
    pub shares: i128,
    pub cost: i128,
    pub qy: i128,
    pub qn: i128,
}

#[contractevent(topics = ["sell"], data_format = "vec")]
pub struct Sell {
    #[topic]
    pub trader: Address,
    pub side: Side,
    pub shares: i128,
    pub refund: i128,
    pub qy: i128,
    pub qn: i128,
}

#[contractevent(topics = ["fund"], data_format = "vec")]
pub struct Fund {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["resolved"], data_format = "single-value")]
pub struct Resolved {
    pub outcome: Outcome,
}

#[contractevent(topics = ["voided"], data_format = "vec")]
pub struct Voided {
    pub pool_refund: i128,
    pub sponsor_refund: i128,
}

#[contractevent(topics = ["batch"], data_format = "vec")]
pub struct Batch {
    #[topic]
    pub batcher: Address,
    pub dqyes: i128,
    pub dqno: i128,
    pub qy: i128,
    pub qn: i128,
    pub net: i128,
}

#[contractevent(topics = ["private_batch"], data_format = "vec")]
pub struct PrivateBatch {
    pub state_version: u64,
    pub yes_count: u32,
    pub no_count: u32,
    pub yes_price: i128,
    pub no_price: i128,
    pub yes_charge_per_position: i128,
    pub no_charge_per_position: i128,
    pub market_charge: i128,
    pub rounding_contribution: i128,
    pub fee_escrow: i128,
}

#[contractevent(topics = ["redeem"], data_format = "vec")]
pub struct Redeem {
    #[topic]
    pub trader: Address,
    pub side: Side,
    pub payout: i128,
}

#[contractevent(topics = ["private_activated"], data_format = "vec")]
pub struct PrivateActivated {
    pub batcher: Address,
    pub liquidity_vault: Address,
    pub resolver: Address,
    pub funding: i128,
    pub fee_bps: u32,
    pub lp_fee_share_bps: u32,
    pub lot_size: i128,
    pub fixed_batch_size: u32,
    pub minimum_side_count: u32,
    pub maximum_price_movement: i128,
}

#[contractevent(topics = ["liquidity_settled"], data_format = "vec")]
pub struct LiquiditySettled {
    pub liquidity_vault: Address,
    pub assets: i128,
    pub outcome: Outcome,
}

#[contractevent(topics = ["fees_vested"], data_format = "vec")]
pub struct FeesVested {
    pub lp_fee: i128,
    pub protocol_fee: i128,
    pub rounding_reimbursement: i128,
    pub state_version: u64,
}

#[contract]
pub struct LmsrMarket;

#[contractimpl]
impl LmsrMarket {
    fn return_liquidity(
        env: &Env,
        assets: i128,
        liquidity_outcome: LiquidityOutcome,
        market_outcome: Outcome,
    ) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&DataKey::LiquiditySettled)
            .unwrap_or(false)
        {
            return Err(Error::AlreadySettled);
        }
        let liquidity_vault: Address = env
            .storage()
            .instance()
            .get(&DataKey::LiquidityVault)
            .ok_or(Error::NotInitialized)?;
        let client = LiquidityVaultClient::new(env, &liquidity_vault);
        let prior_unallocated = client.unallocated_balance();
        let liquidity_version = client.state_version();
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let current = env.current_contract_address();
        Self::transfer_accounted_out(env, &token_addr, &liquidity_vault, assets)?;
        client.record_terminal(
            &current,
            &assets,
            &liquidity_outcome,
            &prior_unallocated,
            &liquidity_version,
        );
        env.storage()
            .instance()
            .set(&DataKey::LiquiditySettled, &true);
        LiquiditySettled {
            liquidity_vault,
            assets,
            outcome: market_outcome,
        }
        .publish(env);
        Ok(())
    }

    /// Constructor (runs atomically at deploy and cannot be front-run). Sets the
    /// `admin`, `collateral` token (SEP-41), liquidity parameter `b` (fixed-point,
    /// value * 2^32), and resolution parameters (`asset` / `threshold` / `expiry`).
    /// Worst-case operator loss is `b * ln 2`.
    pub fn __constructor(
        env: Env,
        admin: Address,
        collateral: Address,
        b: i128,
        asset: Symbol,
        threshold: i128,
        expiry: u64,
        batch_grace: u64,
    ) {
        if b <= 0 || b > MAX_Q || batch_grace > 86_400 {
            panic_with_error!(&env, Error::InvalidParams);
        }
        let finalize_after = expiry
            .checked_add(batch_grace)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidParams));
        let decimals = token::Client::new(&env, &collateral).decimals();
        if decimals > 18 {
            panic_with_error!(&env, Error::InvalidParams);
        }
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Token, &collateral);
        s.set(&DataKey::B, &b);
        s.set(&DataKey::QYes, &0i128);
        s.set(&DataKey::QNo, &0i128);
        s.set(&DataKey::Asset, &asset);
        s.set(&DataKey::Threshold, &threshold);
        s.set(&DataKey::Expiry, &expiry);
        s.set(&DataKey::FinalizeAfter, &finalize_after);
        s.set(&DataKey::Decimals, &decimals);
        s.set(&DataKey::Funding, &0i128);
        s.set(&DataKey::BatchCollateral, &0i128);
        s.set(&DataKey::StateVersion, &0u64);
        s.set(&DataKey::FeeEscrow, &0i128);
        s.set(&DataKey::RoundingReceivable, &0i128);
        s.set(&DataKey::ConditionalLpFee, &0i128);
        s.set(&DataKey::ConditionalProtocolFee, &0i128);
        s.set(&DataKey::FeesVested, &false);
        Created {
            asset,
            threshold,
            expiry,
            finalize_after,
            b,
        }
        .publish(&env);
        Self::bump(&env);
    }

    /// Resolution parameters (asset / threshold / expiry).
    pub fn market_info(env: Env) -> Result<MarketInfo, Error> {
        let s = env.storage().instance();
        Ok(MarketInfo {
            asset: s.get(&DataKey::Asset).ok_or(Error::NotInitialized)?,
            threshold: s.get(&DataKey::Threshold).ok_or(Error::NotInitialized)?,
            expiry: s.get(&DataKey::Expiry).ok_or(Error::NotInitialized)?,
            finalize_after: s
                .get(&DataKey::FinalizeAfter)
                .ok_or(Error::NotInitialized)?,
        })
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Current YES price (fixed-point in (0,1), value * 2^32).
    pub fn price_yes(env: Env) -> Result<i128, Error> {
        let (qy, qn, b) = Self::state(&env)?;
        Ok(math::price_yes(qy, qn, b))
    }

    /// Current LMSR cost function value (fixed-point, value * 2^32).
    pub fn cost(env: Env) -> Result<i128, Error> {
        let (qy, qn, b) = Self::state(&env)?;
        Ok(math::cost(qy, qn, b))
    }

    /// (q_yes, q_no, b), the current market quantities in fixed-point form.
    pub fn get_state(env: Env) -> Result<(i128, i128, i128), Error> {
        Self::state(&env)
    }

    pub fn required_funding(env: Env) -> Result<i128, Error> {
        let (_, _, b) = Self::state(&env)?;
        Ok(Self::to_atomic(&env, math::initial_loss_bound(b), true))
    }

    pub fn state_version(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::StateVersion)
            .unwrap_or(0)
    }

    pub fn fee_state(env: Env) -> FeeState {
        let storage = env.storage().instance();
        FeeState {
            escrow: storage.get(&DataKey::FeeEscrow).unwrap_or(0),
            rounding_receivable: storage.get(&DataKey::RoundingReceivable).unwrap_or(0),
            conditional_lp_fee: storage.get(&DataKey::ConditionalLpFee).unwrap_or(0),
            conditional_protocol_fee: storage.get(&DataKey::ConditionalProtocolFee).unwrap_or(0),
            vested: storage.get(&DataKey::FeesVested).unwrap_or(false),
        }
    }

    pub fn private_config(env: Env) -> Option<PrivateMarketConfig> {
        if !env
            .storage()
            .instance()
            .get(&DataKey::PrivateConfigured)
            .unwrap_or(false)
        {
            return None;
        }
        let storage = env.storage().instance();
        Some(PrivateMarketConfig {
            batcher: storage.get(&DataKey::Batcher).unwrap(),
            liquidity_vault: storage.get(&DataKey::LiquidityVault).unwrap(),
            resolver: storage.get(&DataKey::Resolver).unwrap(),
            rules_hash: storage.get(&DataKey::RulesHash).unwrap(),
            funding: storage.get(&DataKey::Funding).unwrap_or(0),
            fee_bps: storage.get(&DataKey::FeeBps).unwrap_or(0),
            lp_fee_share_bps: storage.get(&DataKey::LpFeeShareBps).unwrap_or(0),
            lot_size: storage.get(&DataKey::LotSize).unwrap_or(0),
            fixed_batch_size: storage.get(&DataKey::FixedBatchSize).unwrap_or(0),
            minimum_side_count: storage.get(&DataKey::MinimumSideCount).unwrap_or(0),
            maximum_price_movement: storage.get(&DataKey::MaximumPriceMovement).unwrap_or(0),
        })
    }

    pub fn activate_private(
        env: Env,
        factory: Address,
        config: PrivateMarketConfig,
    ) -> Result<(), Error> {
        factory.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if factory != admin {
            return Err(Error::Unauthorized);
        }
        let storage = env.storage().instance();
        if storage.has(&DataKey::PrivateConfigured)
            || storage.has(&DataKey::Batcher)
            || storage.has(&DataKey::Resolver)
            || storage.get::<_, i128>(&DataKey::Funding).unwrap_or(0) != 0
        {
            return Err(Error::ConfigurationLocked);
        }
        let (qy, qn, _) = Self::state(&env)?;
        let decimals: u32 = storage
            .get(&DataKey::Decimals)
            .ok_or(Error::NotInitialized)?;
        if qy != 0
            || qn != 0
            || decimals != 7
            || config.funding < Self::required_funding(env.clone())?
            || config.fee_bps > 1_000
            || config.lp_fee_share_bps > 10_000
            || config.lot_size <= 0
            || config.lot_size > MAX_Q
            || config.fixed_batch_size < 8
            || config.fixed_batch_size > MAX_PRIVATE_BATCH_SIZE
            || config.minimum_side_count < 2
            || config
                .minimum_side_count
                .checked_mul(2)
                .is_none_or(|count| count > config.fixed_batch_size)
            || config.maximum_price_movement <= 0
            || config.maximum_price_movement > math::SCALE
            || Self::is_zero_bytes(&config.rules_hash)
        {
            return Err(Error::InvalidParams);
        }
        let token_addr: Address = storage.get(&DataKey::Token).ok_or(Error::NotInitialized)?;
        if token::Client::new(&env, &token_addr).balance(&env.current_contract_address())
            < config.funding
        {
            return Err(Error::Undersolvent);
        }
        storage.set(&DataKey::Batcher, &config.batcher);
        storage.set(&DataKey::LiquidityVault, &config.liquidity_vault);
        storage.set(&DataKey::Resolver, &config.resolver);
        storage.set(&DataKey::RulesHash, &config.rules_hash);
        storage.set(&DataKey::Funding, &config.funding);
        storage.set(&DataKey::FeeBps, &config.fee_bps);
        storage.set(&DataKey::LpFeeShareBps, &config.lp_fee_share_bps);
        storage.set(&DataKey::LotSize, &config.lot_size);
        storage.set(&DataKey::FixedBatchSize, &config.fixed_batch_size);
        storage.set(&DataKey::MinimumSideCount, &config.minimum_side_count);
        storage.set(
            &DataKey::MaximumPriceMovement,
            &config.maximum_price_movement,
        );
        storage.set(&DataKey::AccountedBalance, &config.funding);
        storage.set(&DataKey::PrivateConfigured, &true);
        PrivateActivated {
            batcher: config.batcher,
            liquidity_vault: config.liquidity_vault,
            resolver: config.resolver,
            funding: config.funding,
            fee_bps: config.fee_bps,
            lp_fee_share_bps: config.lp_fee_share_bps,
            lot_size: config.lot_size,
            fixed_batch_size: config.fixed_batch_size,
            minimum_side_count: config.minimum_side_count,
            maximum_price_movement: config.maximum_price_movement,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(())
    }

    pub fn extend_ttl(env: Env) {
        Self::bump(&env);
    }

    /// Collateral cost to buy `shares` (fixed-point) of `side`.
    /// Rounded UP by one unit (pool-favoring) so per-trade truncation never undercharges.
    pub fn quote_buy(env: Env, side: Side, shares: i128) -> Result<i128, Error> {
        Self::ensure_direct_trading(&env)?;
        Self::ensure_open(&env)?;
        if shares <= 0 || shares > MAX_Q {
            return Err(Error::InvalidParams);
        }
        let (qy, qn, b) = Self::state(&env)?;
        let before = math::cost(qy, qn, b);
        let (qy2, qn2) = Self::apply(qy, qn, side, shares);
        if qy2 > MAX_Q || qn2 > MAX_Q {
            return Err(Error::InvalidParams);
        }
        let after = math::cost(qy2, qn2, b);
        Ok(Self::to_atomic(&env, after - before, true)) // charge rounded up
    }

    /// Buy `shares` (fixed-point) of `side` for `trader`. Charges `quote_buy` collateral,
    /// credits the shares, and moves the market quantities. Returns the amount charged.
    pub fn buy(env: Env, trader: Address, side: Side, shares: i128) -> Result<i128, Error> {
        trader.require_auth();
        let cost = Self::quote_buy(env.clone(), side, shares)?;

        let key = DataKey::Shares(trader.clone(), side);
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let updated_held = held.checked_add(shares).ok_or(Error::InvalidParams)?;
        env.storage().persistent().set(&key, &updated_held);

        let (qy, qn, _b) = Self::state(&env)?;
        let (qy2, qn2) = Self::apply(qy, qn, side, shares);
        env.storage().instance().set(&DataKey::QYes, &qy2);
        env.storage().instance().set(&DataKey::QNo, &qn2);
        Self::bump(&env);
        Self::bump_shares(&env, &key);

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        token::Client::new(&env, &token_addr).transfer(
            &trader,
            &env.current_contract_address(),
            &cost,
        );
        let refund_key = DataKey::Refund(trader.clone());
        let refundable: i128 = env.storage().persistent().get(&refund_key).unwrap_or(0);
        let updated_refund = refundable.checked_add(cost).ok_or(Error::InvalidParams)?;
        env.storage().persistent().set(&refund_key, &updated_refund);
        Self::bump_shares(&env, &refund_key);

        Buy {
            trader,
            side,
            shares,
            cost,
            qy: qy2,
            qn: qn2,
        }
        .publish(&env);
        Ok(cost)
    }

    /// Collateral refunded to sell `shares` (fixed-point) of `side`.
    /// Rounded DOWN by one unit (pool-favoring). Errors if it would drive q negative.
    pub fn quote_sell(env: Env, side: Side, shares: i128) -> Result<i128, Error> {
        Self::ensure_direct_trading(&env)?;
        Self::ensure_open(&env)?;
        if shares <= 0 {
            return Err(Error::InvalidParams);
        }
        let (qy, qn, b) = Self::state(&env)?;
        let (qy2, qn2) = Self::reduce(qy, qn, side, shares)?;
        let before = math::cost(qy, qn, b);
        let after = math::cost(qy2, qn2, b);
        let refund_fixed = before - after;
        Ok(if refund_fixed > 0 {
            Self::to_atomic(&env, refund_fixed, false) // refund rounded down
        } else {
            0
        })
    }

    /// Sell `shares` (fixed-point) of `side` held by `trader`. Debits the shares,
    /// moves the market quantities, and pays `quote_sell` collateral back. Returns the refund.
    pub fn sell(env: Env, trader: Address, side: Side, shares: i128) -> Result<i128, Error> {
        trader.require_auth();
        let key = DataKey::Shares(trader.clone(), side);
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if shares <= 0 || held < shares {
            return Err(Error::InsufficientShares);
        }
        let refund = Self::quote_sell(env.clone(), side, shares)?;

        env.storage().persistent().set(&key, &(held - shares));

        let (qy, qn, _b) = Self::state(&env)?;
        let (qy2, qn2) = Self::reduce(qy, qn, side, shares)?;
        env.storage().instance().set(&DataKey::QYes, &qy2);
        env.storage().instance().set(&DataKey::QNo, &qn2);
        Self::bump(&env);
        Self::bump_shares(&env, &key);

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &trader,
            &refund,
        );
        let refund_key = DataKey::Refund(trader.clone());
        let refundable: i128 = env.storage().persistent().get(&refund_key).unwrap_or(0);
        if refund > refundable {
            return Err(Error::Undersolvent);
        }
        env.storage()
            .persistent()
            .set(&refund_key, &(refundable - refund));
        Self::bump_shares(&env, &refund_key);

        Sell {
            trader,
            side,
            shares,
            refund,
            qy: qy2,
            qn: qn2,
        }
        .publish(&env);
        Ok(refund)
    }

    /// Shares (fixed-point) held by `trader` on `side`.
    pub fn shares_of(env: Env, trader: Address, side: Side) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Shares(trader, side))
            .unwrap_or(0)
    }

    pub fn set_resolver(env: Env, admin: Address, resolver: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        if env.storage().instance().has(&DataKey::Resolver) {
            return Err(Error::ResolverLocked);
        }
        env.storage().instance().set(&DataKey::Resolver, &resolver);
        Self::bump(&env);
        Ok(())
    }

    pub fn resolver(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Resolver)
    }

    pub fn batcher(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Batcher)
    }

    pub fn collateral(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }

    pub fn resolve(env: Env, caller: Address, outcome: Outcome) -> Result<(), Error> {
        caller.require_auth();
        Self::require_resolver(&env, &caller)?;
        if env.storage().instance().has(&DataKey::Outcome) {
            return Err(Error::AlreadyResolved);
        }
        if outcome == Outcome::Void {
            return Err(Error::InvalidParams);
        }
        Self::ensure_finalizable(&env)?;
        let (qy, qn, _b) = Self::state(&env)?;
        if qy == 0 || qn == 0 {
            return Self::void_market(&env);
        }
        let q_win = match outcome {
            Outcome::Yes => qy,
            Outcome::No => qn,
            Outcome::Void => 0,
        };
        let liability = Self::to_atomic(&env, q_win, true);
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let held = token::Client::new(&env, &token_addr).balance(&env.current_contract_address());
        if held < liability {
            return Err(Error::Undersolvent);
        }
        env.storage().instance().set(&DataKey::Outcome, &outcome);
        Self::increment_state_version(&env)?;
        Resolved { outcome }.publish(&env);
        Self::bump(&env);
        Ok(())
    }

    pub fn outcome(env: Env) -> Option<Outcome> {
        env.storage().instance().get(&DataKey::Outcome)
    }

    pub fn status(env: Env) -> MarketStatus {
        match Self::outcome(env.clone()) {
            Some(Outcome::Void) => MarketStatus::Voided,
            Some(_) => MarketStatus::Resolved,
            None => {
                let expiry: u64 = env.storage().instance().get(&DataKey::Expiry).unwrap_or(0);
                if env.ledger().timestamp() < expiry {
                    MarketStatus::Open
                } else {
                    MarketStatus::Closed
                }
            }
        }
    }

    pub fn void(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_resolver(&env, &caller)?;
        if env.storage().instance().has(&DataKey::Outcome) {
            return Err(Error::AlreadyResolved);
        }
        Self::ensure_finalizable(&env)?;
        Self::void_market(&env)
    }

    fn void_market(env: &Env) -> Result<(), Error> {
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let held = token::Client::new(&env, &token_addr).balance(&env.current_contract_address());
        let funding: i128 = env.storage().instance().get(&DataKey::Funding).unwrap_or(0);
        if held < funding {
            return Err(Error::Undersolvent);
        }
        let pool_refund: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCollateral)
            .unwrap_or(0);
        let reserved = funding
            .checked_add(pool_refund)
            .ok_or(Error::Undersolvent)?;
        if held < reserved {
            return Err(Error::Undersolvent);
        }
        if pool_refund > 0 {
            let batcher: Address = env
                .storage()
                .instance()
                .get(&DataKey::Batcher)
                .ok_or(Error::NotInitialized)?;
            if env.storage().instance().has(&DataKey::PrivateConfigured) {
                Self::transfer_accounted_out(env, &token_addr, &batcher, pool_refund)?;
            } else {
                token::Client::new(env, &token_addr).transfer(
                    &env.current_contract_address(),
                    &batcher,
                    &pool_refund,
                );
            }
        }
        if funding > 0 {
            if env.storage().instance().has(&DataKey::PrivateConfigured) {
                Self::return_liquidity(env, funding, LiquidityOutcome::Void, Outcome::Void)?;
            } else {
                let sponsor: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Admin)
                    .ok_or(Error::NotInitialized)?;
                token::Client::new(env, &token_addr).transfer(
                    &env.current_contract_address(),
                    &sponsor,
                    &funding,
                );
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::Outcome, &Outcome::Void);
        Self::increment_state_version(env)?;
        Voided {
            pool_refund,
            sponsor_refund: funding,
        }
        .publish(env);
        Self::bump(env);
        Ok(())
    }

    /// Add collateral subsidy/liquidity to the pool. Fund at least `b * ln 2`
    /// (the LMSR worst-case loss) so winning redemptions are always solvent.
    pub fn fund(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::ensure_open(&env)?;
        if env.storage().instance().has(&DataKey::PrivateConfigured) {
            return Err(Error::ConfigurationLocked);
        }
        if amount <= 0 {
            return Err(Error::InvalidParams);
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if from != admin {
            return Err(Error::Unauthorized);
        }
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        token::Client::new(&env, &token_addr).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        let funding: i128 = env.storage().instance().get(&DataKey::Funding).unwrap_or(0);
        let updated_funding = funding.checked_add(amount).ok_or(Error::InvalidParams)?;
        env.storage()
            .instance()
            .set(&DataKey::Funding, &updated_funding);
        Fund { from, amount }.publish(&env);
        Self::bump(&env);
        Ok(())
    }

    pub fn set_batcher(env: Env, admin: Address, batcher: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        if env.storage().instance().has(&DataKey::Batcher) {
            return Err(Error::ConfigurationLocked);
        }
        let (qy, qn, _) = Self::state(&env)?;
        if qy != 0 || qn != 0 {
            return Err(Error::InvalidParams);
        }
        env.storage().instance().set(&DataKey::Batcher, &batcher);
        Self::bump(&env);
        Ok(())
    }

    pub fn quote_private_batch(
        env: Env,
        expected_version: u64,
        yes_count: u32,
        no_count: u32,
    ) -> Result<BatchQuote, Error> {
        Self::ensure_batchable(&env)?;
        if !env.storage().instance().has(&DataKey::PrivateConfigured) {
            return Err(Error::ConfigurationLocked);
        }
        if Self::state_version(env.clone()) != expected_version {
            return Err(Error::StaleState);
        }
        let config = Self::private_config(env.clone()).ok_or(Error::NotInitialized)?;
        let batch_size = yes_count
            .checked_add(no_count)
            .ok_or(Error::InvalidParams)?;
        if batch_size != config.fixed_batch_size
            || yes_count < config.minimum_side_count
            || no_count < config.minimum_side_count
        {
            return Err(Error::InvalidParams);
        }

        let delta_yes = config
            .lot_size
            .checked_mul(i128::from(yes_count))
            .ok_or(Error::InvalidParams)?;
        let delta_no = config
            .lot_size
            .checked_mul(i128::from(no_count))
            .ok_or(Error::InvalidParams)?;
        let (q_yes, q_no, b) = Self::state(&env)?;
        let next_yes = q_yes
            .checked_add(delta_yes)
            .filter(|value| *value <= MAX_Q)
            .ok_or(Error::InvalidParams)?;
        let next_no = q_no
            .checked_add(delta_no)
            .filter(|value| *value <= MAX_Q)
            .ok_or(Error::InvalidParams)?;

        let before = math::cost(q_yes, q_no, b);
        let after = math::cost(next_yes, next_no, b);
        let aggregate_market_charge = Self::to_atomic(&env, after - before, true);
        let pre_yes_price = math::price_yes(q_yes, q_no, b);
        let post_yes_price = math::price_yes(next_yes, next_no, b);
        let movement = if post_yes_price >= pre_yes_price {
            post_yes_price - pre_yes_price
        } else {
            pre_yes_price - post_yes_price
        };
        if movement > config.maximum_price_movement {
            return Err(Error::InvalidParams);
        }

        let yes_price = math::average_yes_price(q_yes, q_no, delta_yes, delta_no, b);
        let no_price = math::SCALE
            .checked_sub(yes_price)
            .ok_or(Error::InvalidParams)?;
        let yes_weight = math::multiply_fixed(delta_yes, yes_price);
        let no_weight = math::multiply_fixed(delta_no, no_price);
        let (yes_market_cost, no_market_cost) =
            Self::allocate_side_costs(aggregate_market_charge, yes_weight, no_weight)?;
        let yes_charge_per_position = yes_market_cost
            .checked_div(i128::from(yes_count))
            .ok_or(Error::InvalidParams)?;
        let no_charge_per_position = no_market_cost
            .checked_div(i128::from(no_count))
            .ok_or(Error::InvalidParams)?;
        let rounding_contribution = yes_market_cost
            .checked_sub(
                yes_charge_per_position
                    .checked_mul(i128::from(yes_count))
                    .ok_or(Error::InvalidParams)?,
            )
            .and_then(|yes_remainder| {
                no_market_cost
                    .checked_sub(no_charge_per_position.checked_mul(i128::from(no_count))?)
                    .and_then(|no_remainder| yes_remainder.checked_add(no_remainder))
            })
            .ok_or(Error::InvalidParams)?;
        if rounding_contribution < 0 || rounding_contribution >= i128::from(batch_size) {
            return Err(Error::InvalidParams);
        }

        let risk = math::multiply_fixed(yes_price, no_price);
        let rate = i128::from(config.fee_bps)
            .checked_mul(math::SCALE)
            .and_then(|value| value.checked_div(10_000))
            .ok_or(Error::InvalidParams)?;
        let fee_fixed = math::multiply_fixed(math::multiply_fixed(config.lot_size, risk), rate);
        let fee_per_position = Self::to_atomic(&env, fee_fixed, true);
        let fee_escrow = fee_per_position
            .checked_mul(i128::from(batch_size))
            .ok_or(Error::InvalidParams)?;
        if fee_escrow < rounding_contribution {
            return Err(Error::InvalidParams);
        }
        let distributable_fee = fee_escrow - rounding_contribution;
        let conditional_lp_fee = distributable_fee
            .checked_mul(i128::from(config.lp_fee_share_bps))
            .and_then(|value| value.checked_div(10_000))
            .ok_or(Error::InvalidParams)?;
        let conditional_protocol_fee = distributable_fee
            .checked_sub(conditional_lp_fee)
            .ok_or(Error::InvalidParams)?;

        let projected_assets = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::AccountedBalance)
            .ok_or(Error::NotInitialized)?
            .checked_add(aggregate_market_charge)
            .ok_or(Error::InvalidParams)?;
        let yes_liability = Self::to_atomic(&env, next_yes, false);
        let no_liability = Self::to_atomic(&env, next_no, false);
        if projected_assets < yes_liability || projected_assets < no_liability {
            return Err(Error::Undersolvent);
        }

        Ok(BatchQuote {
            state_version: expected_version,
            batch_size,
            yes_count,
            no_count,
            pre_yes_price,
            post_yes_price,
            yes_price,
            no_price,
            aggregate_market_charge,
            yes_market_cost,
            no_market_cost,
            yes_charge_per_position,
            no_charge_per_position,
            rounding_contribution,
            fee_per_position,
            fee_escrow,
            conditional_lp_fee,
            conditional_protocol_fee,
        })
    }

    pub fn apply_private_batch(
        env: Env,
        batcher: Address,
        expected_version: u64,
        yes_count: u32,
        no_count: u32,
    ) -> Result<BatchQuote, Error> {
        batcher.require_auth();
        let configured: Address = env
            .storage()
            .instance()
            .get(&DataKey::Batcher)
            .ok_or(Error::NotInitialized)?;
        if batcher != configured {
            return Err(Error::Unauthorized);
        }
        let quote = Self::quote_private_batch(env.clone(), expected_version, yes_count, no_count)?;
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        token::Client::new(&env, &token_addr).transfer(
            &batcher,
            &env.current_contract_address(),
            &quote.aggregate_market_charge,
        );
        Self::apply_private_quote(&env, &batcher, quote)
    }

    pub fn apply_private_batch_received(
        env: Env,
        batcher: Address,
        expected_version: u64,
        yes_count: u32,
        no_count: u32,
        prior_unallocated_balance: i128,
    ) -> Result<BatchQuote, Error> {
        batcher.require_auth();
        let configured: Address = env
            .storage()
            .instance()
            .get(&DataKey::Batcher)
            .ok_or(Error::NotInitialized)?;
        if batcher != configured {
            return Err(Error::Unauthorized);
        }
        if prior_unallocated_balance < 0 {
            return Err(Error::InvalidParams);
        }
        let quote = Self::quote_private_batch(env.clone(), expected_version, yes_count, no_count)?;
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let raw = token::Client::new(&env, &token_addr).balance(&env.current_contract_address());
        let accounted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::AccountedBalance)
            .ok_or(Error::NotInitialized)?;
        if raw
            != accounted
                .checked_add(prior_unallocated_balance)
                .and_then(|value| value.checked_add(quote.aggregate_market_charge))
                .ok_or(Error::InvalidParams)?
        {
            return Err(Error::Undersolvent);
        }
        Self::apply_private_quote(&env, &batcher, quote)
    }

    pub fn quote_batch(env: Env, dqyes: i128, dqno: i128) -> Result<i128, Error> {
        Self::ensure_batchable(&env)?;
        if env.storage().instance().has(&DataKey::PrivateConfigured) {
            return Err(Error::ConfigurationLocked);
        }
        if dqyes < 0 || dqno < 0 {
            return Err(Error::InvalidParams);
        }
        let (qy, qn, b) = Self::state(&env)?;
        let qy2 = qy.checked_add(dqyes).ok_or(Error::InvalidParams)?;
        let qn2 = qn.checked_add(dqno).ok_or(Error::InvalidParams)?;
        if qy2 > MAX_Q || qn2 > MAX_Q {
            return Err(Error::InvalidParams);
        }
        let before = math::cost(qy, qn, b);
        let after = math::cost(qy2, qn2, b);
        Ok(Self::to_atomic(&env, after - before, true))
    }

    pub fn apply_batch(env: Env, batcher: Address, dqyes: i128, dqno: i128) -> Result<i128, Error> {
        batcher.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Batcher)
            .ok_or(Error::NotInitialized)?;
        if batcher != stored {
            return Err(Error::Unauthorized);
        }
        Self::ensure_batchable(&env)?;
        let net = Self::quote_batch(env.clone(), dqyes, dqno)?;
        let (qy, qn, _b) = Self::state(&env)?;
        let qy2 = qy.checked_add(dqyes).ok_or(Error::InvalidParams)?;
        let qn2 = qn.checked_add(dqno).ok_or(Error::InvalidParams)?;

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        token::Client::new(&env, &token_addr).transfer(
            &batcher,
            &env.current_contract_address(),
            &net,
        );
        let batch_collateral: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCollateral)
            .unwrap_or(0);
        let updated_collateral = batch_collateral
            .checked_add(net)
            .ok_or(Error::InvalidParams)?;
        env.storage()
            .instance()
            .set(&DataKey::BatchCollateral, &updated_collateral);
        if env.storage().instance().has(&DataKey::PrivateConfigured) {
            Self::increase_accounted_balance(&env, net)?;
        }

        env.storage().instance().set(&DataKey::QYes, &qy2);
        env.storage().instance().set(&DataKey::QNo, &qn2);
        Self::credit_shares(&env, &batcher, dqyes, dqno);
        Self::bump(&env);
        Batch {
            batcher,
            dqyes,
            dqno,
            qy: qy2,
            qn: qn2,
            net,
        }
        .publish(&env);
        Ok(net)
    }

    fn credit_shares(env: &Env, holder: &Address, dqyes: i128, dqno: i128) {
        if dqyes > 0 {
            let ky = DataKey::Shares(holder.clone(), Side::Yes);
            let hy: i128 = env.storage().persistent().get(&ky).unwrap_or(0);
            env.storage().persistent().set(&ky, &(hy + dqyes));
            Self::bump_shares(env, &ky);
        }
        if dqno > 0 {
            let kn = DataKey::Shares(holder.clone(), Side::No);
            let hn: i128 = env.storage().persistent().get(&kn).unwrap_or(0);
            env.storage().persistent().set(&kn, &(hn + dqno));
            Self::bump_shares(env, &kn);
        }
    }

    /// Redeem `trader`'s `side` shares after resolution. Winning shares pay 1
    /// collateral each; losing shares pay 0. Shares are burned either way.
    pub fn redeem(env: Env, trader: Address, side: Side) -> Result<i128, Error> {
        trader.require_auth();
        let winning: Outcome = env
            .storage()
            .instance()
            .get(&DataKey::Outcome)
            .ok_or(Error::NotResolved)?;

        let key = DataKey::Shares(trader.clone(), side);
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &0i128); // burn regardless of outcome

        let payout = match winning {
            Outcome::Void => {
                let refund_key = DataKey::Refund(trader.clone());
                let refundable: i128 = env.storage().persistent().get(&refund_key).unwrap_or(0);
                env.storage().persistent().set(&refund_key, &0i128);
                Self::bump_shares(&env, &refund_key);
                refundable
            }
            Outcome::Yes if side == Side::Yes => Self::to_atomic(&env, held, false),
            Outcome::No if side == Side::No => Self::to_atomic(&env, held, false),
            _ => 0,
        };
        if payout > 0 {
            let token_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(Error::NotInitialized)?;
            if env.storage().instance().has(&DataKey::PrivateConfigured) {
                Self::transfer_accounted_out(&env, &token_addr, &trader, payout)?;
            } else {
                token::Client::new(&env, &token_addr).transfer(
                    &env.current_contract_address(),
                    &trader,
                    &payout,
                );
            }
        }
        Redeem {
            trader,
            side,
            payout,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(payout)
    }

    pub fn record_vested_fees(
        env: Env,
        batcher: Address,
        lp_fee: i128,
        prior_unallocated_balance: i128,
        expected_version: u64,
    ) -> Result<FeeState, Error> {
        batcher.require_auth();
        let configured: Address = env
            .storage()
            .instance()
            .get(&DataKey::Batcher)
            .ok_or(Error::NotInitialized)?;
        if batcher != configured {
            return Err(Error::Unauthorized);
        }
        if expected_version != Self::state_version(env.clone()) {
            return Err(Error::StaleState);
        }
        if prior_unallocated_balance < 0
            || env
                .storage()
                .instance()
                .get::<_, bool>(&DataKey::FeesVested)
                .unwrap_or(false)
        {
            return Err(Error::ConfigurationLocked);
        }
        match env
            .storage()
            .instance()
            .get::<_, Outcome>(&DataKey::Outcome)
        {
            Some(Outcome::Yes) | Some(Outcome::No) => {}
            _ => return Err(Error::NotResolved),
        }
        let fee_state = Self::fee_state(env.clone());
        if lp_fee != fee_state.conditional_lp_fee {
            return Err(Error::InvalidParams);
        }
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let raw = token::Client::new(&env, &token_addr).balance(&env.current_contract_address());
        let accounted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::AccountedBalance)
            .ok_or(Error::NotInitialized)?;
        if raw
            != accounted
                .checked_add(prior_unallocated_balance)
                .and_then(|value| value.checked_add(lp_fee))
                .ok_or(Error::InvalidParams)?
        {
            return Err(Error::Undersolvent);
        }
        Self::increase_accounted_balance(&env, lp_fee)?;
        env.storage().instance().set(&DataKey::FeesVested, &true);
        let state_version = Self::increment_state_version(&env)?;
        FeesVested {
            lp_fee,
            protocol_fee: fee_state.conditional_protocol_fee,
            rounding_reimbursement: fee_state.rounding_receivable,
            state_version,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(Self::fee_state(env))
    }

    pub fn settle_liquidity(env: Env) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::PrivateConfigured) {
            return Err(Error::InvalidParams);
        }
        if env
            .storage()
            .instance()
            .get(&DataKey::LiquiditySettled)
            .unwrap_or(false)
        {
            return Err(Error::AlreadySettled);
        }
        let outcome: Outcome = env
            .storage()
            .instance()
            .get(&DataKey::Outcome)
            .ok_or(Error::NotResolved)?;
        let liquidity_outcome = match outcome {
            Outcome::Yes => LiquidityOutcome::Yes,
            Outcome::No => LiquidityOutcome::No,
            Outcome::Void => return Err(Error::AlreadySettled),
        };
        let fee_state = Self::fee_state(env.clone());
        if fee_state.escrow > 0 && !fee_state.vested {
            return Err(Error::InvalidParams);
        }
        let batcher: Address = env
            .storage()
            .instance()
            .get(&DataKey::Batcher)
            .ok_or(Error::NotInitialized)?;
        let yes_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Shares(batcher.clone(), Side::Yes))
            .unwrap_or(0);
        let no_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Shares(batcher, Side::No))
            .unwrap_or(0);
        if yes_shares != 0 || no_shares != 0 {
            return Err(Error::InsufficientShares);
        }
        let assets = env
            .storage()
            .instance()
            .get(&DataKey::AccountedBalance)
            .ok_or(Error::NotInitialized)?;
        Self::return_liquidity(&env, assets, liquidity_outcome, outcome)?;
        Self::increment_state_version(&env)?;
        Self::bump(&env);
        Ok(assets)
    }

    pub fn unallocated_balance(env: Env) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::PrivateConfigured) {
            return Err(Error::InvalidParams);
        }
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let raw = token::Client::new(&env, &token_addr).balance(&env.current_contract_address());
        let accounted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::AccountedBalance)
            .unwrap_or(0);
        raw.checked_sub(accounted).ok_or(Error::Undersolvent)
    }
}

impl LmsrMarket {
    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn bump_shares(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn require_resolver(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        let resolver: Option<Address> = env.storage().instance().get(&DataKey::Resolver);
        match resolver {
            Some(address) if &address == caller => Ok(()),
            None if &admin == caller => Ok(()),
            _ => Err(Error::Unauthorized),
        }
    }

    fn ensure_open(env: &Env) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Outcome) {
            return Err(Error::AlreadyResolved);
        }
        let expiry: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Expiry)
            .ok_or(Error::NotInitialized)?;
        if env.ledger().timestamp() >= expiry {
            return Err(Error::MarketClosed);
        }
        Ok(())
    }

    fn ensure_direct_trading(env: &Env) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Batcher) {
            return Err(Error::ConfigurationLocked);
        }
        Ok(())
    }

    fn ensure_batchable(env: &Env) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Outcome) {
            return Err(Error::AlreadyResolved);
        }
        let finalize_after: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FinalizeAfter)
            .ok_or(Error::NotInitialized)?;
        if env.ledger().timestamp() >= finalize_after {
            return Err(Error::MarketClosed);
        }
        Ok(())
    }

    fn ensure_finalizable(env: &Env) -> Result<(), Error> {
        let finalize_after: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FinalizeAfter)
            .ok_or(Error::NotInitialized)?;
        if env.ledger().timestamp() < finalize_after {
            return Err(Error::TooEarlyToResolve);
        }
        Ok(())
    }

    fn state(env: &Env) -> Result<(i128, i128, i128), Error> {
        let s = env.storage().instance();
        let b: i128 = s.get(&DataKey::B).ok_or(Error::NotInitialized)?;
        let qy: i128 = s.get(&DataKey::QYes).unwrap_or(0);
        let qn: i128 = s.get(&DataKey::QNo).unwrap_or(0);
        Ok((qy, qn, b))
    }

    fn is_zero_bytes(value: &BytesN<32>) -> bool {
        value.to_array().iter().all(|byte| *byte == 0)
    }

    fn allocate_side_costs(
        total: i128,
        yes_weight: i128,
        no_weight: i128,
    ) -> Result<(i128, i128), Error> {
        let denominator = yes_weight
            .checked_add(no_weight)
            .filter(|value| *value > 0)
            .ok_or(Error::InvalidParams)?;
        let yes_numerator = total.checked_mul(yes_weight).ok_or(Error::InvalidParams)?;
        let no_numerator = total.checked_mul(no_weight).ok_or(Error::InvalidParams)?;
        let mut yes = yes_numerator
            .checked_div(denominator)
            .ok_or(Error::InvalidParams)?;
        let mut no = no_numerator
            .checked_div(denominator)
            .ok_or(Error::InvalidParams)?;
        let remaining = total
            .checked_sub(yes)
            .and_then(|value| value.checked_sub(no))
            .ok_or(Error::InvalidParams)?;
        if remaining < 0 || remaining > 1 {
            return Err(Error::InvalidParams);
        }
        if remaining == 1 {
            let yes_remainder = yes_numerator
                .checked_rem(denominator)
                .ok_or(Error::InvalidParams)?;
            let no_remainder = no_numerator
                .checked_rem(denominator)
                .ok_or(Error::InvalidParams)?;
            if yes_remainder >= no_remainder {
                yes = yes.checked_add(1).ok_or(Error::InvalidParams)?;
            } else {
                no = no.checked_add(1).ok_or(Error::InvalidParams)?;
            }
        }
        Ok((yes, no))
    }

    fn increase_total(env: &Env, key: DataKey, amount: i128) -> Result<(), Error> {
        let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(
            &key,
            &current.checked_add(amount).ok_or(Error::InvalidParams)?,
        );
        Ok(())
    }

    fn apply_private_quote(
        env: &Env,
        batcher: &Address,
        quote: BatchQuote,
    ) -> Result<BatchQuote, Error> {
        let config = Self::private_config(env.clone()).ok_or(Error::NotInitialized)?;
        let delta_yes = config
            .lot_size
            .checked_mul(i128::from(quote.yes_count))
            .ok_or(Error::InvalidParams)?;
        let delta_no = config
            .lot_size
            .checked_mul(i128::from(quote.no_count))
            .ok_or(Error::InvalidParams)?;
        Self::increase_accounted_balance(env, quote.aggregate_market_charge)?;
        let (q_yes, q_no, _) = Self::state(env)?;
        let next_yes = q_yes.checked_add(delta_yes).ok_or(Error::InvalidParams)?;
        let next_no = q_no.checked_add(delta_no).ok_or(Error::InvalidParams)?;
        env.storage().instance().set(&DataKey::QYes, &next_yes);
        env.storage().instance().set(&DataKey::QNo, &next_no);
        Self::credit_shares(env, batcher, delta_yes, delta_no);
        Self::increase_total(env, DataKey::BatchCollateral, quote.aggregate_market_charge)?;
        Self::increase_total(env, DataKey::FeeEscrow, quote.fee_escrow)?;
        Self::increase_total(
            env,
            DataKey::RoundingReceivable,
            quote.rounding_contribution,
        )?;
        Self::increase_total(env, DataKey::ConditionalLpFee, quote.conditional_lp_fee)?;
        Self::increase_total(
            env,
            DataKey::ConditionalProtocolFee,
            quote.conditional_protocol_fee,
        )?;
        let state_version = Self::increment_state_version(env)?;
        PrivateBatch {
            state_version,
            yes_count: quote.yes_count,
            no_count: quote.no_count,
            yes_price: quote.yes_price,
            no_price: quote.no_price,
            yes_charge_per_position: quote.yes_charge_per_position,
            no_charge_per_position: quote.no_charge_per_position,
            market_charge: quote.aggregate_market_charge,
            rounding_contribution: quote.rounding_contribution,
            fee_escrow: quote.fee_escrow,
        }
        .publish(env);
        Self::bump(env);
        Ok(quote)
    }

    fn increment_state_version(env: &Env) -> Result<u64, Error> {
        let next = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::StateVersion)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(Error::InvalidParams)?;
        env.storage().instance().set(&DataKey::StateVersion, &next);
        Ok(next)
    }

    fn increase_accounted_balance(env: &Env, amount: i128) -> Result<(), Error> {
        let accounted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::AccountedBalance)
            .ok_or(Error::NotInitialized)?;
        env.storage().instance().set(
            &DataKey::AccountedBalance,
            &accounted.checked_add(amount).ok_or(Error::InvalidParams)?,
        );
        Ok(())
    }

    fn transfer_accounted_out(
        env: &Env,
        token_addr: &Address,
        destination: &Address,
        amount: i128,
    ) -> Result<(), Error> {
        if amount < 0 {
            return Err(Error::InvalidParams);
        }
        let accounted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::AccountedBalance)
            .ok_or(Error::NotInitialized)?;
        if amount > accounted {
            return Err(Error::Undersolvent);
        }
        if amount > 0 {
            token::Client::new(env, token_addr).transfer(
                &env.current_contract_address(),
                destination,
                &amount,
            );
        }
        env.storage()
            .instance()
            .set(&DataKey::AccountedBalance, &(accounted - amount));
        Ok(())
    }

    fn apply(qy: i128, qn: i128, side: Side, shares: i128) -> (i128, i128) {
        match side {
            Side::Yes => (qy + shares, qn),
            Side::No => (qy, qn + shares),
        }
    }

    fn reduce(qy: i128, qn: i128, side: Side, shares: i128) -> Result<(i128, i128), Error> {
        match side {
            Side::Yes if shares <= qy => Ok((qy - shares, qn)),
            Side::No if shares <= qn => Ok((qy, qn - shares)),
            _ => Err(Error::InvalidParams),
        }
    }

    /// Convert a fixed-point (value * 2^32) amount to the collateral token's atomic
    /// units (value * 10^decimals). `up` rounds toward the pool (charges up, pays down).
    fn to_atomic(env: &Env, fixed: i128, up: bool) -> i128 {
        let decimals: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7);
        let scaled = fixed * 10i128.pow(decimals);
        if up {
            (scaled + (math::SCALE - 1)) / math::SCALE
        } else {
            scaled / math::SCALE
        }
    }
}

#[cfg(test)]
mod test;
