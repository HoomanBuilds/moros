#![cfg(test)]
extern crate std;

use crate::{math, LmsrMarket, LmsrMarketClient, MarketStatus, Outcome, PrivateMarketConfig, Side};
use market_liquidity_vault::{
    MarketLiquidityVault, MarketLiquidityVaultClient, Phase as LiquidityPhase,
};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, vec, Address, BytesN, Env, IntoVal, Symbol};

const S: i128 = 1 << 32; // 2^32 fixed-point scale

// Sample market metadata (resolution parameters read by the Reflector Resolver).
const ASSET: Symbol = symbol_short!("XLM");
const THRESHOLD: i128 = 25_000_000_000_000; // 0.25 with Reflector's 14 decimals
const EXPIRY: u64 = 2_000_000_000; // unix seconds
const BATCH_GRACE: u64 = 300;

fn bytes_id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Register a market with a fresh SAC collateral token, and a funded trader.
/// Returns (market client, collateral token address, trader address, admin address).
fn setup(env: &Env) -> (LmsrMarketClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let trader = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&trader, &(1_000_000 * S));
    let client = LmsrMarketClient::new(
        env,
        &env.register(
            LmsrMarket {},
            (
                admin.clone(),
                token.clone(),
                100i128 * S,
                ASSET,
                THRESHOLD,
                EXPIRY,
                BATCH_GRACE,
            ),
        ),
    );
    (client, token, trader, admin)
}

fn set_time(env: &Env, timestamp: u64) {
    env.ledger().with_mut(|ledger| ledger.timestamp = timestamp);
}

fn finalize(env: &Env) {
    set_time(env, EXPIRY + BATCH_GRACE);
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    // b = 0 -> the constructor panics, so registration fails
    env.register(
        LmsrMarket {},
        (admin, token, 0i128, ASSET, THRESHOLD, EXPIRY, BATCH_GRACE),
    );
}

#[test]
fn init_stores_market_metadata() {
    let env = Env::default();
    let (client, _token, _trader, _admin) = setup(&env);
    let info = client.market_info();
    assert_eq!(info.asset, ASSET);
    assert_eq!(info.threshold, THRESHOLD);
    assert_eq!(info.expiry, EXPIRY);
    assert_eq!(info.finalize_after, EXPIRY + BATCH_GRACE);
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
fn batcher_is_one_time_requires_a_pristine_book_and_locks_direct_trading() {
    let env = Env::default();
    let (client, _token, trader, admin) = setup(&env);
    client.buy(&trader, &Side::Yes, &S);
    assert!(client
        .try_set_batcher(&admin, &Address::generate(&env))
        .is_err());

    let env2 = Env::default();
    let (client2, _token2, trader2, admin2) = setup(&env2);
    client2.set_batcher(&admin2, &Address::generate(&env2));
    assert!(client2
        .try_set_batcher(&admin2, &Address::generate(&env2))
        .is_err());
    assert!(client2.try_quote_buy(&Side::Yes, &S).is_err());
    assert!(client2.try_buy(&trader2, &Side::Yes, &S).is_err());
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
    let (client, _token, trader, admin) = setup(&env);
    assert_eq!(client.outcome(), None);
    client.buy(&trader, &Side::Yes, &S);
    client.buy(&trader, &Side::No, &S);
    finalize(&env);
    client.resolve(&admin, &Outcome::Yes);
    assert_eq!(client.outcome(), Some(Outcome::Yes));
}

#[test]
fn resolve_rejects_non_admin() {
    let env = Env::default();
    let (client, _token, _trader, _admin) = setup(&env);
    let stranger = Address::generate(&env);
    finalize(&env);
    assert!(client.try_resolve(&stranger, &Outcome::Yes).is_err());
}

#[test]
fn resolve_accepts_registered_resolver() {
    let env = Env::default();
    let (client, _token, trader, admin) = setup(&env);
    let resolver = Address::generate(&env);
    client.set_resolver(&admin, &resolver);
    client.buy(&trader, &Side::Yes, &S);
    client.buy(&trader, &Side::No, &S);
    finalize(&env);
    client.resolve(&resolver, &Outcome::No);
    assert_eq!(client.outcome(), Some(Outcome::No));
}

#[test]
fn resolve_rejects_unregistered_resolver() {
    let env = Env::default();
    let (client, _token, _trader, admin) = setup(&env);
    let resolver = Address::generate(&env);
    let stranger = Address::generate(&env);
    client.set_resolver(&admin, &resolver);
    finalize(&env);
    assert!(client.try_resolve(&stranger, &Outcome::Yes).is_err());
}

#[test]
fn cannot_resolve_twice() {
    let env = Env::default();
    let (client, _token, _trader, admin) = setup(&env);
    finalize(&env);
    client.resolve(&admin, &Outcome::Yes);
    assert!(client.try_resolve(&admin, &Outcome::No).is_err());
}

#[test]
fn lifecycle_status_tracks_open_closed_resolved_and_voided() {
    let env = Env::default();
    let (resolved, token, trader, admin) = setup(&env);
    assert_eq!(resolved.status(), MarketStatus::Open);
    fund_subsidy(&env, &resolved, &token, &admin);
    resolved.buy(&trader, &Side::Yes, &S);
    resolved.buy(&trader, &Side::No, &S);
    set_time(&env, EXPIRY);
    assert_eq!(resolved.status(), MarketStatus::Closed);
    finalize(&env);
    resolved.resolve(&admin, &Outcome::Yes);
    assert_eq!(resolved.status(), MarketStatus::Resolved);

    let void_env = Env::default();
    let (voided, _token, _trader, void_admin) = setup(&void_env);
    finalize(&void_env);
    voided.void(&void_admin);
    assert_eq!(voided.status(), MarketStatus::Voided);
}

#[test]
fn direct_trading_stops_at_expiry() {
    let env = Env::default();
    let (client, _token, trader, _admin) = setup(&env);
    set_time(&env, EXPIRY);
    assert!(client.try_quote_buy(&Side::Yes, &S).is_err());
    assert!(client.try_buy(&trader, &Side::Yes, &S).is_err());
}

#[test]
fn batch_grace_accepts_final_batch_then_closes() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let batcher = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&batcher, &(1_000 * S));
    client.set_batcher(&admin, &batcher);

    set_time(&env, EXPIRY);
    assert!(client.apply_batch(&batcher, &S, &0) > 0);

    finalize(&env);
    assert!(client.try_apply_batch(&batcher, &S, &0).is_err());
}

