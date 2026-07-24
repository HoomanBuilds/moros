#![cfg(test)]
extern crate std;

use crate::{
    AllocationStatus, CandidateStatus, PooledLiquidityVault, PooledLiquidityVaultClient, RiskPolicy,
};
use market_liquidity_vault::{
    MarketLiquidityVault, MarketLiquidityVaultClient, Phase, TerminalOutcome,
};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, Address, BytesN, Env};

const TARGET: i128 = 20_000_000;
const DEPOSIT: i128 = 100_000_000;

struct Setup {
    env: Env,
    token: Address,
    factory: Address,
    shared: Address,
    pool: Address,
}

impl Setup {
    fn pool(&self) -> PooledLiquidityVaultClient<'_> {
        PooledLiquidityVaultClient::new(&self.env, &self.pool)
    }
}

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn policy() -> RiskPolicy {
    RiskPolicy {
        deposit_cap: 10_000_000_000,
        max_active_allocations: 8,
        max_deployed_bps: 8_000,
        max_market_bps: 2_500,
        max_group_bps: 5_000,
        minimum_idle_bps: 2_000,
        withdrawal_window: 3_600,
        max_withdrawal_bps: 1_000,
    }
}

fn bootstrap_policy() -> RiskPolicy {
    RiskPolicy {
        max_market_bps: 8_000,
        max_group_bps: 8_000,
        ..policy()
    }
}

fn set_time(env: &Env, timestamp: u64) {
    env.ledger().with_mut(|ledger| ledger.timestamp = timestamp);
}

fn setup() -> Setup {
    setup_with_policy(policy())
}

fn setup_with_policy(risk_policy: RiskPolicy) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    set_time(&env, 1_000);
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let factory = Address::generate(&env);
    let shared = Address::generate(&env);
    let governance = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&shared, &10_000_000_000);
    let pool_address = env.register(
        PooledLiquidityVault,
        (
            token.clone(),
            factory.clone(),
            shared.clone(),
            governance,
            risk_policy,
        ),
    );
    Setup {
        env,
        token,
        factory,
        shared,
        pool: pool_address,
    }
}

fn deposit(setup: &Setup, amount: i128, byte: u8) -> i128 {
    let pool = setup.pool();
    let version = pool.state_version();
    let prior = pool.unallocated_balance();
    let shares = pool.preview_deposit(&amount);
    TokenClient::new(&setup.env, &setup.token).transfer(&setup.shared, &setup.pool, &amount);
    let result = pool.fund_received(
        &setup.shared,
        &id(&setup.env, byte),
        &amount,
        &prior,
        &version,
    );
    assert_eq!(result.shares_minted, shares);
    shares
}

fn cell(
    setup: &Setup,
    proposal: BytesN<32>,
    deadline: u64,
    cutoff: u64,
) -> MarketLiquidityVaultClient<'_> {
    cell_with_target(setup, proposal, TARGET, deadline, cutoff)
}

fn cell_with_target(
    setup: &Setup,
    proposal: BytesN<32>,
    target: i128,
    deadline: u64,
    cutoff: u64,
) -> MarketLiquidityVaultClient<'_> {
    let address = setup.env.register(
        MarketLiquidityVault,
        (
            setup.token.clone(),
            setup.factory.clone(),
            setup.pool.clone(),
            proposal,
            target,
            deadline,
            cutoff,
            7u32,
        ),
    );
    MarketLiquidityVaultClient::new(&setup.env, &address)
}

fn register(setup: &Setup, cell: &MarketLiquidityVaultClient<'_>, proposal: BytesN<32>) -> u64 {
    register_with_target(setup, cell, proposal, TARGET)
}

fn register_with_target(
    setup: &Setup,
    cell: &MarketLiquidityVaultClient<'_>,
    proposal: BytesN<32>,
    target: i128,
) -> u64 {
    setup.pool().register_candidate(
        &setup.factory,
        &proposal,
        &cell.address,
        &symbol_short!("XLM"),
        &symbol_short!("CRYPTO"),
        &target,
        &2_000,
    )
}

#[test]
fn bootstrap_pool_funds_the_minimum_market_and_keeps_twenty_percent_idle() {
    let setup = setup_with_policy(bootstrap_policy());
    let pool = setup.pool();
    deposit(&setup, 250_000_000, 1);
    let proposal = id(&setup.env, 11);
    let cell = cell_with_target(&setup, proposal.clone(), 200_000_000, 2_000, 2_500);
    register_with_target(&setup, &cell, proposal, 200_000_000);

    let allocation = pool.allocate_next().unwrap();
    assert_eq!(allocation.principal, 200_000_000);
    assert_eq!(pool.info().idle_assets, 50_000_000);
    assert_eq!(cell.info().phase, Phase::Ready);
}

