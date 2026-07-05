#![no_std]
//! LMSR prediction-market contract (Soroban).
//!
//! Holds the YES/NO quantities and liquidity parameter `b`, and exposes the live
//! LMSR odds. Buy/sell, batched `apply_batch` settlement, and collateral (SAC) are
//! added in later phases per `docs/plans/*` (kept local). The pricing math is in
//! `math.rs`, validated on testnet.

mod math;

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Env, Symbol};

const B: Symbol = symbol_short!("B");
const QYES: Symbol = symbol_short!("QYES");
const QNO: Symbol = symbol_short!("QNO");

// Guards the fixed-point ops against i128 overflow (real operand products < 2^63).
// Real market quantities sit far below this; asserted on init.
const MAX_Q: i128 = 1i128 << 60;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidParams = 3,
}

#[contract]
pub struct LmsrMarket;

#[contractimpl]
impl LmsrMarket {
    /// Initialize with liquidity parameter `b` (fixed-point, value * 2^32).
    /// Worst-case operator loss is `b * ln 2`; fund the market accordingly.
    pub fn init(env: Env, b: i128) -> Result<(), Error> {
        if env.storage().instance().has(&B) {
            return Err(Error::AlreadyInitialized);
        }
        if b <= 0 || b > MAX_Q {
            return Err(Error::InvalidParams);
        }
        env.storage().instance().set(&B, &b);
        env.storage().instance().set(&QYES, &0i128);
        env.storage().instance().set(&QNO, &0i128);
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
}

impl LmsrMarket {
    fn state(env: &Env) -> Result<(i128, i128, i128), Error> {
        let b: i128 = env
            .storage()
            .instance()
            .get(&B)
            .ok_or(Error::NotInitialized)?;
        let qy: i128 = env.storage().instance().get(&QYES).unwrap_or(0);
        let qn: i128 = env.storage().instance().get(&QNO).unwrap_or(0);
        Ok((qy, qn, b))
    }
}

#[cfg(test)]
mod test;