#[test]
fn resolution_waits_for_final_batch_window() {
    let env = Env::default();
    let (client, _token, _trader, admin) = setup(&env);
    set_time(&env, EXPIRY);
    assert!(client.try_resolve(&admin, &Outcome::Yes).is_err());
    finalize(&env);
    client.resolve(&admin, &Outcome::Yes);
}

#[test]
fn resolver_address_is_permanently_locked() {
    let env = Env::default();
    let (client, _token, _trader, admin) = setup(&env);
    let resolver = Address::generate(&env);
    client.set_resolver(&admin, &resolver);
    assert!(client
        .try_set_resolver(&admin, &Address::generate(&env))
        .is_err());
    finalize(&env);
    assert!(client.try_resolve(&admin, &Outcome::Yes).is_err());
    client.resolve(&resolver, &Outcome::Yes);
}

/// Fund the pool subsidy with >= b*ln2 so winning payouts are always solvent.
fn fund_subsidy(env: &Env, client: &LmsrMarketClient, token: &Address, admin: &Address) {
    StellarAssetClient::new(env, token).mint(admin, &(100 * S)); // > b*ln2 (~69.31)
    client.fund(admin, &(100 * S));
}

#[test]
fn void_refunds_batch_collateral_and_subsidy() {
    let env = Env::default();
    let (client, token, _trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    let batcher = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&batcher, &(1_000 * S));
    client.set_batcher(&admin, &batcher);
    fund_subsidy(&env, &client, &token, &admin);

    let batcher_before = tok.balance(&batcher);
    let batch_cost = client.apply_batch(&batcher, &(10 * S), &0);
    assert_eq!(tok.balance(&batcher), batcher_before - batch_cost);

    finalize(&env);
    client.void(&admin);
    assert_eq!(tok.balance(&admin), 100 * S);
    assert_eq!(tok.balance(&batcher), batcher_before);
    assert_eq!(tok.balance(&client.address), 0);
}

