#![cfg(test)]
extern crate std;

use crate::{ExitStatus, MarketLiquidityVault, MarketLiquidityVaultClient, Phase, TerminalOutcome};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, BytesN, Env};

const TARGET: i128 = 100_000_000;
const FUNDING_DEADLINE: u64 = 2_000;
const ACTIVATION_CUTOFF: u64 = 2_500;

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn set_time(env: &Env, timestamp: u64) {
    env.ledger().with_mut(|ledger| ledger.timestamp = timestamp);
}

fn setup(
    env: &Env,
) -> (
    MarketLiquidityVaultClient<'_>,
    Address,
    Address,
    Address,
    Address,
) {
    env.mock_all_auths();
    set_time(env, 1_000);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let factory = Address::generate(env);
    let controller = Address::generate(env);
    let market = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&controller, &(TARGET * 10));
    let contract = env.register(
        MarketLiquidityVault,
        (
            token.clone(),
            factory.clone(),
            controller.clone(),
            id(env, 9),
            TARGET,
            FUNDING_DEADLINE,
            ACTIVATION_CUTOFF,
            7u32,
        ),
    );
    (
        MarketLiquidityVaultClient::new(env, &contract),
        token,
        factory,
        controller,
        market,
    )
}

#[test]
fn funds_permissionlessly_through_the_private_controller() {
    let env = Env::default();
    let (client, token, _factory, controller, _market) = setup(&env);

    let first = client.fund(&controller, &id(&env, 1), &40_000_000, &0);
    assert_eq!(first.accepted_assets, 40_000_000);
    assert_eq!(first.unused_assets, 0);
    assert_eq!(first.shares_minted, 40_000_000);
    assert_eq!(first.state_version, 1);
    assert_eq!(client.info().phase, Phase::Funding);

    let second = client.fund(&controller, &id(&env, 2), &70_000_000, &1);
    assert_eq!(second.accepted_assets, 60_000_000);
    assert_eq!(second.unused_assets, 10_000_000);
    assert_eq!(second.shares_minted, 60_000_000);
    let info = client.info();
    assert_eq!(info.phase, Phase::Ready);
    assert_eq!(info.funded_assets, TARGET);
    assert_eq!(info.total_shares, TARGET);
    assert_eq!(
        TokenClient::new(&env, &token).balance(&client.address),
        TARGET
    );
}

#[test]
fn rejects_duplicate_commitments_zero_funding_and_stale_versions() {
    let env = Env::default();
    let (client, _token, _factory, controller, _market) = setup(&env);
    client.fund(&controller, &id(&env, 1), &40_000_000, &0);
    assert!(client.try_fund(&controller, &id(&env, 1), &1, &1).is_err());
    assert!(client.try_fund(&controller, &id(&env, 2), &0, &1).is_err());
    assert!(client.try_fund(&controller, &id(&env, 2), &1, &0).is_err());
}

#[test]
fn funding_stage_unfund_uses_tracked_assets_and_last_share_gets_the_remainder() {
    let env = Env::default();
    let (client, token, _factory, controller, _market) = setup(&env);
    let tok = TokenClient::new(&env, &token);
    client.fund(&controller, &id(&env, 1), &60_000_000, &0);
    let before = tok.balance(&controller);
    assert_eq!(client.unfund(&controller, &20_000_000, &1), 20_000_000);
    assert_eq!(tok.balance(&controller), before + 20_000_000);
    assert_eq!(client.info().funded_assets, 40_000_000);
    assert_eq!(client.unfund(&controller, &40_000_000, &2), 40_000_000);
    assert_eq!(client.info().total_shares, 0);
    assert_eq!(client.info().funded_assets, 0);
}

#[test]
fn direct_donations_never_mint_shares_or_increase_accounted_assets() {
    let env = Env::default();
    let (client, token, _factory, controller, _market) = setup(&env);
    let donor = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&donor, &9_000_000);
    TokenClient::new(&env, &token).transfer(&donor, &client.address, &9_000_000);
    assert_eq!(client.unallocated_balance(), 9_000_000);
    assert_eq!(client.info().funded_assets, 0);
    assert_eq!(client.info().total_shares, 0);
    assert_eq!(
        client
            .fund(&controller, &id(&env, 1), &10_000_000, &0)
            .shares_minted,
        10_000_000
    );
    assert_eq!(client.unallocated_balance(), 9_000_000);
}

#[test]
fn prefunded_controller_path_preserves_prior_donations() {
    let env = Env::default();
    let (client, token, _factory, controller, _market) = setup(&env);
    let donor = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&donor, &9_000_000);
    TokenClient::new(&env, &token).transfer(&donor, &client.address, &9_000_000);

    TokenClient::new(&env, &token).transfer(&controller, &client.address, &10_000_000);
    let funded = client.fund_received(&controller, &id(&env, 1), &10_000_000, &9_000_000, &0);
    assert_eq!(funded.accepted_assets, 10_000_000);
    assert_eq!(funded.shares_minted, 10_000_000);
    assert_eq!(client.info().funded_assets, 10_000_000);
    assert_eq!(client.unallocated_balance(), 9_000_000);
}

