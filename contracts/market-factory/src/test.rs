extern crate std;

use crate::{
    AssetRiskGroup, FactoryConfig, MarketFactory, MarketFactoryClient, ProposalPhase,
    ProposalRequest,
};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{symbol_short, Address, BytesN, Env, Symbol, Vec, U256};

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn babyjub_base(env: &Env) -> (U256, U256) {
    (
        U256::from_be_bytes(
            env,
            &soroban_sdk::Bytes::from_array(
                env,
                &[
                    0x0b, 0xb7, 0x7a, 0x6a, 0xd6, 0x3e, 0x73, 0x9b, 0x4e, 0xac, 0xb2, 0xe0, 0x9d,
                    0x62, 0x77, 0xc1, 0x2a, 0xb8, 0xd8, 0x01, 0x05, 0x34, 0xe0, 0xb6, 0x28, 0x93,
                    0xf3, 0xf6, 0xbb, 0x95, 0x70, 0x51,
                ],
            ),
        ),
        U256::from_be_bytes(
            env,
            &soroban_sdk::Bytes::from_array(
                env,
                &[
                    0x25, 0x79, 0x72, 0x03, 0xf7, 0xa0, 0xb2, 0x49, 0x25, 0x57, 0x2e, 0x1c, 0xd1,
                    0x6b, 0xf9, 0xed, 0xfc, 0xe0, 0x05, 0x1f, 0xb9, 0xe1, 0x33, 0x77, 0x4b, 0x3c,
                    0x25, 0x7a, 0x87, 0x2d, 0x7d, 0x8b,
                ],
            ),
        ),
    )
}

fn symbols(env: &Env) -> Vec<Symbol> {
    Vec::from_array(env, [symbol_short!("BTC"), symbol_short!("XLM")])
}

fn tiers(env: &Env) -> Vec<i128> {
    Vec::from_array(env, [100_000_000, 500_000_000])
}

fn risk_groups(env: &Env) -> Vec<AssetRiskGroup> {
    Vec::from_array(
        env,
        [
            AssetRiskGroup {
                asset: symbol_short!("BTC"),
                risk_group: symbol_short!("CRYPTO"),
            },
            AssetRiskGroup {
                asset: symbol_short!("XLM"),
                risk_group: symbol_short!("CRYPTO"),
            },
        ],
    )
}

fn config(env: &Env, collateral: Address) -> FactoryConfig {
    let (committee_public_key_x, committee_public_key_y) = babyjub_base(env);
    FactoryConfig {
        governance: Address::generate(env),
        collateral,
        shared_vault: Address::generate(env),
        liquidity_pool: Address::generate(env),
        resolver: Address::generate(env),
        network_domain: id(env, 1),
        market_wasm_hash: id(env, 2),
        liquidity_wasm_hash: id(env, 3),
        allowed_assets: symbols(env),
        asset_risk_groups: risk_groups(env),
        liquidity_tiers: tiers(env),
        minimum_funding_window: 300,
        minimum_open_window: 600,
        maximum_market_duration: 1_000_000,
        batch_grace: 300,
        epoch_duration: 60,
        refund_delay: 120,
        committee_epoch: 1,
        committee_config_hash: id(env, 4),
        committee_public_key_x,
        committee_public_key_y,
        maximum_fee_bps: 500,
        lp_fee_share_bps: 5_000,
        maximum_batch_size: 8,
        minimum_side_count: 0,
        maximum_price_movement: 1i128 << 30,
    }
}

fn request(env: &Env, creator: Address) -> ProposalRequest {
    ProposalRequest {
        creator,
        nonce: id(env, 10),
        asset: symbol_short!("BTC"),
        threshold: 100_000_000,
        rules_hash: id(env, 11),
        metadata_hash: id(env, 12),
        funding_deadline: 2_000,
        activation_cutoff: 2_500,
        expiry: 5_000,
        liquidity_target: 100_000_000,
        lot_size: 1i128 << 32,
        fee_bps: 200,
    }
}

fn setup() -> (Env, MarketFactoryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let token_admin = Address::generate(&env);
    let collateral = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let address = env.register(MarketFactory, (config(&env, collateral),));
    let env_static: &'static Env = std::boxed::Box::leak(std::boxed::Box::new(env.clone()));
    let address_static: &'static Address = std::boxed::Box::leak(std::boxed::Box::new(address));
    (
        env,
        MarketFactoryClient::new(env_static, address_static),
        Address::generate(env_static),
    )
}

#[test]
fn creator_proposes_without_usdc_or_a_collateral_transfer() {
    let (env, client, creator) = setup();
    let proposal_id = client.propose(&request(&env, creator.clone()));
    let proposal = client.proposal(&proposal_id).unwrap();
    assert_eq!(proposal.creator, creator);
    assert_eq!(proposal.risk_group, symbol_short!("CRYPTO"));
    assert_eq!(proposal.phase, ProposalPhase::Proposed);
    assert_eq!(proposal.liquidity_vault, None);
    assert_eq!(proposal.liquidity_sequence, None);
    assert_eq!(proposal.state_version, 0);
}

#[test]
fn extend_ttl_preserves_factory_configuration() {
    let (_, client, _) = setup();
    let before = client.config();
    client.extend_ttl();
    assert_eq!(client.config(), before);
}

