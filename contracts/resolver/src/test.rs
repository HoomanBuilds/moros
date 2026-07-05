#![cfg(test)]

use crate::{Asset, PriceData, Resolver, ResolverClient, Side};
use lmsr_market::{LmsrMarket, LmsrMarketClient, Side as MarketSide};
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

/// Wires a Resolver (trusted oracle set at init), a market whose admin is the
/// Resolver (expiry = 0 = already expired), and the mock oracle.
fn setup(env: &Env) -> (ResolverClient<'_>, LmsrMarketClient<'_>, MockOracleClient<'_>) {
    env.mock_all_auths();
    let creator = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(creator).address();
    let oracle = MockOracleClient::new(env, &env.register(MockOracle {}, ()));
    let resolver = ResolverClient::new(env, &env.register(Resolver {}, (oracle.address.clone(),)));
    let market = LmsrMarketClient::new(
        env,
        &env.register(
            LmsrMarket {},
            (resolver.address.clone(), token.clone(), 100i128 * S, ASSET, THRESHOLD, 0u64),
        ),
    );
    (resolver, market, oracle)
}

#[test]
fn resolves_yes_when_price_at_or_above_threshold() {
    let env = Env::default();
    let (resolver, market, oracle) = setup(&env);
    oracle.set(&THRESHOLD); // price == threshold -> YES
    let outcome = resolver.resolve_market(&market.address);
    assert_eq!(outcome, Side::Yes);
    assert_eq!(market.outcome(), Some(MarketSide::Yes));
}

#[test]
fn resolves_no_when_price_below_threshold() {
    let env = Env::default();
    let (resolver, market, oracle) = setup(&env);
    oracle.set(&(THRESHOLD - 1));
    let outcome = resolver.resolve_market(&market.address);
    assert_eq!(outcome, Side::No);
    assert_eq!(market.outcome(), Some(MarketSide::No));
}

#[test]
fn rejects_before_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let creator = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(creator).address();
    let oracle = MockOracleClient::new(&env, &env.register(MockOracle {}, ()));
    let resolver = ResolverClient::new(&env, &env.register(Resolver {}, (oracle.address.clone(),)));
    let market = LmsrMarketClient::new(
        &env,
        &env.register(
            LmsrMarket {},
            (resolver.address.clone(), token.clone(), 100i128 * S, ASSET, THRESHOLD, 9_999_999_999u64),
        ),
    );
    oracle.set(&THRESHOLD);
    assert!(resolver.try_resolve_market(&market.address).is_err());
}
