#![cfg(test)]

use crate::{Asset, PriceData, Resolver, ResolverClient};
use lmsr_market::{LmsrMarket, LmsrMarketClient, Side};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

const S: i128 = 1 << 32;
const ASSET: Symbol = symbol_short!("XLM");
const THRESHOLD: i128 = 1000;

// Minimal Reflector-shaped oracle whose price is settable per test.
#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn set(env: Env, price: i128) {
        env.storage().instance().set(&symbol_short!("p"), &price);
    }
    pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
        Some(PriceData {
            price: env.storage().instance().get(&symbol_short!("p")).unwrap_or(0),
            timestamp: 0,
        })
    }
}

/// Wires a market (admin = the Resolver contract, expiry = 0 = already expired),
/// the Resolver, and a mock oracle. Returns their clients.
fn setup(env: &Env) -> (ResolverClient<'_>, LmsrMarketClient<'_>, MockOracleClient<'_>) {
    env.mock_all_auths();
    let creator = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(creator).address();
    let resolver = ResolverClient::new(env, &env.register(Resolver {}, ()));
    let market = LmsrMarketClient::new(env, &env.register(LmsrMarket {}, ()));
    let oracle = MockOracleClient::new(env, &env.register(MockOracle {}, ()));
    market.init(&resolver.address, &token, &(100 * S), &ASSET, &THRESHOLD, &0u64);
    (resolver, market, oracle)
}

#[test]
fn resolves_yes_when_price_at_or_above_threshold() {
    let env = Env::default();
    let (resolver, market, oracle) = setup(&env);
    oracle.set(&THRESHOLD); // price == threshold -> YES
    let outcome = resolver.resolve_market(&market.address, &oracle.address);
    assert_eq!(outcome, Side::Yes);
    assert_eq!(market.outcome(), Some(Side::Yes));
}

#[test]
fn resolves_no_when_price_below_threshold() {
    let env = Env::default();
    let (resolver, market, oracle) = setup(&env);
    oracle.set(&(THRESHOLD - 1));
    let outcome = resolver.resolve_market(&market.address, &oracle.address);
    assert_eq!(outcome, Side::No);
    assert_eq!(market.outcome(), Some(Side::No));
}

#[test]
fn rejects_before_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let creator = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(creator).address();
    let resolver = ResolverClient::new(&env, &env.register(Resolver {}, ()));
    let market = LmsrMarketClient::new(&env, &env.register(LmsrMarket {}, ()));
    let oracle = MockOracleClient::new(&env, &env.register(MockOracle {}, ()));
    market.init(&resolver.address, &token, &(100 * S), &ASSET, &THRESHOLD, &9_999_999_999u64);
    oracle.set(&THRESHOLD);
    assert!(resolver
        .try_resolve_market(&market.address, &oracle.address)
        .is_err());
}
