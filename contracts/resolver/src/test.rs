#![cfg(test)]

extern crate std;

use crate::{Asset, PriceData, PythFeed, Resolver, ResolverClient, Side};
use lmsr_market::{LmsrMarket, LmsrMarketClient, Outcome as MarketOutcome, Side as MarketSide};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Bytes, Env, Symbol, Vec};

const S: i128 = 1 << 32;
const ASSET: Symbol = symbol_short!("BTC");
const THRESHOLD: i128 = 100 * 100_000_000_000_000;

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn __constructor(env: Env, decimals: u32, base: Symbol) {
        env.storage()
            .instance()
            .set(&symbol_short!("dec"), &decimals);
        env.storage().instance().set(&symbol_short!("base"), &base);
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

    pub fn set_base(env: Env, base: Symbol) {
        env.storage().instance().set(&symbol_short!("base"), &base);
    }

    pub fn base(env: Env) -> Asset {
        Asset::Other(
            env.storage()
                .instance()
                .get(&symbol_short!("base"))
                .unwrap(),
        )
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

fn seed_two_sided_market(env: &Env, market: &LmsrMarketClient<'_>, token: &Address, expiry: u64) {
    let trader = Address::generate(env);
    StellarAssetClient::new(env, token).mint(&trader, &(1_000_000 * S));
    env.ledger().with_mut(|ledger| ledger.timestamp = expiry - 1);
    market.buy(&trader, &MarketSide::Yes, &S);
    market.buy(&trader, &MarketSide::No, &S);
    env.ledger().with_mut(|ledger| ledger.timestamp = expiry);
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
        let client = MockOracleClient::new(
            env,
            &env.register(MockOracle {}, (*decimals, symbol_short!("USD"))),
        );
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
                3_600u64,
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
                token.clone(),
                100i128 * S,
                ASSET,
                THRESHOLD,
                expiry,
                0u64,
            ),
        ),
    );
    seed_two_sided_market(env, &market, &token, expiry);
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
fn config_exposes_immutable_resolution_policy() {
    let env = Env::default();
    let expiry = 1_000;
    let values = [(101 * 100_000_000_000_000, expiry, 14)];
    let (resolver, _, oracles) = setup(&env, &values, 1, expiry);
    let config = resolver.config();
    assert_eq!(config.oracles, oracles);
    assert_eq!(config.quorum, 1);
    assert_eq!(config.max_age, 300);
    assert_eq!(config.resolution_timeout, 3_600);
    assert_eq!(config.max_deviation_bps, 100);
    assert_eq!(config.max_confidence_bps, 100);
    assert_eq!(config.pyth_verifier, None);
    assert!(config.pyth_feeds.is_empty());
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
    let oracle = MockOracleClient::new(
        &env,
        &env.register(MockOracle {}, (14u32, symbol_short!("USD"))),
    );
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
                3_600u64,
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
                token.clone(),
                100i128 * S,
                ASSET,
                THRESHOLD,
                expiry,
                0u64,
            ),
        ),
    );
    seed_two_sided_market(&env, &market, &token, expiry);
    market.set_resolver(&creator, &resolver.address);
    let payload = pyth_payload(&env, 1, 10_050_000_000, -8, 10_000_000, expiry);
    assert_eq!(
        resolver.resolve_market(&market.address, &Some(payload)),
        Side::Yes
    );
    assert_eq!(market.outcome(), Some(MarketOutcome::Yes));
}

#[test]
#[should_panic(expected = "invalid resolver configuration")]
fn constructor_rejects_zero_source_quorum() {
    let env = Env::default();
    env.register(
        Resolver {},
        (
            Vec::<Address>::new(&env),
            0u32,
            300u64,
            3_600u64,
            100u32,
            100u32,
            Option::<Address>::None,
            Vec::<PythFeed>::new(&env),
        ),
    );
}

#[test]
fn single_consensus_oracle_free_mode_resolves() {
    let env = Env::default();
    let expiry = 1_000;
    let values = [(101 * 100_000_000_000_000i128, expiry, 14u32)];
    let (resolver, market, _) = setup(&env, &values, 1, expiry);
    assert_eq!(resolver.resolve_market(&market.address, &None), Side::Yes);
}

#[test]
fn ignores_oracle_with_non_usd_base() {
    let env = Env::default();
    let expiry = 1_000;
    let values = [
        (101 * 100_000_000_000_000i128, expiry, 14u32),
        (101 * 100_000_000_000_000i128, expiry, 14u32),
    ];
    let (resolver, market, oracles) = setup(&env, &values, 2, expiry);
    MockOracleClient::new(&env, &oracles.get(1).unwrap()).set_base(&symbol_short!("EUR"));
    assert!(resolver.try_resolve_market(&market.address, &None).is_err());
    assert_eq!(market.outcome(), None);
}

#[test]
#[should_panic(expected = "duplicate oracle source")]
fn constructor_rejects_duplicate_oracle_addresses() {
    let env = Env::default();
    let oracle = Address::generate(&env);
    env.register(
        Resolver {},
        (
            vec![&env, oracle.clone(), oracle],
            2u32,
            300u64,
            3_600u64,
            100u32,
            100u32,
            Option::<Address>::None,
            Vec::<PythFeed>::new(&env),
        ),
    );
}

#[test]
fn stale_market_can_only_be_voided_after_resolution_timeout() {
    let env = Env::default();
    let expiry = 1_000;
    let values = [(101 * 100_000_000_000_000i128, expiry - 301, 14u32)];
    let (resolver, market, _) = setup(&env, &values, 1, expiry);
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = expiry + 3_599);
    assert!(resolver.try_void_stale_market(&market.address).is_err());
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = expiry + 3_600);
    resolver.void_stale_market(&market.address);
    assert_eq!(market.outcome(), Some(MarketOutcome::Void));
}
