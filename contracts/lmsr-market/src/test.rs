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
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let trader = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&trader, &(1_000_000 * S));
    let client = LmsrMarketClient::new(
        env,
        &env.register(
            LmsrMarket {},
            (admin.clone(), token.clone(), 100i128 * S, ASSET, THRESHOLD, EXPIRY),
        ),
    );
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
#[should_panic]
fn rejects_bad_liquidity_param() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    // b = 0 -> the constructor panics, so registration fails
    env.register(LmsrMarket {}, (admin, token, 0i128, ASSET, THRESHOLD, EXPIRY));
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
fn quote_buy_returns_atomic_charge_for_token_decimals() {
    let env = Env::default();
    let (client, token, _trader, _admin) = setup(&env);
    let pow = 10i128.pow(TokenClient::new(&env, &token).decimals());
    // internal LMSR cost is fixed-point (2^32); the quote is the token's atomic
    // amount = ceil(cost_fixed * 10^decimals / 2^32) (charge rounded up).
    let cost_fixed = math::cost(60 * S, 0, 100 * S) - math::cost(0, 0, 100 * S);
    let expected = (cost_fixed * pow + (S - 1)) / S;
    assert_eq!(client.quote_buy(&Side::Yes, &(60 * S)), expected);
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
fn apply_batch_moves_q_and_charges_batcher() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    let batcher = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&batcher, &(1_000_000 * S));
    client.set_batcher(&admin, &batcher);

    let dqyes = 30 * S;
    let dqno = 20 * S;
    let pow = 10i128.pow(tok.decimals());
    let cost_fixed = math::cost(dqyes, dqno, 100 * S) - math::cost(0, 0, 100 * S);
    let expected_net = (cost_fixed * pow + (S - 1)) / S;

    let start = tok.balance(&batcher);
    let net = client.apply_batch(&batcher, &dqyes, &dqno);

    assert_eq!(net, expected_net);
    assert_eq!(client.get_state(), (dqyes, dqno, 100 * S));
    assert_eq!(tok.balance(&batcher), start - net);
    assert_eq!(tok.balance(&client.address), net);
}

#[test]
fn quote_batch_equals_apply_batch_charge() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let batcher = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&batcher, &(1_000_000 * S));
    client.set_batcher(&admin, &batcher);
    let quoted = client.quote_batch(&(30 * S), &(20 * S));
    let charged = client.apply_batch(&batcher, &(30 * S), &(20 * S));
    assert_eq!(quoted, charged);
}

#[test]
fn apply_batch_rejects_non_batcher() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let batcher = Address::generate(&env);
    let mallory = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&mallory, &(1_000_000 * S));
    client.set_batcher(&admin, &batcher);

    let r = client.try_apply_batch(&mallory, &(10 * S), &(10 * S));
    assert!(r.is_err() || r.unwrap().is_err());
    assert_eq!(client.get_state(), (0, 0, 100 * S));
}

#[test]
fn apply_batch_committee_moves_q_with_quorum() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let funder = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&funder, &(1_000_000 * S));
    client.set_committee(&admin, &vec![&env, m1.clone(), m2.clone(), m3.clone()], &2);

    let quoted = client.quote_batch(&(30 * S), &(20 * S));
    let start = tok.balance(&funder);
    let net =
        client.apply_batch_committee(&vec![&env, m1.clone(), m3.clone()], &funder, &(30 * S), &(20 * S));

    assert_eq!(net, quoted);
    assert_eq!(client.get_state(), (30 * S, 20 * S, 100 * S));
    assert_eq!(tok.balance(&funder), start - net);
    assert_eq!(tok.balance(&client.address), net);
}

#[test]
fn apply_batch_committee_rejects_below_threshold() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let funder = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&funder, &(1_000_000 * S));
    client.set_committee(&admin, &vec![&env, m1.clone(), m2.clone(), m3.clone()], &2);

    let r = client.try_apply_batch_committee(&vec![&env, m1.clone()], &funder, &(30 * S), &(20 * S));
    assert!(r.is_err() || r.unwrap().is_err());
    assert_eq!(client.get_state(), (0, 0, 100 * S));
}

#[test]
fn apply_batch_committee_rejects_non_member() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let mallory = Address::generate(&env);
    let funder = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&funder, &(1_000_000 * S));
    client.set_committee(&admin, &vec![&env, m1.clone(), m2.clone(), m3.clone()], &2);

    let r =
        client.try_apply_batch_committee(&vec![&env, m1.clone(), mallory.clone()], &funder, &(30 * S), &(20 * S));
    assert!(r.is_err() || r.unwrap().is_err());
    assert_eq!(client.get_state(), (0, 0, 100 * S));
}

#[test]
fn apply_batch_committee_rejects_duplicate_signer() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let funder = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&funder, &(1_000_000 * S));
    client.set_committee(&admin, &vec![&env, m1.clone(), m2.clone(), m3.clone()], &2);

    let r =
        client.try_apply_batch_committee(&vec![&env, m1.clone(), m1.clone()], &funder, &(30 * S), &(20 * S));
    assert!(r.is_err() || r.unwrap().is_err());
    assert_eq!(client.get_state(), (0, 0, 100 * S));
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
    let pow = 10i128.pow(tok.decimals());

    let payout = client.redeem(&trader, &Side::Yes);

    assert_eq!(payout, 60 * pow); // 60 winning shares -> 60 tokens (atomic)
    assert_eq!(client.shares_of(&trader, &Side::Yes), 0); // burned
    assert_eq!(tok.balance(&trader), before + 60 * pow); // paid out
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
fn extend_ttl_is_callable_and_preserves_state() {
    let env = Env::default();
    let (client, _token, trader, _admin) = setup(&env);
    client.buy(&trader, &Side::Yes, &(10 * S));
    client.extend_ttl();
    assert_eq!(client.get_state(), (10 * S, 0, 100 * S));
    assert_eq!(client.shares_of(&trader, &Side::Yes), 10 * S);
}

#[test]
fn resolve_rejects_when_pool_cannot_cover_payouts() {
    let env = Env::default();
    let (client, _token, trader, admin) = setup(&env);
    // Buy 60 YES but DON'T fund the subsidy: the pool holds only the buy proceeds
    // (~34 units) while a YES win owes 60 -> resolution must be rejected as insolvent.
    client.buy(&trader, &Side::Yes, &(60 * S));
    assert!(client.try_resolve(&admin, &Side::Yes).is_err());
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
