#![cfg(test)]
extern crate std;

use crate::{math, LmsrMarket, LmsrMarketClient, Side};
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, vec, Address, Env, IntoVal, Symbol};

const S: i128 = 1 << 32; // 2^32 fixed-point scale

// Sample market metadata (resolution parameters read by the Reflector Resolver).
const ASSET: Symbol = symbol_short!("XLM");
const THRESHOLD: i128 = 25_000_000_000_000; // 0.25 with Reflector's 14 decimals
const EXPIRY: u64 = 2_000_000_000; // unix seconds

/// Register a market with a fresh SAC collateral token, and a funded trader.
/// Returns (market client, collateral token address, trader address, admin address).
fn setup(env: &Env) -> (LmsrMarketClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let trader = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&trader, &(1_000_000 * S));
    let client = LmsrMarketClient::new(env, &env.register(LmsrMarket {}, ()));
    client.init(&admin, &token, &(100 * S), &ASSET, &THRESHOLD, &EXPIRY);
    (client, token, trader, admin)
}

#[test]
fn math_matches_validated_testnet_values() {
    // 60 YES, 40 NO, b=100 -> cost 119.8139, price 0.5498 (verified on testnet)
    assert_eq!(math::cost(60 * S, 40 * S, 100 * S), 514596724500);
    assert_eq!(math::price_yes(60 * S, 40 * S, 100 * S), 2361519037);
}

#[test]
fn price_is_half_at_zero() {
    let env = Env::default();
    let (client, _token, _trader, _admin) = setup(&env);
    assert_eq!(client.price_yes(), S / 2); // exp(0)/(exp(0)+exp(0)) = 0.5
    assert_eq!(client.get_state(), (0, 0, 100 * S));
}

#[test]
fn rejects_bad_liquidity_param() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let client = LmsrMarketClient::new(&env, &env.register(LmsrMarket {}, ()));
    assert!(client
        .try_init(&admin, &token, &0, &ASSET, &THRESHOLD, &EXPIRY)
        .is_err());
}

#[test]
fn init_stores_market_metadata() {
    let env = Env::default();
    let (client, _token, _trader, _admin) = setup(&env);
    let info = client.market_info();
    assert_eq!(info.asset, ASSET);
    assert_eq!(info.threshold, THRESHOLD);
    assert_eq!(info.expiry, EXPIRY);
}

#[test]
fn quote_buy_charges_cost_delta_rounded_up() {
    let env = Env::default();
    let (client, _token, _trader, _admin) = setup(&env);
    let before = math::cost(0, 0, 100 * S);
    let after = math::cost(60 * S, 0, 100 * S);
    assert_eq!(client.quote_buy(&Side::Yes, &(60 * S)), after - before + 1);
}

