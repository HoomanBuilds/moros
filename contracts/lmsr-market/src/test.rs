#![cfg(test)]
extern crate std;

use crate::{math, LmsrMarket, LmsrMarketClient, Side};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Env};

const S: i128 = 1 << 32; // 2^32 fixed-point scale

/// Register a market with a fresh SAC collateral token, and a funded trader.
/// Returns (market client, collateral token address, trader address).
fn setup(env: &Env) -> (LmsrMarketClient<'_>, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let trader = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&trader, &(1_000_000 * S));
    let client = LmsrMarketClient::new(env, &env.register(LmsrMarket {}, ()));
    client.init(&admin, &token, &(100 * S));
    (client, token, trader)
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
    let (client, _token, _trader) = setup(&env);
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
    assert!(client.try_init(&admin, &token, &0).is_err());
}

#[test]
fn quote_buy_charges_cost_delta_rounded_up() {
    let env = Env::default();
    let (client, _token, _trader) = setup(&env);
    let before = math::cost(0, 0, 100 * S);
    let after = math::cost(60 * S, 0, 100 * S);
    assert_eq!(client.quote_buy(&Side::Yes, &(60 * S)), after - before + 1);
}

#[test]
fn buy_debits_collateral_credits_shares_and_moves_price() {
    let env = Env::default();
    let (client, token, trader) = setup(&env);
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
