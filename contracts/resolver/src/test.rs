#![cfg(test)]

extern crate std;

use crate::{Asset, PriceData, PythFeed, Resolver, ResolverClient, Side};
use lmsr_market::{LmsrMarket, LmsrMarketClient, Outcome as MarketOutcome};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Bytes, Env, Symbol, Vec};

const S: i128 = 1 << 32;
const ASSET: Symbol = symbol_short!("BTC");
const THRESHOLD: i128 = 100 * 100_000_000_000_000;

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn __constructor(env: Env, decimals: u32) {
        env.storage()
            .instance()
            .set(&symbol_short!("dec"), &decimals);
    }

    pub fn set(env: Env, price: i128, timestamp: u64) {
        env.storage()
            .instance()
            .set(&symbol_short!("price"), &price);
        env.storage()
            .instance()
            .set(&symbol_short!("time"), &timestamp);
        env.storage().instance().set(&symbol_short!("on"), &true);
    }

    pub fn disable(env: Env) {
        env.storage().instance().set(&symbol_short!("on"), &false);
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&symbol_short!("dec")).unwrap()
    }

    pub fn price(env: Env, _asset: Asset, _timestamp: u64) -> Option<PriceData> {
        if !env
            .storage()
            .instance()
            .get(&symbol_short!("on"))
            .unwrap_or(false)
        {
            return None;
        }
        Some(PriceData {
            price: env
                .storage()
                .instance()
                .get(&symbol_short!("price"))
                .unwrap(),
            timestamp: env
                .storage()
                .instance()
                .get(&symbol_short!("time"))
                .unwrap(),
        })
    }
}

#[contract]
pub struct MockPythVerifier;

#[contractimpl]
impl MockPythVerifier {
    pub fn verify_update(_env: Env, data: Bytes) -> Bytes {
        data
    }
}

fn pyth_payload(
    env: &Env,
    feed_id: u32,
    price: i64,
    exponent: i16,
    confidence: i64,
    timestamp: u64,
) -> Bytes {
    let mut raw = std::vec::Vec::new();
    raw.extend_from_slice(&2_479_346_549u32.to_le_bytes());
    raw.extend_from_slice(&(timestamp * 1_000_000).to_le_bytes());
    raw.push(4);
    raw.push(1);
    raw.extend_from_slice(&feed_id.to_le_bytes());
    raw.push(4);
    raw.push(0);
    raw.extend_from_slice(&(price as u64).to_le_bytes());
    raw.push(4);
    raw.extend_from_slice(&(exponent as u16).to_le_bytes());
    raw.push(5);
    raw.extend_from_slice(&(confidence as u64).to_le_bytes());
    raw.push(12);
    raw.push(1);
    raw.extend_from_slice(&(timestamp * 1_000_000).to_le_bytes());
    Bytes::from_slice(env, &raw)
}

fn setup<'a>(
    env: &'a Env,
    values: &[(i128, u64, u32)],
    quorum: u32,
    expiry: u64,
) -> (ResolverClient<'a>, LmsrMarketClient<'a>, Vec<Address>) {
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.timestamp = expiry);
    let mut oracle_addresses = Vec::new(env);
    let mut oracle_clients = Vec::new(env);
    for (price, timestamp, decimals) in values {
        let client = MockOracleClient::new(env, &env.register(MockOracle {}, (*decimals,)));
        client.set(price, timestamp);
        oracle_addresses.push_back(client.address.clone());
        oracle_clients.push_back(client.address.clone());
    }
    let resolver = ResolverClient::new(
        env,
        &env.register(
            Resolver {},
            (
                oracle_addresses,
                quorum,
                300u64,
                100u32,
                100u32,
                Option::<Address>::None,
                Vec::<PythFeed>::new(env),
            ),
        ),
    );
    let creator = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(creator.clone())
        .address();
    let market = LmsrMarketClient::new(
        env,
        &env.register(
            LmsrMarket {},
            (
                creator.clone(),
                token,
                100i128 * S,
                ASSET,
                THRESHOLD,
                expiry,
                0u64,
            ),
        ),
    );
    market.set_resolver(&creator, &resolver.address);
    assert_eq!(market.resolver(), Some(resolver.address.clone()));
    (resolver, market, oracle_clients)
}

