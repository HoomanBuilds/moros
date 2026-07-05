#![no_std]
//! LMSR prediction-market contract (Soroban).
//!
//! Holds YES/NO quantities and the liquidity parameter `b`, prices trades with the
//! LMSR cost function, and settles them in a collateral token (SEP-41). Pricing math
//! is in `math.rs`, validated on testnet. Buy is public in this phase (trader address
//! visible); shielded/batched settlement is layered on in later phases per `docs/plans/*`.

mod math;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

/// Which outcome a trade is on.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Yes,
    No,
}

#[contracttype]
enum DataKey {
    Admin,
    Token,
    B,
    QYes,
    QNo,
    Outcome,
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
}

#[contract]
pub struct LmsrMarket;

#[contractimpl]
impl LmsrMarket {
    /// Initialize with an `admin`, a `collateral` token (SEP-41), and liquidity
    /// parameter `b` (fixed-point, value * 2^32). Worst-case operator loss is `b * ln 2`.
    pub fn init(env: Env, admin: Address, collateral: Address, b: i128) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::B) {
            return Err(Error::AlreadyInitialized);
        }
        if b <= 0 || b > MAX_Q {
            return Err(Error::InvalidParams);
        }
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Token, &collateral);
        s.set(&DataKey::B, &b);
        s.set(&DataKey::QYes, &0i128);
        s.set(&DataKey::QNo, &0i128);
        Ok(())
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
        Ok(after - before + 1)
    }

    /// Buy `shares` (fixed-point) of `side` for `trader`. Charges `quote_buy` collateral,
    /// credits the shares, and moves the market quantities. Returns the amount charged.
    pub fn buy(env: Env, trader: Address, side: Side, shares: i128) -> Result<i128, Error> {
        trader.require_auth();
        let cost = Self::quote_buy(env.clone(), side, shares)?;

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

        let key = DataKey::Shares(trader, side);
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(held + shares));

        let (qy, qn, _b) = Self::state(&env)?;
        let (qy2, qn2) = Self::apply(qy, qn, side, shares);
        env.storage().instance().set(&DataKey::QYes, &qy2);
        env.storage().instance().set(&DataKey::QNo, &qn2);

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
        let refund = before - after - 1;
        Ok(if refund > 0 { refund } else { 0 })
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
        env.storage().instance().set(&DataKey::Outcome, &outcome);
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

        if side != winning || held == 0 {
            return Ok(0);
        }

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &trader,
            &held,
        );
        Ok(held)
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
}

#[cfg(test)]
mod test;
