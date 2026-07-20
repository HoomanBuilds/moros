#![no_std]
//! Quorum-based price resolver for LMSR markets.

use pyth_lazer_stellar_sdk::PythLazerClient;
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    symbol_short, vec, Address, Bytes, Env, IntoVal, Symbol, Vec,
};

const TARGET_DECIMALS: u32 = 14;
const BPS_SCALE: i128 = 10_000;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Oracles,
    Quorum,
    MaxAge,
    ResolutionTimeout,
    MaxDeviation,
    MaxConfidence,
    PythVerifier,
    PythFeeds,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "PriceFeedClient")]
pub trait PriceFeed {
    fn base(env: Env) -> Asset;
    fn decimals(env: Env) -> u32;
    fn price(env: Env, asset: Asset, timestamp: u64) -> Option<PriceData>;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PythFeed {
    pub asset: Symbol,
    pub feed_id: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub oracles: Vec<Address>,
    pub quorum: u32,
    pub max_age: u64,
    pub resolution_timeout: u64,
    pub max_deviation_bps: u32,
    pub max_confidence_bps: u32,
    pub pyth_verifier: Option<Address>,
    pub pyth_feeds: Vec<PythFeed>,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Yes,
    No,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketOutcome {
    Yes,
    No,
    Void,
}

#[contracttype]
#[derive(Clone)]
pub struct MarketInfo {
    pub asset: Symbol,
    pub threshold: i128,
    pub expiry: u64,
    pub finalize_after: u64,
}

#[contractclient(name = "MarketClient")]
pub trait Market {
    fn market_info(env: Env) -> MarketInfo;
    fn resolver(env: Env) -> Option<Address>;
    fn resolve(env: Env, admin: Address, outcome: MarketOutcome);
    fn void(env: Env, caller: Address);
}

#[contractevent(topics = ["resolved"], data_format = "vec")]
pub struct Resolved {
    #[topic]
    pub market: Address,
    pub outcome: Side,
    pub median_price: i128,
    pub agreeing_sources: u32,
}

#[contractevent(topics = ["voided"], data_format = "vec")]
pub struct Voided {
    #[topic]
    pub market: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotYetExpired = 1,
    NoQuorum = 2,
    NotInitialized = 3,
    InvalidConfig = 4,
    OracleDisagreement = 5,
    InvalidPythPayload = 6,
}

#[contract]
pub struct Resolver;

#[contractimpl]
impl Resolver {
    pub fn __constructor(
        env: Env,
        oracles: Vec<Address>,
        quorum: u32,
        max_age: u64,
        resolution_timeout: u64,
        max_deviation_bps: u32,
        max_confidence_bps: u32,
        pyth_verifier: Option<Address>,
        pyth_feeds: Vec<PythFeed>,
    ) {
        let available = oracles.len() + if pyth_verifier.is_some() { 1 } else { 0 };
        if quorum == 0
            || available < quorum
            || max_age == 0
            || resolution_timeout < 300
            || resolution_timeout > 2_592_000
            || max_deviation_bps == 0
            || max_deviation_bps > 10_000
            || max_confidence_bps > 10_000
        {
            panic!("invalid resolver configuration");
        }
        let mut unique = Vec::new(&env);
        for oracle in oracles.iter() {
            if unique.contains(&oracle) {
                panic!("duplicate oracle source");
            }
            unique.push_back(oracle);
        }
        let storage = env.storage().instance();
        storage.set(&DataKey::Oracles, &oracles);
        storage.set(&DataKey::Quorum, &quorum);
        storage.set(&DataKey::MaxAge, &max_age);
        storage.set(&DataKey::ResolutionTimeout, &resolution_timeout);
        storage.set(&DataKey::MaxDeviation, &max_deviation_bps);
        storage.set(&DataKey::MaxConfidence, &max_confidence_bps);
        storage.set(&DataKey::PythVerifier, &pyth_verifier);
        storage.set(&DataKey::PythFeeds, &pyth_feeds);
        Self::bump(&env);
    }

    pub fn extend_ttl(env: Env) {
        Self::bump(&env);
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        let storage = env.storage().instance();
        Ok(Config {
            oracles: storage
                .get(&DataKey::Oracles)
                .ok_or(Error::NotInitialized)?,
            quorum: storage.get(&DataKey::Quorum).ok_or(Error::NotInitialized)?,
            max_age: storage.get(&DataKey::MaxAge).ok_or(Error::NotInitialized)?,
            resolution_timeout: storage
                .get(&DataKey::ResolutionTimeout)
                .ok_or(Error::NotInitialized)?,
            max_deviation_bps: storage
                .get(&DataKey::MaxDeviation)
                .ok_or(Error::NotInitialized)?,
            max_confidence_bps: storage
                .get(&DataKey::MaxConfidence)
                .ok_or(Error::NotInitialized)?,
            pyth_verifier: storage
                .get(&DataKey::PythVerifier)
                .ok_or(Error::NotInitialized)?,
            pyth_feeds: storage
                .get(&DataKey::PythFeeds)
                .ok_or(Error::NotInitialized)?,
        })
    }

    pub fn resolve_market(
        env: Env,
        market: Address,
        pyth_payload: Option<Bytes>,
    ) -> Result<Side, Error> {
        let storage = env.storage().instance();
        let oracles: Vec<Address> = storage
            .get(&DataKey::Oracles)
            .ok_or(Error::NotInitialized)?;
        let quorum: u32 = storage.get(&DataKey::Quorum).ok_or(Error::NotInitialized)?;
        let max_age: u64 = storage.get(&DataKey::MaxAge).ok_or(Error::NotInitialized)?;
        let max_deviation_bps: u32 = storage
            .get(&DataKey::MaxDeviation)
            .ok_or(Error::NotInitialized)?;

        let market_client = MarketClient::new(&env, &market);
        let info = market_client.market_info();
        if market_client.resolver() != Some(env.current_contract_address()) {
            return Err(Error::InvalidConfig);
        }
        if env.ledger().timestamp() < info.finalize_after {
            return Err(Error::NotYetExpired);
        }

        let mut prices = Vec::new(&env);
        for oracle in oracles.iter() {
            let client = PriceFeedClient::new(&env, &oracle);
            let base = match client.try_base() {
                Ok(Ok(value)) => value,
                _ => continue,
            };
            if base != Asset::Other(symbol_short!("USD")) {
                continue;
            }
            let decimals = match client.try_decimals() {
                Ok(Ok(value)) => value,
                _ => continue,
            };
            let data = match client.try_price(&Asset::Other(info.asset.clone()), &info.expiry) {
                Ok(Ok(Some(value))) => value,
                _ => continue,
            };
            if !Self::fresh_at_expiry(data.timestamp, info.expiry, max_age) {
                continue;
            }
            if let Some(normalized) = Self::normalize_decimals(data.price, decimals) {
                prices.push_back(normalized);
            }
        }

        if let Some(payload) = pyth_payload {
            if let Some(price) = Self::read_pyth(&env, &info, &payload, max_age)? {
                prices.push_back(price);
            }
        }

        if prices.len() < quorum {
            return Err(Error::NoQuorum);
        }
        Self::sort(&mut prices);
        let median = prices.get(prices.len() / 2).ok_or(Error::NoQuorum)?;
        let agreeing_sources = Self::count_agreeing(&prices, median, max_deviation_bps);
        if agreeing_sources < quorum {
            return Err(Error::OracleDisagreement);
        }

        let outcome = if median >= info.threshold {
            Side::Yes
        } else {
            Side::No
        };
        let market_outcome = match outcome {
            Side::Yes => MarketOutcome::Yes,
            Side::No => MarketOutcome::No,
        };
        let current = env.current_contract_address();
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: market_client.address.clone(),
                    fn_name: symbol_short!("resolve"),
                    args: (current.clone(), market_outcome).into_val(&env),
                },
                sub_invocations: vec![&env],
            }),
        ]);
        market_client.resolve(&current, &market_outcome);
        Resolved {
            market,
            outcome,
            median_price: median,
            agreeing_sources,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(outcome)
    }

    pub fn void_stale_market(env: Env, market: Address) -> Result<(), Error> {
        let market_client = MarketClient::new(&env, &market);
        let info = market_client.market_info();
        if market_client.resolver() != Some(env.current_contract_address()) {
            return Err(Error::InvalidConfig);
        }
        let resolution_timeout: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ResolutionTimeout)
            .ok_or(Error::NotInitialized)?;
        let void_after = info
            .finalize_after
            .checked_add(resolution_timeout)
            .ok_or(Error::InvalidConfig)?;
        if env.ledger().timestamp() < void_after {
            return Err(Error::NotYetExpired);
        }
        let current = env.current_contract_address();
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: market.clone(),
                    fn_name: symbol_short!("void"),
                    args: (current.clone(),).into_val(&env),
                },
                sub_invocations: vec![&env],
            }),
        ]);
        market_client.void(&current);
        Voided { market }.publish(&env);
        Self::bump(&env);
        Ok(())
    }
}