#[test]
fn resolves_with_two_agreeing_sources_and_ignores_outlier() {
    let env = Env::default();
    let expiry = 1_000;
    let values = [
        (101 * 100_000_000_000_000, expiry, 14),
        (1011 * 1_000_000_000_000, expiry, 13),
        (80 * 100_000_000_000_000, expiry, 14),
    ];
    let (resolver, market, _) = setup(&env, &values, 2, expiry);
    assert_eq!(resolver.resolve_market(&market.address, &None), Side::Yes);
    assert_eq!(market.outcome(), Some(MarketOutcome::Yes));
}

#[test]
fn resolves_no_with_one_source_unavailable() {
    let env = Env::default();
    let expiry = 2_000;
    let values = [
        (99 * 100_000_000_000_000, expiry, 14),
        (991 * 1_000_000_000_000, expiry, 13),
        (99 * 100_000_000_000_000, expiry, 14),
    ];
    let (resolver, market, oracles) = setup(&env, &values, 2, expiry);
    MockOracleClient::new(&env, &oracles.get(2).unwrap()).disable();
    assert_eq!(resolver.resolve_market(&market.address, &None), Side::No);
}

#[test]
fn rejects_stale_sources_without_quorum() {
    let env = Env::default();
    let expiry = 5_000;
    let values = [
        (101 * 100_000_000_000_000, expiry - 301, 14),
        (101 * 100_000_000_000_000, expiry, 14),
    ];
    let (resolver, market, _) = setup(&env, &values, 2, expiry);
    assert!(resolver.try_resolve_market(&market.address, &None).is_err());
    assert_eq!(market.outcome(), None);
}

#[test]
fn rejects_two_sources_that_disagree() {
    let env = Env::default();
    let expiry = 8_000;
    let values = [
        (90 * 100_000_000_000_000, expiry, 14),
        (110 * 100_000_000_000_000, expiry, 14),
    ];
    let (resolver, market, _) = setup(&env, &values, 2, expiry);
    assert!(resolver.try_resolve_market(&market.address, &None).is_err());
    assert_eq!(market.outcome(), None);
}

#[test]
fn rejects_before_expiry() {
    let env = Env::default();
    let expiry = 10_000;
    let values = [
        (101 * 100_000_000_000_000, expiry, 14),
        (101 * 100_000_000_000_000, expiry, 14),
    ];
    let (resolver, market, _) = setup(&env, &values, 2, expiry);
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = expiry - 1);
    assert!(resolver.try_resolve_market(&market.address, &None).is_err());
}

#[test]
fn combines_sep40_and_verified_pyth_price() {
    let env = Env::default();
    env.mock_all_auths();
    let expiry = 12_000;
    env.ledger().with_mut(|ledger| ledger.timestamp = expiry);
    let oracle = MockOracleClient::new(&env, &env.register(MockOracle {}, (14u32,)));
    oracle.set(&(1004 * 10_000_000_000_000), &expiry);
    let verifier = env.register(MockPythVerifier {}, ());
    let resolver = ResolverClient::new(
        &env,
        &env.register(
            Resolver {},
            (
                vec![&env, oracle.address.clone()],
                2u32,
                300u64,
                100u32,
                100u32,
                Some(verifier),
                vec![
                    &env,
                    PythFeed {
                        asset: ASSET,
                        feed_id: 1,
                    },
                ],
            ),
        ),
    );
    let creator = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(creator.clone())
        .address();
    let market = LmsrMarketClient::new(
        &env,
        &env.register(
            LmsrMarket {},
            (
                creator.clone(),
                token,
                100i128 * S,
                ASSET,
                THRESHOLD,
                expiry,
                0u64,
            ),
        ),
    );
    market.set_resolver(&creator, &resolver.address);
    let payload = pyth_payload(&env, 1, 10_050_000_000, -8, 10_000_000, expiry);
    assert_eq!(
        resolver.resolve_market(&market.address, &Some(payload)),
        Side::Yes
    );
}

#[test]
#[should_panic(expected = "invalid resolver configuration")]
fn constructor_rejects_single_source_quorum() {
    let env = Env::default();
    env.register(
        Resolver {},
        (
            vec![&env, Address::generate(&env)],
            1u32,
            300u64,
            100u32,
            100u32,
            Option::<Address>::None,
            Vec::<PythFeed>::new(&env),
        ),
    );
}