#[test]
fn deposits_mint_private_pool_shares_and_ignore_donations() {
    let setup = setup();
    let pool = setup.pool();
    let first = deposit(&setup, DEPOSIT, 1);
    assert_eq!(first, DEPOSIT);
    assert_eq!(pool.nav().deposit_nav, DEPOSIT);

    let donor = Address::generate(&setup.env);
    StellarAssetClient::new(&setup.env, &setup.token).mint(&donor, &50_000_000);
    TokenClient::new(&setup.env, &setup.token).transfer(&donor, &setup.pool, &50_000_000);
    assert_eq!(pool.unallocated_balance(), 50_000_000);
    assert_eq!(pool.nav().deposit_nav, DEPOSIT);
    assert_eq!(pool.preview_deposit(&10_000_000), 10_000_000);
    assert!(pool
        .try_fund_received(
            &setup.shared,
            &id(&setup.env, 2),
            &10_000_000,
            &0,
            &pool.state_version(),
        )
        .is_err());
}

#[test]
fn fully_idle_pool_redeems_all_shares_without_a_rate_limit() {
    let setup = setup();
    let pool = setup.pool();
    let shares = deposit(&setup, DEPOSIT, 1);
    let preview = pool.preview_redeem(&shares);
    assert_eq!(preview.assets, DEPOSIT);
    assert_eq!(preview.immediate_assets, DEPOSIT);
    assert!(preview.can_redeem_now);
    assert_eq!(
        pool.unfund(&setup.shared, &shares, &pool.state_version()),
        DEPOSIT
    );
    assert_eq!(pool.info().total_shares, 0);
    assert_eq!(pool.info().idle_assets, 0);
}

#[test]
fn fifo_allocation_funds_the_next_isolated_cell() {
    let setup = setup();
    let pool = setup.pool();
    deposit(&setup, DEPOSIT, 1);
    let first_proposal = id(&setup.env, 11);
    let second_proposal = id(&setup.env, 12);
    let first = cell(&setup, first_proposal.clone(), 2_000, 2_500);
    let second = cell(&setup, second_proposal.clone(), 2_000, 2_500);
    assert_eq!(register(&setup, &first, first_proposal), 0);
    assert_eq!(register(&setup, &second, second_proposal), 1);

    let allocated = pool.allocate_next().unwrap();
    assert_eq!(allocated.liquidity_vault, first.address);
    assert_eq!(allocated.principal, TARGET);
    assert_eq!(allocated.status, AllocationStatus::Deployed);
    assert_eq!(first.info().phase, Phase::Ready);
    assert_eq!(second.info().phase, Phase::Funding);
    assert_eq!(
        pool.candidate(&0).unwrap().status,
        CandidateStatus::Allocated
    );
    assert_eq!(pool.info().queue_head, 1);
    assert_eq!(pool.info().pending_candidates, 1);
    assert_eq!(pool.info().idle_assets, DEPOSIT - TARGET);
}

#[test]
fn an_oversized_candidate_does_not_block_an_eligible_market() {
    let setup = setup();
    let pool = setup.pool();
    deposit(&setup, DEPOSIT, 1);
    let oversized_proposal = id(&setup.env, 11);
    let eligible_proposal = id(&setup.env, 12);
    let oversized = cell_with_target(&setup, oversized_proposal.clone(), 30_000_000, 2_000, 2_500);
    let eligible = cell(&setup, eligible_proposal.clone(), 2_000, 2_500);
    register_with_target(&setup, &oversized, oversized_proposal, 30_000_000);
    register(&setup, &eligible, eligible_proposal);

    let allocated = pool.allocate_next().unwrap();
    assert_eq!(allocated.liquidity_vault, eligible.address);
    assert_eq!(pool.candidate(&0).unwrap().status, CandidateStatus::Pending);
    assert_eq!(
        pool.candidate(&1).unwrap().status,
        CandidateStatus::Allocated
    );
    assert_eq!(pool.info().queue_head, 0);
    assert_eq!(pool.info().pending_candidates, 1);
}

