#![no_std]
//! LMSR prediction-market contract (Soroban).
//!
//! Holds YES/NO quantities and the liquidity parameter `b`, prices trades with the
//! LMSR cost function, and settles them in a collateral token (SEP-41). Pricing math
//! is in `math.rs`, validated on testnet. Buy is public in this phase (trader address
//! visible); shielded/batched settlement is layered on in later phases per `docs/plans/*`.

mod math;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
};

/// Which outcome a trade is on.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Yes,
    No,
}

/// Resolution parameters: the market resolves YES iff the Reflector price of
/// `asset` at/after `expiry` is >= `threshold` (threshold in the oracle's decimals).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketInfo {
    pub asset: Symbol,
    pub threshold: i128,
    pub expiry: u64,
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
    Decimals,
    Shares(Address, Side),
}

// Guards the fixed-point ops against i128 overflow (real operand products < 2^63).
const MAX_Q: i128 = 1i128 << 60;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidParams = 3,
    InsufficientShares = 4,
    Unauthorized = 5,
    AlreadyResolved = 6,
    NotResolved = 7,
    Undersolvent = 8,
}

#[contract]
pub struct LmsrMarket;

#[contractimpl]
#[allow(deprecated)] // events use the classic publish() API; migrate to #[contractevent] later
impl LmsrMarket {
    /// Initialize with an `admin`, a `collateral` token (SEP-41), liquidity
    /// parameter `b` (fixed-point, value * 2^32), and the resolution parameters
    /// (`asset` / `threshold` / `expiry`). Worst-case operator loss is `b * ln 2`.
    pub fn init(
        env: Env,
        admin: Address,
        collateral: Address,
        b: i128,
        asset: Symbol,
        threshold: i128,
        expiry: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::B) {
            return Err(Error::AlreadyInitialized);
        }
        if b <= 0 || b > MAX_Q {
            return Err(Error::InvalidParams);
        }
        // Collateral is settled in the token's atomic units; cache its decimals so
        // the fixed-point (2^32) LMSR math can be converted to real token amounts.
        let decimals = token::Client::new(&env, &collateral).decimals();
        if decimals > 18 {
            return Err(Error::InvalidParams);
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
        s.set(&DataKey::Decimals, &decimals);
        Ok(())
    }

    /// Resolution parameters (asset / threshold / expiry).
    pub fn market_info(env: Env) -> Result<MarketInfo, Error> {
        let s = env.storage().instance();
        Ok(MarketInfo {
            asset: s.get(&DataKey::Asset).ok_or(Error::NotInitialized)?,
            threshold: s.get(&DataKey::Threshold).ok_or(Error::NotInitialized)?,
            expiry: s.get(&DataKey::Expiry).ok_or(Error::NotInitialized)?,
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

    /// Collateral cost to buy `shares` (fixed-point) of `side`.
    /// Rounded UP by one unit (pool-favoring) so per-trade truncation never undercharges.
    pub fn quote_buy(env: Env, side: Side, shares: i128) -> Result<i128, Error> {
        if shares <= 0 {
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

        // Effects before interaction (a reverted transfer rolls all of this back atomically).
        let key = DataKey::Shares(trader.clone(), side);
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(held + shares));

        let (qy, qn, _b) = Self::state(&env)?;
        let (qy2, qn2) = Self::apply(qy, qn, side, shares);
        env.storage().instance().set(&DataKey::QYes, &qy2);
        env.storage().instance().set(&DataKey::QNo, &qn2);

        // Interaction last: pull collateral from the trader.
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

        env.events()
            .publish((symbol_short!("buy"), trader), (side, shares, cost, qy2, qn2));
        Ok(cost)
    }

    /// Collateral refunded to sell `shares` (fixed-point) of `side`.
    /// Rounded DOWN by one unit (pool-favoring). Errors if it would drive q negative.
    pub fn quote_sell(env: Env, side: Side, shares: i128) -> Result<i128, Error> {
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

        env.events()
            .publish((symbol_short!("sell"), trader), (side, shares, refund, qy2, qn2));
        Ok(refund)
    }

    /// Shares (fixed-point) held by `trader` on `side`.
    pub fn shares_of(env: Env, trader: Address, side: Side) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Shares(trader, side))
            .unwrap_or(0)
    }

    /// Settle the market on `outcome`. Admin-only (the Resolver/Reflector wiring
    /// replaces this driver in a later phase). Cannot be resolved twice.
    pub fn resolve(env: Env, admin: Address, outcome: Side) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        if env.storage().instance().has(&DataKey::Outcome) {
            return Err(Error::AlreadyResolved);
        }
        // Solvency: the pool must hold enough collateral to pay every winning share
        // (1 per share). Refuse to resolve into an insolvent state; fund first.
        let (qy, qn, _b) = Self::state(&env)?;
        let q_win = match outcome {
            Side::Yes => qy,
            Side::No => qn,
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
        env.events().publish((symbol_short!("resolved"),), outcome);
        Ok(())
    }

    /// The winning outcome, or `None` if the market is still open.
    pub fn outcome(env: Env) -> Option<Side> {
        env.storage().instance().get(&DataKey::Outcome)
    }

    /// Add collateral subsidy/liquidity to the pool. Fund at least `b * ln 2`
    /// (the LMSR worst-case loss) so winning redemptions are always solvent.
    pub fn fund(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidParams);
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
        Ok(())
    }

    /// Redeem `trader`'s `side` shares after resolution. Winning shares pay 1
    /// collateral each; losing shares pay 0. Shares are burned either way.
    pub fn redeem(env: Env, trader: Address, side: Side) -> Result<i128, Error> {
        trader.require_auth();
        let winning: Side = env
            .storage()
            .instance()
            .get(&DataKey::Outcome)
            .ok_or(Error::NotResolved)?;

        let key = DataKey::Shares(trader.clone(), side);
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &0i128); // burn regardless of outcome

        // 1 collateral per winning share; convert fixed-point shares -> atomic (rounded down).
        let payout = if side == winning {
            Self::to_atomic(&env, held, false)
        } else {
            0
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
        env.events()
            .publish((symbol_short!("redeem"), trader), (side, payout));
        Ok(payout)
    }
}

impl LmsrMarket {
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