fn setup_private(
    env: &Env,
) -> (
    LmsrMarketClient<'_>,
    MarketLiquidityVaultClient<'_>,
    Address,
    Address,
    Address,
) {
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let factory = Address::generate(env);
    let shared_vault = Address::generate(env);
    let resolver = Address::generate(env);
    let market_address = env.register(
        LmsrMarket,
        (
            factory.clone(),
            token.clone(),
            20i128 * S,
            ASSET,
            THRESHOLD,
            2_000u64,
            100u64,
        ),
    );
    let market = LmsrMarketClient::new(env, &market_address);
    let liquidity_address = env.register(
        MarketLiquidityVault,
        (
            token.clone(),
            factory.clone(),
            shared_vault.clone(),
            bytes_id(env, 80),
            200_000_000i128,
            1_500u64,
            1_800u64,
            7u32,
        ),
    );
    let liquidity = MarketLiquidityVaultClient::new(env, &liquidity_address);
    StellarAssetClient::new(env, &token).mint(&shared_vault, &1_000_000_000);
    liquidity.fund(&shared_vault, &bytes_id(env, 81), &200_000_000, &0);
    liquidity.activate(&factory, &market_address, &1);
    market.activate_private(
        &factory,
        &PrivateMarketConfig {
            batcher: shared_vault.clone(),
            liquidity_vault: liquidity_address,
            resolver: resolver.clone(),
            rules_hash: bytes_id(env, 82),
            funding: 200_000_000,
            fee_bps: 400,
            lp_fee_share_bps: 5_000,
            lot_size: S,
            maximum_batch_size: 8,
            minimum_side_count: 0,
            maximum_price_movement: S / 4,
        },
    );
    (market, liquidity, token, shared_vault, resolver)
}

fn vest_fees(env: &Env, market: &LmsrMarketClient<'_>, token: &Address, shared_vault: &Address) {
    let fees = market.fee_state();
    let prior_unallocated = market.unallocated_balance();
    if fees.conditional_lp_fee > 0 {
        TokenClient::new(env, token).transfer(
            shared_vault,
            &market.address,
            &fees.conditional_lp_fee,
        );
    }
    let vested = market.record_vested_fees(
        shared_vault,
        &fees.conditional_lp_fee,
        &prior_unallocated,
        &market.state_version(),
    );
    assert!(vested.vested);
}

#[test]
fn private_market_returns_normal_terminal_equity_to_lp_shares() {
    let env = Env::default();
    let (market, liquidity, token, shared_vault, resolver) = setup_private(&env);
    let private = market.private_config().unwrap();
    assert_eq!(private.funding, 200_000_000);
    assert_eq!(private.lot_size, S);
    assert!(market.try_fund(&Address::generate(&env), &1).is_err());
    assert!(market.try_buy(&shared_vault, &Side::Yes, &S).is_err());

    let quote = market.apply_private_batch(&shared_vault, &0, &4, &4);
    assert_eq!(quote.aggregate_market_charge, 40_000_000);
    assert_eq!(quote.yes_price, S / 2);
    assert_eq!(quote.no_price, S / 2);
    assert_eq!(quote.yes_charge_per_position, 5_000_000);
    assert_eq!(quote.no_charge_per_position, 5_000_000);
    assert_eq!(quote.fee_per_position, 100_000);
    assert_eq!(quote.fee_escrow, 800_000);
    env.ledger().with_mut(|ledger| ledger.timestamp = 2_100);
    market.resolve(&resolver, &Outcome::Yes);
    assert_eq!(market.redeem(&shared_vault, &Side::Yes), 40_000_000);
    assert_eq!(market.redeem(&shared_vault, &Side::No), 0);
    assert!(market.try_settle_liquidity().is_err());
    vest_fees(&env, &market, &token, &shared_vault);
    assert_eq!(market.settle_liquidity(), 200_400_000);

    let info = liquidity.info();
    assert_eq!(info.phase, LiquidityPhase::Settled);
    assert_eq!(info.terminal_assets, 200_400_000);
    assert_eq!(TokenClient::new(&env, &token).balance(&market.address), 0);
}

