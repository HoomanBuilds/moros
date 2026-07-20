#![no_std]
//! LMSR prediction-market contract (Soroban).

mod math;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, Symbol, Vec,
};

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
    Committee,
    CommitteeT,
    Resolver,
    Funding,
    BatchCollateral,
    Refund(Address),
    Shares(Address, Side),
}

const MAX_Q: i128 = 1i128 << 60;
const TTL_THRESHOLD: u32 = 120_960;
const TTL_EXTEND_TO: u32 = 518_400;

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

#[contractevent(topics = ["cbatch"], data_format = "vec")]
pub struct CommitteeBatch {
    #[topic]
    pub funder: Address,
    pub signers: u32,
    pub dqyes: i128,
    pub dqno: i128,
    pub qy: i128,
    pub qn: i128,
    pub net: i128,
}

#[contractevent(topics = ["redeem"], data_format = "vec")]
pub struct Redeem {
    #[topic]
    pub trader: Address,
    pub side: Side,
    pub payout: i128,
}

#[contract]
pub struct LmsrMarket;

#[contractimpl]
impl LmsrMarket {
    /// Constructor (runs atomically at deploy — cannot be front-run). Sets the
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

    /// (q_yes, q_no, b) — current market quantities (fixed-point).
    pub fn get_state(env: Env) -> Result<(i128, i128, i128), Error> {
        Self::state(&env)
    }

    pub fn extend_ttl(env: Env) {
        Self::bump(&env);
    }

    /// Collateral cost to buy `shares` (fixed-point) of `side`.
    /// Rounded UP by one unit (pool-favoring) so per-trade truncation never undercharges.
    pub fn quote_buy(env: Env, side: Side, shares: i128) -> Result<i128, Error> {
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
        let sponsor: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if pool_refund > 0 {
            let batcher: Address = env
                .storage()
                .instance()
                .get(&DataKey::Batcher)
                .ok_or(Error::NotInitialized)?;
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &batcher,
                &pool_refund,
            );
        }
        if funding > 0 {
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &sponsor,
                &funding,
            );
        }
        env.storage()
            .instance()
            .set(&DataKey::Outcome, &Outcome::Void);
        Voided {
            pool_refund,
            sponsor_refund: funding,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(())
    }

    /// Add collateral subsidy/liquidity to the pool. Fund at least `b * ln 2`
    /// (the LMSR worst-case loss) so winning redemptions are always solvent.
    pub fn fund(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::ensure_open(&env)?;
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
        env.storage().instance().set(&DataKey::Batcher, &batcher);
        Self::bump(&env);
        Ok(())
    }

    pub fn quote_batch(env: Env, dqyes: i128, dqno: i128) -> Result<i128, Error> {
        Self::ensure_batchable(&env)?;
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

    pub fn set_committee(
        env: Env,
        admin: Address,
        members: Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        if threshold == 0 || members.len() < threshold {
            return Err(Error::InvalidParams);
        }
        env.storage().instance().set(&DataKey::Committee, &members);
        env.storage()
            .instance()
            .set(&DataKey::CommitteeT, &threshold);
        Self::bump(&env);
        Ok(())
    }

    pub fn apply_batch_committee(
        env: Env,
        signers: Vec<Address>,
        funder: Address,
        dqyes: i128,
        dqno: i128,
    ) -> Result<i128, Error> {
        let members: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Committee)
            .ok_or(Error::NotInitialized)?;
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CommitteeT)
            .ok_or(Error::NotInitialized)?;
        if signers.len() < threshold {
            return Err(Error::Unauthorized);
        }
        let mut seen: Vec<Address> = Vec::new(&env);
        for s in signers.iter() {
            if !members.contains(&s) || seen.contains(&s) {
                return Err(Error::Unauthorized);
            }
            s.require_auth();
            seen.push_back(s);
        }
        Self::ensure_batchable(&env)?;
        funder.require_auth();
        let batcher: Address = env
            .storage()
            .instance()
            .get(&DataKey::Batcher)
            .ok_or(Error::NotInitialized)?;
        if funder != batcher {
            return Err(Error::Unauthorized);
        }
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
            &funder,
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

        env.storage().instance().set(&DataKey::QYes, &qy2);
        env.storage().instance().set(&DataKey::QNo, &qn2);
        Self::credit_shares(&env, &funder, dqyes, dqno);
        Self::bump(&env);
        CommitteeBatch {
            funder,
            signers: signers.len(),
            dqyes,
            dqno,
            qy: qy2,
            qn: qn2,
            net,
        }
        .publish(&env);
        Ok(net)
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
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &trader,
                &payout,
            );
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
