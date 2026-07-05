#![no_std]
//! Reflector-driven Resolver for LMSR markets.
//!
//! A shared contract: a market that wants oracle resolution sets its `admin` to
//! this Resolver's address. `resolve_market` reads the market's asset/threshold/
//! expiry, requires the market to be at/after expiry, reads the Reflector (SEP-40)
//! price, and sets the outcome (YES iff price >= threshold) by calling `market.resolve`.

use lmsr_market::{LmsrMarketClient, Side};
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, Env, Symbol,
};

/// Reflector SEP-40 asset identifier.
#[contracttype]
#[derive(Clone)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// Reflector SEP-40 price sample.
#[contracttype]
#[derive(Clone)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// The subset of the Reflector (SEP-40) oracle interface we consume.
#[contractclient(name = "ReflectorClient")]
pub trait Reflector {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotYetExpired = 1,
    NoPrice = 2,
}

#[contract]
pub struct Resolver;

#[contractimpl]
impl Resolver {
    /// Resolve `market` using `oracle`. Reads the market's asset/threshold/expiry,
    /// requires the market to be at/after expiry, reads the Reflector price, and
    /// sets the outcome (YES iff price >= threshold). Returns the winning `Side`.
    pub fn resolve_market(env: Env, market: Address, oracle: Address) -> Result<Side, Error> {
        let m = LmsrMarketClient::new(&env, &market);
        let info = m.market_info();
        if env.ledger().timestamp() < info.expiry {
            return Err(Error::NotYetExpired);
        }
        let price = ReflectorClient::new(&env, &oracle)
            .lastprice(&Asset::Other(info.asset))
            .ok_or(Error::NoPrice)?;
        let outcome = if price.price >= info.threshold {
            Side::Yes
        } else {
            Side::No
        };
        m.resolve(&env.current_contract_address(), &outcome);
        Ok(outcome)
    }
}

#[cfg(test)]
mod test;