impl Resolver {
    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn read_pyth(
        env: &Env,
        info: &MarketInfo,
        payload: &Bytes,
        max_age: u64,
    ) -> Result<Option<i128>, Error> {
        let storage = env.storage().instance();
        let verifier: Option<Address> = storage
            .get(&DataKey::PythVerifier)
            .ok_or(Error::NotInitialized)?;
        let verifier = match verifier {
            Some(value) => value,
            None => return Ok(None),
        };
        let feeds: Vec<PythFeed> = storage
            .get(&DataKey::PythFeeds)
            .ok_or(Error::NotInitialized)?;
        let feed_id = match feeds.iter().find(|feed| feed.asset == info.asset) {
            Some(feed) => feed.feed_id,
            None => return Ok(None),
        };
        let update = PythLazerClient::new(env, &verifier)
            .verify_update(payload)
            .map_err(|_| Error::InvalidPythPayload)?;
        let feed = match update.feeds.iter().find(|feed| feed.feed_id == feed_id) {
            Some(value) => value,
            None => return Ok(None),
        };
        let price = match feed.price {
            Some(value) if value > 0 => value as i128,
            _ => return Ok(None),
        };
        let exponent = match feed.exponent {
            Some(value) => value as i32,
            None => return Ok(None),
        };
        let timestamp = match feed.feed_update_timestamp {
            Some(value) => value / 1_000_000,
            None => return Ok(None),
        };
        if !Self::fresh_at_expiry(timestamp, info.expiry, max_age) {
            return Ok(None);
        }
        let confidence = match feed.confidence {
            Some(value) if value >= 0 => value as i128,
            _ => return Ok(None),
        };
        let max_confidence_bps: u32 = storage
            .get(&DataKey::MaxConfidence)
            .ok_or(Error::NotInitialized)?;
        if confidence.checked_mul(BPS_SCALE).unwrap_or(i128::MAX)
            > price
                .checked_mul(max_confidence_bps as i128)
                .unwrap_or(i128::MAX)
        {
            return Ok(None);
        }
        Ok(Self::normalize_exponent(price, exponent))
    }