#[test]
fn private_batch_quote_matches_the_shared_integer_fixture_and_rejects_stale_state() {
    let env = Env::default();
    let (market, liquidity, _token, shared_vault, _resolver) = setup_private(&env);
    let initial = market.scenario_state();
    assert_eq!(initial.state_version, 0);
    assert_eq!(initial.market_assets, 200_000_000);
    assert_eq!(initial.payout_if_yes, 0);
    assert_eq!(initial.payout_if_no, 0);
    assert_eq!(initial.equity_if_yes, 200_000_000);
    assert_eq!(initial.equity_if_no, 200_000_000);
    assert_eq!(
        liquidity.market_snapshot().unwrap().state_version,
        initial.state_version
    );
    let quote = market.quote_private_batch(&0, &2, &6);
    assert_eq!(quote.batch_size, 8);
    assert_eq!(quote.pre_yes_price, 2_147_483_648);
    assert_eq!(quote.post_yes_price, 1_933_448_258);
    assert_eq!(quote.yes_price, 2_040_288_020);
    assert_eq!(quote.no_price, 2_254_679_276);
    assert_eq!(quote.aggregate_market_charge, 40_998_338);
    assert_eq!(quote.yes_market_cost, 9_500_832);
    assert_eq!(quote.no_market_cost, 31_497_506);
    assert_eq!(quote.yes_charge_per_position, 4_750_416);
    assert_eq!(quote.no_charge_per_position, 5_249_584);
    assert_eq!(quote.rounding_contribution, 2);
    assert_eq!(quote.fee_per_position, 99_751);
    assert_eq!(quote.fee_escrow, 798_008);

    assert_eq!(market.apply_private_batch(&shared_vault, &0, &2, &6), quote);
    assert_eq!(market.state_version(), 1);
    let after = market.scenario_state();
    assert_eq!(after.state_version, 1);
    assert_eq!(after.market_assets, 240_998_338);
    assert_eq!(after.payout_if_yes, 20_000_000);
    assert_eq!(after.payout_if_no, 60_000_000);
    assert_eq!(after.conditional_lp_fees, 399_003);
    assert_eq!(after.equity_if_yes, 221_397_341);
    assert_eq!(after.equity_if_no, 181_397_341);
    let snapshot = liquidity.market_snapshot().unwrap();
    assert_eq!(snapshot.state_version, after.state_version);
    assert_eq!(snapshot.equity_if_yes, after.equity_if_yes);
    assert_eq!(snapshot.equity_if_no, after.equity_if_no);
    assert_eq!(snapshot.conditional_lp_fees, after.conditional_lp_fees);
    assert_eq!(snapshot.updated_at, 1_000);
    assert!(market
        .try_apply_private_batch(&shared_vault, &0, &2, &6)
        .is_err());
}

#[test]
fn private_batch_quote_prices_variable_hidden_quantities() {
    let env = Env::default();
    let (market, _liquidity, _token, shared_vault, _resolver) = setup_private(&env);
    assert!(market.try_quote_private_batch(&0, &0, &0).is_err());
    assert!(market.try_quote_private_batch(&0, &2, &7_999).is_err());
    let quote = market.quote_private_batch(&0, &5, &7);
    assert_eq!(quote.batch_size, 12);
    assert_eq!(quote.yes_count, 5);
    assert_eq!(quote.no_count, 7);
    assert_eq!(
        quote.fee_escrow,
        quote.fee_per_position * i128::from(quote.batch_size),
    );

    assert_eq!(
        market.apply_private_batch(&shared_vault, &0, &5, &7),
        quote,
    );
    let state = market.scenario_state();
    assert_eq!(state.payout_if_yes, 50_000_000);
    assert_eq!(state.payout_if_no, 70_000_000);
}

#[test]
fn private_singleton_batches_move_price_and_handle_an_empty_side() {
    let env = Env::default();
    let (market, _liquidity, _token, shared_vault, _resolver) = setup_private(&env);
    let yes = market.quote_private_batch(&0, &1, &0);
    assert_eq!(yes.batch_size, 1);
    assert_eq!(yes.no_market_cost, 0);
    assert_eq!(yes.no_charge_per_position, 0);
    assert!(yes.post_yes_price > yes.pre_yes_price);
    market.apply_private_batch(&shared_vault, &0, &1, &0);

    let no = market.quote_private_batch(&1, &0, &1);
    assert_eq!(no.batch_size, 1);
    assert_eq!(no.yes_market_cost, 0);
    assert_eq!(no.yes_charge_per_position, 0);
    assert!(no.post_yes_price < no.pre_yes_price);
}