#[test]
fn prefunded_controller_path_rejects_a_false_donation_baseline() {
    let env = Env::default();
    let (client, token, _factory, controller, _market) = setup(&env);
    let donor = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&donor, &9_000_000);
    TokenClient::new(&env, &token).transfer(&donor, &client.address, &9_000_000);
    TokenClient::new(&env, &token).transfer(&controller, &client.address, &10_000_000);

    assert!(client
        .try_fund_received(&controller, &id(&env, 1), &10_000_000, &0, &0)
        .is_err());
    assert_eq!(client.info().funded_assets, 0);
    assert_eq!(client.info().total_shares, 0);
}

#[test]
fn expired_underfunded_vault_cancels_and_refunds_without_factory_or_creator() {
    let env = Env::default();
    let (client, _token, _factory, controller, _market) = setup(&env);
    client.fund(&controller, &id(&env, 1), &30_000_000, &0);
    set_time(&env, FUNDING_DEADLINE + 1);
    client.cancel(&1);
    assert_eq!(client.info().phase, Phase::Cancelled);
    assert_eq!(
        client.redeem_terminal(&controller, &30_000_000, &2),
        30_000_000
    );
    assert_eq!(client.info().phase, Phase::Settled);
}

#[test]
fn activation_is_exact_and_freezes_funding_stage_mint_and_burn() {
    let env = Env::default();
    let (client, token, factory, controller, market) = setup(&env);
    client.fund(&controller, &id(&env, 1), &TARGET, &0);
    assert_eq!(client.activate(&factory, &market, &1), TARGET);
    let info = client.info();
    assert_eq!(info.phase, Phase::Active);
    assert_eq!(info.market, Some(market.clone()));
    assert_eq!(info.funded_assets, TARGET);
    assert_eq!(TokenClient::new(&env, &token).balance(&market), TARGET);
    assert!(client.try_fund(&controller, &id(&env, 2), &1, &2).is_err());
    assert!(client.try_unfund(&controller, &1, &2).is_err());
}

#[test]
fn active_exit_is_state_bound_and_does_not_reduce_market_backing() {
    let env = Env::default();
    let (client, token, factory, controller, market) = setup(&env);
    client.fund(&controller, &id(&env, 1), &TARGET, &0);
    client.activate(&factory, &market, &1);
    let market_balance = TokenClient::new(&env, &token).balance(&market);
    set_time(&env, 1_100);
    client.sync_market_state(
        &market,
        &7,
        &70_000_000,
        &90_000_000,
        &1_000_000,
        &1_050,
        &2,
    );

    client.request_exit(
        &controller,
        &id(&env, 3),
        &40_000_000,
        &32_000_000,
        &id(&env, 4),
        &1_800,
        &3,
    );
    let fill = client.match_exit(
        &controller,
        &id(&env, 3),
        &10_000_000,
        &8_000_000,
        &7,
        &70_000_000,
        &90_000_000,
        &1_000_000,
        &1_050,
        &300,
        &4,
    );
    assert_eq!(fill.shares_transferred, 10_000_000);
    assert_eq!(fill.shares_remaining, 30_000_000);
    assert_eq!(client.exit(&id(&env, 3)).unwrap().status, ExitStatus::Open);
    assert_eq!(
        TokenClient::new(&env, &token).balance(&market),
        market_balance
    );

    assert!(client
        .try_match_exit(
            &controller,
            &id(&env, 3),
            &1,
            &1,
            &8,
            &70_000_000,
            &90_000_000,
            &1_000_000,
            &1_050,
            &300,
            &5,
        )
        .is_err());
}

#[test]
fn exit_can_be_cancelled_and_terminal_assets_redeem_pro_rata() {
    let env = Env::default();
    let (client, _token, factory, controller, market) = setup(&env);
    client.fund(&controller, &id(&env, 1), &TARGET, &0);
    client.activate(&factory, &market, &1);
    client.request_exit(
        &controller,
        &id(&env, 3),
        &40_000_000,
        &32_000_000,
        &id(&env, 4),
        &1_800,
        &2,
    );
    client.cancel_exit(&controller, &id(&env, 3), &3);
    assert_eq!(
        client.exit(&id(&env, 3)).unwrap().status,
        ExitStatus::Cancelled
    );

    client.record_terminal(&market, &80_000_000, &TerminalOutcome::Yes, &4);
    assert_eq!(client.info().phase, Phase::Settled);
    assert_eq!(
        client.redeem_terminal(&controller, &25_000_000, &5),
        20_000_000
    );
    assert_eq!(
        client.redeem_terminal(&controller, &75_000_000, &6),
        60_000_000
    );
    assert_eq!(client.info().terminal_assets, 0);
}

#[test]
fn void_requires_full_principal_return() {
    let env = Env::default();
    let (client, _token, factory, controller, market) = setup(&env);
    client.fund(&controller, &id(&env, 1), &TARGET, &0);
    client.activate(&factory, &market, &1);
    assert!(client
        .try_record_terminal(&market, &(TARGET - 1), &TerminalOutcome::Void, &2)
        .is_err());
}