#[test]
fn conservative_nav_protects_deposits_and_redemptions() {
    let setup = setup();
    let pool = setup.pool();
    deposit(&setup, DEPOSIT, 1);
    let proposal = id(&setup.env, 11);
    let cell = cell(&setup, proposal.clone(), 2_000, 2_500);
    register(&setup, &cell, proposal);
    pool.allocate_next();

    let market = Address::generate(&setup.env);
    cell.activate(&setup.factory, &market, &cell.state_version());
    set_time(&setup.env, 1_100);
    cell.sync_market_state(
        &market,
        &7,
        &15_000_000,
        &25_000_000,
        &2_000_000,
        &1_100,
        &cell.state_version(),
    );

    let nav = pool.nav();
    assert_eq!(nav.idle_assets, 80_000_000);
    assert_eq!(nav.active_floor_assets, 13_000_000);
    assert_eq!(nav.active_ceiling_assets, 23_000_000);
    assert_eq!(nav.withdrawal_nav, 93_000_000);
    assert_eq!(nav.deposit_nav, 103_000_000);
    assert_eq!(nav.conditional_fees_excluded, 2_000_000);

    let expected =
        10_000_000i128.checked_mul(DEPOSIT + 1_000_000).unwrap() / (103_000_000 + 1_000_000);
    assert_eq!(pool.preview_deposit(&10_000_000), expected);

    let preview = pool.preview_redeem(&10_000_000);
    assert_eq!(preview.assets, 9_306_930);
    assert!(!preview.can_redeem_now);
    assert_eq!(preview.immediate_assets, 9_300_000);
}

#[test]
fn immediate_redemption_obeys_idle_and_window_limits() {
    let setup = setup();
    let pool = setup.pool();
    let shares = deposit(&setup, DEPOSIT, 1);
    let proposal = id(&setup.env, 11);
    let cell = cell(&setup, proposal.clone(), 2_000, 2_500);
    register(&setup, &cell, proposal);
    pool.allocate_next();

    let preview = pool.preview_redeem(&(shares / 20));
    assert!(preview.can_redeem_now);
    let before = TokenClient::new(&setup.env, &setup.token).balance(&setup.shared);
    let assets = pool.unfund(&setup.shared, &(shares / 20), &pool.state_version());
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&setup.shared),
        before + assets
    );
    assert!(pool
        .try_unfund(&setup.shared, &(shares / 10), &pool.state_version(),)
        .is_err());
}

#[test]
fn terminal_profit_returns_to_pool_nav() {
    let setup = setup();
    let pool = setup.pool();
    deposit(&setup, DEPOSIT, 1);
    let proposal = id(&setup.env, 11);
    let cell = cell(&setup, proposal.clone(), 2_000, 2_500);
    register(&setup, &cell, proposal);
    pool.allocate_next();
    let market = Address::generate(&setup.env);
    cell.activate(&setup.factory, &market, &cell.state_version());

    StellarAssetClient::new(&setup.env, &setup.token).mint(&market, &5_000_000);
    TokenClient::new(&setup.env, &setup.token).transfer(&market, &cell.address, &25_000_000);
    cell.record_terminal(
        &market,
        &25_000_000,
        &TerminalOutcome::Yes,
        &0,
        &cell.state_version(),
    );
    assert_eq!(pool.harvest(&cell.address), 25_000_000);
    assert_eq!(pool.info().idle_assets, 105_000_000);
    assert_eq!(pool.info().deployed_principal, 0);
    assert_eq!(pool.nav().deposit_nav, 105_000_000);
    let allocation = pool.allocation(&cell.address).unwrap();
    assert_eq!(allocation.status, AllocationStatus::Harvested);
    assert_eq!(allocation.terminal_assets, 25_000_000);
}

#[test]
fn wrong_controller_fails_closed() {
    let setup = setup();
    let pool = setup.pool();
    assert!(pool
        .try_fund_received(
            &Address::generate(&setup.env),
            &id(&setup.env, 1),
            &1,
            &0,
            &0,
        )
        .is_err());
}

#[test]
#[should_panic]
fn invalid_policy_fails_closed() {
    let setup = setup();
    let bad = RiskPolicy {
        max_deployed_bps: 9_000,
        minimum_idle_bps: 2_000,
        ..policy()
    };
    setup.env.register(
        PooledLiquidityVault,
        (
            setup.token,
            setup.factory,
            setup.shared,
            Address::generate(&setup.env),
            bad,
        ),
    );
}
