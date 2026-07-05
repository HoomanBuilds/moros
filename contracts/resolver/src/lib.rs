#![no_std]
//! Reflector-driven Resolver for LMSR markets.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    Env, Symbol,
};

const ORACLE: Symbol = symbol_short!("ORACLE");

#[contracttype]
#[derive(Clone)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "ReflectorClient")]
pub trait Reflector {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Yes,
    No,
}

#[contracttype]
#[derive(Clone)]
pub struct MarketInfo {
    pub asset: Symbol,
    pub threshold: i128,
    pub expiry: u64,
}

#[contractclient(name = "MarketClient")]
pub trait Market {
    fn market_info(env: Env) -> MarketInfo;
    fn resolve(env: Env, admin: Address, outcome: Side);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotYetExpired = 1,
    NoPrice = 2,
    NotInitialized = 3,
}

#[contract]
pub struct Resolver;

#[contractimpl]
impl Resolver {
    /// Set the trusted Reflector oracle at deploy time (constructor — runs
    /// atomically during deployment, so it cannot be front-run). One Resolver per oracle.
    pub fn __constructor(env: Env, oracle: Address) {
        env.storage().instance().set(&ORACLE, &oracle);
    }

    /// Resolve `market` using this Resolver's TRUSTED oracle (not caller-supplied).
    /// Reads the market's asset/threshold/expiry, requires the market to be at/after
    /// expiry, reads the Reflector price, and sets the outcome (YES iff price >=
    /// threshold). Permissionless — anyone may trigger it; the outcome is oracle-set.
    pub fn resolve_market(env: Env, market: Address) -> Result<Side, Error> {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&ORACLE)
            .ok_or(Error::NotInitialized)?;
        let m = MarketClient::new(&env, &market);
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