#[test]
fn direct_donations_never_become_private_market_lp_equity() {
    let env = Env::default();
    let (market, liquidity, token, shared_vault, resolver) = setup_private(&env);
    let donor = Address::generate(&env);
    let donation = 9_000_000;
    StellarAssetClient::new(&env, &token).mint(&donor, &donation);
    TokenClient::new(&env, &token).transfer(&donor, &market.address, &donation);
    assert_eq!(market.unallocated_balance(), donation);

    market.apply_private_batch(&shared_vault, &0, &4, &4);
    env.ledger().with_mut(|ledger| ledger.timestamp = 2_100);
    market.resolve(&resolver, &Outcome::Yes);
    market.redeem(&shared_vault, &Side::Yes);
    market.redeem(&shared_vault, &Side::No);
    vest_fees(&env, &market, &token, &shared_vault);

    assert_eq!(market.settle_liquidity(), 200_400_000);
    assert_eq!(liquidity.info().terminal_assets, 200_400_000);
    assert_eq!(market.unallocated_balance(), donation);
    assert_eq!(
        TokenClient::new(&env, &token).balance(&market.address),
        donation
    );
}

#[test]
fn private_one_sided_market_executes_then_voids_and_returns_lp_principal() {
    let env = Env::default();
    let (market, liquidity, token, shared_vault, resolver) = setup_private(&env);
    let donor = Address::generate(&env);
    let donation = 7_000_000;
    StellarAssetClient::new(&env, &token).mint(&donor, &donation);
    TokenClient::new(&env, &token).transfer(&donor, &market.address, &donation);
    market.apply_private_batch(&shared_vault, &0, &8, &0);
    assert!(market.try_apply_batch(&shared_vault, &(8 * S), &0).is_err());
    env.ledger().with_mut(|ledger| ledger.timestamp = 2_100);
    market.resolve(&resolver, &Outcome::Yes);

    assert_eq!(market.outcome(), Some(Outcome::Void));
    assert_eq!(liquidity.info().terminal_assets, 200_000_000);
    assert_eq!(market.unallocated_balance(), donation);
    assert_eq!(
        TokenClient::new(&env, &token).balance(&market.address),
        donation
    );
}

#[test]
fn void_refunds_direct_trader_in_unbatched_market() {
    let env = Env::default();
    let (client, token, trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    fund_subsidy(&env, &client, &token, &admin);
    let trader_before = tok.balance(&trader);
    let direct_cost = client.buy(&trader, &Side::Yes, &(10 * S));

    finalize(&env);
    client.void(&admin);
    assert_eq!(tok.balance(&admin), 100 * S);
    assert_eq!(tok.balance(&client.address), direct_cost);
    assert_eq!(client.redeem(&trader, &Side::Yes), direct_cost);
    assert_eq!(tok.balance(&trader), trader_before);
    assert_eq!(tok.balance(&client.address), 0);
}

#[test]
fn one_sided_market_is_voided_and_refunded() {
    let env = Env::default();
    let (client, token, trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    fund_subsidy(&env, &client, &token, &admin);
    let before = tok.balance(&trader);
    let paid = client.buy(&trader, &Side::Yes, &(25 * S));
    assert_eq!(client.get_state().1, 0);

    finalize(&env);
    client.resolve(&admin, &Outcome::Yes);
    assert_eq!(client.outcome(), Some(Outcome::Void));
    assert_eq!(client.redeem(&trader, &Side::Yes), paid);
    assert_eq!(tok.balance(&trader), before);
}

#[test]
fn redeem_pays_winning_shares_and_burns_them() {
    let env = Env::default();
    let (client, token, trader, admin) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    fund_subsidy(&env, &client, &token, &admin);
    client.buy(&trader, &Side::Yes, &(60 * S));
    client.buy(&trader, &Side::No, &S);
    finalize(&env);
    client.resolve(&admin, &Outcome::Yes);
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
    client.buy(&trader, &Side::Yes, &S);
    finalize(&env);
    client.resolve(&admin, &Outcome::Yes); // NO loses
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
    client.buy(&trader, &Side::No, &S);
    finalize(&env);
    assert!(client.try_resolve(&admin, &Outcome::Yes).is_err());
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
    let (client, _token, trader, admin) = setup(&env);
    client.buy(&trader, &Side::Yes, &S);
    client.buy(&trader, &Side::No, &S);
    finalize(&env);
    client.resolve(&admin, &Outcome::Yes);
    assert_eq!(
        env.events().all().filter_by_contract(&client.address),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("resolved"),).into_val(&env),
                Outcome::Yes.into_val(&env),
            ),
        ]
    );
}

#[test]
fn redeem_emits_event() {
    let env = Env::default();
    let (client, token, trader, admin) = setup(&env);
    fund_subsidy(&env, &client, &token, &admin);
    client.buy(&trader, &Side::Yes, &(60 * S));
    finalize(&env);
    client.resolve(&admin, &Outcome::Yes);
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