    fn fresh_at_expiry(timestamp: u64, expiry: u64, max_age: u64) -> bool {
        timestamp <= expiry && expiry - timestamp <= max_age
    }

    fn normalize_decimals(price: i128, decimals: u32) -> Option<i128> {
        if price <= 0 || decimals > 38 {
            return None;
        }
        if decimals == TARGET_DECIMALS {
            return Some(price);
        }
        if decimals < TARGET_DECIMALS {
            price.checked_mul(10i128.checked_pow(TARGET_DECIMALS - decimals)?)
        } else {
            Some(price / 10i128.checked_pow(decimals - TARGET_DECIMALS)?)
        }
    }

    fn normalize_exponent(price: i128, exponent: i32) -> Option<i128> {
        let target_power = TARGET_DECIMALS as i32 + exponent;
        if target_power >= 0 {
            price.checked_mul(10i128.checked_pow(target_power as u32)?)
        } else {
            Some(price / 10i128.checked_pow((-target_power) as u32)?)
        }
    }

    fn sort(values: &mut Vec<i128>) {
        let len = values.len();
        let mut i = 0;
        while i < len {
            let mut j = i + 1;
            while j < len {
                let left = values.get(i).unwrap();
                let right = values.get(j).unwrap();
                if right < left {
                    values.set(i, right);
                    values.set(j, left);
                }
                j += 1;
            }
            i += 1;
        }
    }

    fn count_agreeing(values: &Vec<i128>, median: i128, max_deviation_bps: u32) -> u32 {
        let mut count = 0;
        for value in values.iter() {
            let difference = if value >= median {
                value - median
            } else {
                median - value
            };
            if difference.checked_mul(BPS_SCALE).unwrap_or(i128::MAX)
                <= median
                    .checked_mul(max_deviation_bps as i128)
                    .unwrap_or(i128::MAX)
            {
                count += 1;
            }
        }
        count
    }
}

#[cfg(test)]
mod test;