#[test]
fn buy_debits_collateral_credits_shares_and_moves_price() {
    let env = Env::default();
    let (client, token, trader, _admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    let start = tok.balance(&trader);
    let quote = client.quote_buy(&Side::Yes, &(60 * S));

    let paid = client.buy(&trader, &Side::Yes, &(60 * S));

    assert_eq!(paid, quote); // buy returns what was charged
    assert_eq!(client.shares_of(&trader, &Side::Yes), 60 * S); // shares credited
    assert_eq!(client.get_state(), (60 * S, 0, 100 * S)); // q moved
    assert_eq!(tok.balance(&trader), start - quote); // trader paid
    assert_eq!(tok.balance(&client.address), quote); // pool holds the collateral
    assert!(client.price_yes() > S / 2); // price moved toward YES
}

#[test]
fn sell_refunds_collateral_debits_shares_and_restores_price() {
    let env = Env::default();
    let (client, token, trader, _admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    client.buy(&trader, &Side::Yes, &(60 * S));
    let after_buy = tok.balance(&trader);
    let quote = client.quote_sell(&Side::Yes, &(60 * S));

    let refund = client.sell(&trader, &Side::Yes, &(60 * S));

    assert_eq!(refund, quote); // sell returns what was refunded
    assert_eq!(client.shares_of(&trader, &Side::Yes), 0); // shares removed
    assert_eq!(client.get_state(), (0, 0, 100 * S)); // q restored
    assert_eq!(tok.balance(&trader), after_buy + quote); // refunded
    assert_eq!(client.price_yes(), S / 2); // price back to 0.5
}

#[test]
fn cannot_sell_more_than_held() {
    let env = Env::default();
    let (client, _token, trader, _admin) = setup(&env);
    client.buy(&trader, &Side::Yes, &(10 * S));
    assert!(client.try_sell(&trader, &Side::Yes, &(11 * S)).is_err());
}

#[test]
fn resolve_sets_the_winning_outcome() {
    let env = Env::default();
    let (client, _token, _trader, admin) = setup(&env);
    assert_eq!(client.outcome(), None);
    client.resolve(&admin, &Side::Yes);
    assert_eq!(client.outcome(), Some(Side::Yes));
}

#[test]
fn resolve_rejects_non_admin() {
    let env = Env::default();
    let (client, _token, _trader, _admin) = setup(&env);
    let stranger = Address::generate(&env);
    assert!(client.try_resolve(&stranger, &Side::Yes).is_err());
}

#[test]
fn cannot_resolve_twice() {
    let env = Env::default();
    let (client, _token, _trader, admin) = setup(&env);
    client.resolve(&admin, &Side::Yes);
    assert!(client.try_resolve(&admin, &Side::No).is_err());
}

/// Fund the pool subsidy with >= b*ln2 so winning payouts are always solvent.
fn fund_subsidy(env: &Env, client: &LmsrMarketClient, token: &Address, admin: &Address) {
    StellarAssetClient::new(env, token).mint(admin, &(100 * S)); // > b*ln2 (~69.31)
    client.fund(admin, &(100 * S));
}

#[test]
fn redeem_pays_winning_shares_and_burns_them() {
    let env = Env::default();
    let (client, token, trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    fund_subsidy(&env, &client, &token, &admin);
    client.buy(&trader, &Side::Yes, &(60 * S));
    client.resolve(&admin, &Side::Yes);
    let before = tok.balance(&trader);

    let payout = client.redeem(&trader, &Side::Yes);

    assert_eq!(payout, 60 * S); // 1 collateral per winning share
    assert_eq!(client.shares_of(&trader, &Side::Yes), 0); // burned
    assert_eq!(tok.balance(&trader), before + 60 * S); // paid out
}

#[test]
fn redeem_losing_side_pays_nothing() {
    let env = Env::default();
    let (client, token, trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    fund_subsidy(&env, &client, &token, &admin);
    client.buy(&trader, &Side::No, &(60 * S));
    client.resolve(&admin, &Side::Yes); // NO loses
    let before = tok.balance(&trader);

    let payout = client.redeem(&trader, &Side::No);

    assert_eq!(payout, 0);
    assert_eq!(client.shares_of(&trader, &Side::No), 0); // burned
    assert_eq!(tok.balance(&trader), before); // nothing paid
}

#[test]
fn cannot_redeem_before_resolution() {
    let env = Env::default();
    let (client, _token, trader, _admin) = setup(&env);
    client.buy(&trader, &Side::Yes, &(10 * S));
    assert!(client.try_redeem(&trader, &Side::Yes).is_err());
}

// --- events (consumed by the off-chain indexer) ---
// Assert on this contract's events only (SAC token also emits); compare the full
// sequence via filter_by_contract, which equals a Vec<(addr, topics, data)>.

#[test]
fn buy_emits_trade_event() {
    let env = Env::default();
    let (client, _token, trader, _admin) = setup(&env);
    let cost = client.buy(&trader, &Side::Yes, &(60 * S));
    assert_eq!(
        env.events().all().filter_by_contract(&client.address),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("buy"), trader.clone()).into_val(&env),
                (Side::Yes, 60i128 * S, cost, 60i128 * S, 0i128).into_val(&env),
            )
        ]
    );
}

#[test]
fn sell_emits_trade_event() {
    let env = Env::default();
    let (client, _token, trader, _admin) = setup(&env);
    client.buy(&trader, &Side::Yes, &(60 * S));
    let refund = client.sell(&trader, &Side::Yes, &(60 * S));
    assert_eq!(
        env.events().all().filter_by_contract(&client.address),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("sell"), trader.clone()).into_val(&env),
                (Side::Yes, 60i128 * S, refund, 0i128, 0i128).into_val(&env),
            )
        ]
    );
}

#[test]
fn resolve_emits_event() {
    let env = Env::default();
    let (client, _token, _trader, admin) = setup(&env);
    client.resolve(&admin, &Side::Yes);
    assert_eq!(
        env.events().all().filter_by_contract(&client.address),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("resolved"),).into_val(&env),
                Side::Yes.into_val(&env),
            )
        ]
    );
}

#[test]
fn redeem_emits_event() {
    let env = Env::default();
    let (client, token, trader, admin) = setup(&env);
    fund_subsidy(&env, &client, &token, &admin);
    client.buy(&trader, &Side::Yes, &(60 * S));
    client.resolve(&admin, &Side::Yes);
    let payout = client.redeem(&trader, &Side::Yes);
    assert_eq!(
        env.events().all().filter_by_contract(&client.address),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("redeem"), trader.clone()).into_val(&env),
                (Side::Yes, payout).into_val(&env),
            )
        ]
    );
}