#[test]
fn proposal_identifier_binds_creator_nonce_and_configuration() {
    let (env, client, creator) = setup();
    let first = request(&env, creator.clone());
    let first_id = client.proposal_id(&first);
    assert_eq!(client.propose(&first), first_id);
    assert!(client.try_propose(&first).is_err());

    let mut second = request(&env, creator);
    second.nonce = id(&env, 13);
    assert_ne!(client.proposal_id(&second), first_id);
}

#[test]
fn unsupported_assets_liquidity_fees_and_timing_fail_before_funding() {
    let (env, client, creator) = setup();

    let mut unsupported_asset = request(&env, creator.clone());
    unsupported_asset.asset = symbol_short!("ETH");
    assert!(client.try_propose(&unsupported_asset).is_err());

    let mut unsupported_liquidity = request(&env, creator.clone());
    unsupported_liquidity.liquidity_target = 200_000_000;
    assert!(client.try_propose(&unsupported_liquidity).is_err());

    let mut excessive_fee = request(&env, creator.clone());
    excessive_fee.fee_bps = 501;
    assert!(client.try_propose(&excessive_fee).is_err());

    let mut short_window = request(&env, creator);
    short_window.expiry = short_window.activation_cutoff + 599;
    assert!(client.try_propose(&short_window).is_err());
}

#[test]
fn undeployed_expired_proposal_cancels_permissionlessly() {
    let (env, client, creator) = setup();
    let proposal_id = client.propose(&request(&env, creator));
    env.ledger().with_mut(|ledger| ledger.timestamp = 2_001);
    client.cancel(&proposal_id, &0, &0);
    assert_eq!(
        client.proposal(&proposal_id).unwrap().phase,
        ProposalPhase::Cancelled
    );
}

#[test]
fn liquidity_address_is_deterministic_before_deployment() {
    let (env, client, creator) = setup();
    let proposal_id = client.propose(&request(&env, creator));
    assert_eq!(
        client.liquidity_address(&proposal_id),
        client.liquidity_address(&proposal_id)
    );
    assert_eq!(
        client.market_address(&proposal_id),
        client.market_address(&proposal_id)
    );
    assert_ne!(
        client.liquidity_address(&proposal_id),
        client.market_address(&proposal_id)
    );
}

#[test]
fn liquidity_parameter_is_the_largest_supported_value_covered_by_the_target() {
    let (_env, client, _creator) = setup();
    let first_target = 100_000_000;
    let second_target = 500_000_000;
    let first = client.liquidity_parameter(&first_target);
    let second = client.liquidity_parameter(&second_target);

    assert!(first > 0);
    assert!(second > first);
    assert!(required_funding(first) <= first_target);
    assert!(required_funding(first + 1) > first_target);
    assert!(required_funding(second) <= second_target);
    assert!(required_funding(second + 1) > second_target);
}

#[test]
#[should_panic]
fn constructor_rejects_duplicate_capabilities() {
    let env = Env::default();
    let token_admin = Address::generate(&env);
    let collateral = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let mut bad = config(&env, collateral);
    bad.allowed_assets = Vec::from_array(&env, [symbol_short!("BTC"), symbol_short!("BTC")]);
    env.register(MarketFactory, (bad,));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_missing_asset_risk_groups() {
    let env = Env::default();
    let token_admin = Address::generate(&env);
    let collateral = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let mut bad = config(&env, collateral);
    bad.asset_risk_groups = Vec::from_array(
        &env,
        [AssetRiskGroup {
            asset: symbol_short!("BTC"),
            risk_group: symbol_short!("CRYPTO"),
        }],
    );
    env.register(MarketFactory, (bad,));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_duplicate_asset_risk_groups() {
    let env = Env::default();
    let token_admin = Address::generate(&env);
    let collateral = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let mut bad = config(&env, collateral);
    bad.asset_risk_groups = Vec::from_array(
        &env,
        [
            AssetRiskGroup {
                asset: symbol_short!("BTC"),
                risk_group: symbol_short!("CRYPTO"),
            },
            AssetRiskGroup {
                asset: symbol_short!("BTC"),
                risk_group: symbol_short!("CRYPTO"),
            },
        ],
    );
    env.register(MarketFactory, (bad,));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_an_invalid_committee_encryption_key() {
    let env = Env::default();
    let token_admin = Address::generate(&env);
    let collateral = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let mut invalid = config(&env, collateral);
    invalid.committee_public_key_x = U256::from_u32(&env, 5);
    invalid.committee_public_key_y = U256::from_u32(&env, 6);
    env.register(MarketFactory, (invalid,));
}

#[test]
#[should_panic]
fn constructor_rejects_a_batch_size_without_a_proving_key() {
    let env = Env::default();
    let token_admin = Address::generate(&env);
    let collateral = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let mut bad = config(&env, collateral);
    bad.maximum_batch_size = 9;
    env.register(MarketFactory, (bad,));
}

fn required_funding(liquidity_parameter: i128) -> i128 {
    const SCALE: i128 = 1i128 << 32;
    const LN2: i128 = 2_977_044_472;
    let fixed_loss = liquidity_parameter * LN2 / SCALE;
    (fixed_loss * 10_000_000 + SCALE - 1) / SCALE
}
