#![cfg(test)]
extern crate std;

use crate::{
    LiquidityBinding, PrivateTransition, ProofAction, ProofStatement, ShieldedCollateralVault,
    ShieldedCollateralVaultClient,
};
use market_liquidity_vault::{MarketLiquidityVault, MarketLiquidityVaultClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec, U256,
};

const ENVELOPE_LENGTH: usize = 96;
const EXPIRY: u64 = 50_000;

#[contracttype]
#[derive(Clone)]
enum VerifierKey {
    Expected,
}

#[contract]
struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn set_expected(env: Env, digest: BytesN<32>) {
        env.storage()
            .instance()
            .set(&VerifierKey::Expected, &digest);
    }

    pub fn verify(env: Env, statement: ProofStatement, proof: Bytes) -> bool {
        let expected: Option<BytesN<32>> = env.storage().instance().get(&VerifierKey::Expected);
        expected == Some(statement.context_digest)
            && proof == Bytes::from_array(&env, &[7, 11, 13, 17])
    }
}

fn field(env: &Env, value: u32) -> U256 {
    U256::from_u32(env, value)
}

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn field_id(env: &Env, value: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[31] = value;
    BytesN::from_array(env, &bytes)
}

fn envelope(env: &Env, byte: u8) -> Bytes {
    Bytes::from_array(env, &[byte; ENVELOPE_LENGTH])
}

fn transition(
    env: &Env,
    membership_root: u32,
    append_root: u32,
    new_root: u32,
    nullifiers: &[u32],
    commitments: [u32; 2],
) -> PrivateTransition {
    let mut input_nullifiers = Vec::new(env);
    for value in nullifiers {
        input_nullifiers.push_back(field(env, *value));
    }
    PrivateTransition {
        proof: Bytes::from_array(env, &[7, 11, 13, 17]),
        membership_root: field(env, membership_root),
        append_root: field(env, append_root),
        new_root: field(env, new_root),
        input_nullifiers,
        output_commitments: Vec::from_array(
            env,
            [field(env, commitments[0]), field(env, commitments[1])],
        ),
        encrypted_outputs: Vec::from_array(env, [envelope(env, 41), envelope(env, 42)]),
    }
}

struct Setup {
    env: Env,
    vault: ShieldedCollateralVaultClient<'static>,
    verifier: MockVerifierClient<'static>,
    token: Address,
    governance: Address,
    user: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 10_000;
        ledger.sequence_number = 100;
    });
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let factory = Address::generate(&env);
    let governance = Address::generate(&env);
    let verifier_address = env.register(MockVerifier, ());
    let vault_address = env.register(
        ShieldedCollateralVault,
        (
            token.clone(),
            factory,
            governance.clone(),
            verifier_address.clone(),
            id(&env, 1),
            id(&env, 2),
            id(&env, 3),
            field(&env, 1),
            8u32,
            8u32,
            100u32,
            ENVELOPE_LENGTH as u32,
        ),
    );
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &1_000_000_000);
    let env_static: &'static Env = std::boxed::Box::leak(std::boxed::Box::new(env.clone()));
    let vault_address_static: &'static Address =
        std::boxed::Box::leak(std::boxed::Box::new(vault_address));
    let verifier_address_static: &'static Address =
        std::boxed::Box::leak(std::boxed::Box::new(verifier_address));
    Setup {
        env,
        vault: ShieldedCollateralVaultClient::new(env_static, vault_address_static),
        verifier: MockVerifierClient::new(env_static, verifier_address_static),
        token,
        governance,
        user,
    }
}

fn expect(
    setup: &Setup,
    action: ProofAction,
    action_id: &BytesN<32>,
    public_account: Option<Address>,
    public_amount: i128,
) {
    let digest = setup.vault.context_digest(
        &action,
        action_id,
        &public_account,
        &public_amount,
        &None,
        &BytesN::from_array(&setup.env, &[0; 32]),
        &EXPIRY,
    );
    setup.verifier.set_expected(&digest);
}

fn expect_liquidity(
    setup: &Setup,
    action: ProofAction,
    action_id: &BytesN<32>,
    liquidity_vault: &Address,
    public_amount: i128,
    binding: &LiquidityBinding,
) {
    let binding_digest: BytesN<32> = setup
        .env
        .crypto()
        .sha256(&binding.clone().to_xdr(&setup.env))
        .into();
    let digest = setup.vault.context_digest(
        &action,
        action_id,
        &None,
        &public_amount,
        &Some(liquidity_vault.clone()),
        &binding_digest,
        &EXPIRY,
    );
    setup.verifier.set_expected(&digest);
}

fn deposit(setup: &Setup, action_byte: u8, root: u32, commitments: [u32; 2], amount: i128) {
    let action_id = id(&setup.env, action_byte);
    expect(
        setup,
        ProofAction::Deposit,
        &action_id,
        Some(setup.user.clone()),
        amount,
    );
    let append = setup.vault.info().current_root.to_u128().unwrap() as u32;
    setup.vault.deposit(
        &setup.user,
        &amount,
        &action_id,
        &EXPIRY,
        &transition(&setup.env, append, append, root, &[], commitments),
    );
}

#[test]
fn deposit_moves_exact_usdc_and_persists_recovery_outputs() {
    let setup = setup();
    deposit(&setup, 10, 2, [11, 12], 500_000_000);

    let info = setup.vault.info();
    assert_eq!(info.shielded_liabilities, 500_000_000);
    assert_eq!(info.next_leaf_index, 2);
    assert_eq!(info.current_root, field(&setup.env, 2));
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&setup.vault.address),
        500_000_000
    );
    let first = setup.vault.output(&0).unwrap();
    assert_eq!(first.commitment, field(&setup.env, 11));
    assert_eq!(first.encrypted_output.len(), ENVELOPE_LENGTH as u32);
    assert_eq!(
        setup.vault.output(&1).unwrap().commitment,
        field(&setup.env, 12)
    );
}

#[test]
fn private_transfer_has_no_public_account_and_spends_each_nullifier_once() {
    let setup = setup();
    deposit(&setup, 10, 2, [11, 12], 500_000_000);
    let action_id = id(&setup.env, 20);
    expect(&setup, ProofAction::Transfer, &action_id, None, 0);
    setup.vault.private_transfer(
        &action_id,
        &EXPIRY,
        &transition(&setup.env, 2, 2, 3, &[21, 22], [31, 32]),
    );

    assert!(setup.vault.is_spent(&field(&setup.env, 21)));
    assert!(setup.vault.is_spent(&field(&setup.env, 22)));
    assert_eq!(setup.vault.info().shielded_liabilities, 500_000_000);

    let replay_id = id(&setup.env, 21);
    expect(&setup, ProofAction::Transfer, &replay_id, None, 0);
    assert!(setup
        .vault
        .try_private_transfer(
            &replay_id,
            &EXPIRY,
            &transition(&setup.env, 3, 3, 4, &[21, 23], [41, 42]),
        )
        .is_err());
}

#[test]
fn withdrawal_is_relayer_submittable_and_bound_to_recipient_and_amount() {
    let setup = setup();
    deposit(&setup, 10, 2, [11, 12], 500_000_000);
    let recipient = Address::generate(&setup.env);
    let action_id = id(&setup.env, 30);
    expect(
        &setup,
        ProofAction::Withdraw,
        &action_id,
        Some(recipient.clone()),
        -125_000_000,
    );
    setup.vault.withdraw(
        &recipient,
        &125_000_000,
        &action_id,
        &EXPIRY,
        &transition(&setup.env, 2, 2, 3, &[51, 52], [61, 62]),
    );

    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&recipient),
        125_000_000
    );
    assert_eq!(setup.vault.info().shielded_liabilities, 375_000_000);
}

#[test]
fn invalid_proof_and_failed_token_transfer_roll_back_all_state() {
    let setup = setup();
    let action_id = id(&setup.env, 40);
    expect(
        &setup,
        ProofAction::Deposit,
        &action_id,
        Some(setup.user.clone()),
        2_000_000_000,
    );
    assert!(setup
        .vault
        .try_deposit(
            &setup.user,
            &2_000_000_000,
            &action_id,
            &EXPIRY,
            &transition(&setup.env, 1, 1, 2, &[], [71, 72]),
        )
        .is_err());
    assert_eq!(setup.vault.info().next_leaf_index, 0);
    assert!(setup.vault.output(&0).is_none());

    let bad_action = id(&setup.env, 41);
    expect(
        &setup,
        ProofAction::Deposit,
        &bad_action,
        Some(setup.user.clone()),
        100_000_000,
    );
    let mut invalid = transition(&setup.env, 1, 1, 2, &[], [71, 72]);
    invalid.proof = Bytes::from_array(&setup.env, &[1]);
    assert!(setup
        .vault
        .try_deposit(&setup.user, &100_000_000, &bad_action, &EXPIRY, &invalid,)
        .is_err());
    assert_eq!(setup.vault.info().next_leaf_index, 0);
}

#[test]
fn rejects_duplicate_actions_nullifiers_commitments_and_roots() {
    let setup = setup();
    deposit(&setup, 10, 2, [11, 12], 500_000_000);

    let duplicate_action = id(&setup.env, 10);
    expect(&setup, ProofAction::Transfer, &duplicate_action, None, 0);
    assert!(setup
        .vault
        .try_private_transfer(
            &duplicate_action,
            &EXPIRY,
            &transition(&setup.env, 2, 2, 3, &[21, 22], [31, 32]),
        )
        .is_err());

    let duplicate_nullifier = id(&setup.env, 20);
    expect(&setup, ProofAction::Transfer, &duplicate_nullifier, None, 0);
    assert!(setup
        .vault
        .try_private_transfer(
            &duplicate_nullifier,
            &EXPIRY,
            &transition(&setup.env, 2, 2, 3, &[21, 21], [31, 32]),
        )
        .is_err());

    let duplicate_commitment = id(&setup.env, 21);
    expect(
        &setup,
        ProofAction::Transfer,
        &duplicate_commitment,
        None,
        0,
    );
    assert!(setup
        .vault
        .try_private_transfer(
            &duplicate_commitment,
            &EXPIRY,
            &transition(&setup.env, 2, 2, 3, &[21, 22], [11, 32]),
        )
        .is_err());

    let duplicate_root = id(&setup.env, 22);
    expect(&setup, ProofAction::Transfer, &duplicate_root, None, 0);
    assert!(setup
        .vault
        .try_private_transfer(
            &duplicate_root,
            &EXPIRY,
            &transition(&setup.env, 2, 2, 2, &[21, 22], [31, 32]),
        )
        .is_err());
}

#[test]
fn historical_roots_expire_but_current_root_remains_usable() {
    let setup = setup();
    deposit(&setup, 10, 2, [11, 12], 500_000_000);
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.sequence_number = 201);

    let stale_id = id(&setup.env, 50);
    expect(&setup, ProofAction::Transfer, &stale_id, None, 0);
    assert!(setup
        .vault
        .try_private_transfer(
            &stale_id,
            &EXPIRY,
            &transition(&setup.env, 1, 2, 3, &[21, 22], [31, 32]),
        )
        .is_err());

    let current_id = id(&setup.env, 51);
    expect(&setup, ProofAction::Transfer, &current_id, None, 0);
    setup.vault.private_transfer(
        &current_id,
        &EXPIRY,
        &transition(&setup.env, 2, 2, 3, &[21, 22], [31, 32]),
    );
}

#[test]
fn pause_blocks_new_deposits_without_blocking_private_exits() {
    let setup = setup();
    deposit(&setup, 10, 2, [11, 12], 500_000_000);
    setup.vault.set_deposits_paused(&setup.governance, &true);

    let blocked_id = id(&setup.env, 60);
    expect(
        &setup,
        ProofAction::Deposit,
        &blocked_id,
        Some(setup.user.clone()),
        100_000_000,
    );
    assert!(setup
        .vault
        .try_deposit(
            &setup.user,
            &100_000_000,
            &blocked_id,
            &EXPIRY,
            &transition(&setup.env, 2, 2, 3, &[], [31, 32]),
        )
        .is_err());

    let recipient = Address::generate(&setup.env);
    let withdraw_id = id(&setup.env, 61);
    expect(
        &setup,
        ProofAction::Withdraw,
        &withdraw_id,
        Some(recipient.clone()),
        -100_000_000,
    );
    setup.vault.withdraw(
        &recipient,
        &100_000_000,
        &withdraw_id,
        &EXPIRY,
        &transition(&setup.env, 2, 2, 3, &[21, 22], [31, 32]),
    );
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&recipient),
        100_000_000
    );
}

#[test]
fn direct_donations_are_never_counted_as_shielded_liabilities() {
    let setup = setup();
    let donor = Address::generate(&setup.env);
    StellarAssetClient::new(&setup.env, &setup.token).mint(&donor, &25_000_000);
    TokenClient::new(&setup.env, &setup.token).transfer(&donor, &setup.vault.address, &25_000_000);
    assert_eq!(setup.vault.unallocated_balance(), 25_000_000);
    assert_eq!(setup.vault.info().shielded_liabilities, 0);
}

#[test]
fn private_lp_funding_and_unfunding_keep_ownership_in_shielded_notes() {
    let setup = setup();
    deposit(&setup, 10, 2, [11, 12], 500_000_000);
    setup.env.set_auths(&[]);
    let liquidity_vault_address = setup.env.register(
        MarketLiquidityVault,
        (
            setup.token.clone(),
            Address::generate(&setup.env),
            setup.vault.address.clone(),
            id(&setup.env, 90),
            400_000_000i128,
            20_000u64,
            30_000u64,
            7u32,
        ),
    );
    let liquidity_vault = MarketLiquidityVaultClient::new(&setup.env, &liquidity_vault_address);

    let share_commitment = field_id(&setup.env, 90);
    let fund_id = id(&setup.env, 70);
    let fund_binding = LiquidityBinding {
        liquidity_vault: liquidity_vault_address.clone(),
        share_commitment: share_commitment.clone(),
        shares: 200_000_000,
        expected_assets: 200_000_000,
        expected_version: 0,
    };
    expect_liquidity(
        &setup,
        ProofAction::LiquidityFund,
        &fund_id,
        &liquidity_vault_address,
        -200_000_000,
        &fund_binding,
    );
    let funded = setup.vault.fund_liquidity(
        &liquidity_vault_address,
        &200_000_000,
        &200_000_000,
        &share_commitment,
        &0,
        &fund_id,
        &EXPIRY,
        &transition(&setup.env, 2, 2, 3, &[21, 22], [31, 90]),
    );
    assert_eq!(funded.shares_minted, 200_000_000);
    assert_eq!(liquidity_vault.info().funded_assets, 200_000_000);
    assert_eq!(setup.vault.info().shielded_liabilities, 300_000_000);
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&liquidity_vault_address),
        200_000_000
    );

    let remaining_commitment = field_id(&setup.env, 91);
    let unfund_id = id(&setup.env, 71);
    let unfund_binding = LiquidityBinding {
        liquidity_vault: liquidity_vault_address.clone(),
        share_commitment: remaining_commitment.clone(),
        shares: 50_000_000,
        expected_assets: 50_000_000,
        expected_version: 1,
    };
    expect_liquidity(
        &setup,
        ProofAction::LiquidityExit,
        &unfund_id,
        &liquidity_vault_address,
        50_000_000,
        &unfund_binding,
    );
    let received = setup.vault.unfund_liquidity(
        &liquidity_vault_address,
        &50_000_000,
        &50_000_000,
        &remaining_commitment,
        &1,
        &unfund_id,
        &EXPIRY,
        &transition(&setup.env, 3, 3, 4, &[41, 42], [51, 91]),
    );
    assert_eq!(received, 50_000_000);
    assert_eq!(liquidity_vault.info().funded_assets, 150_000_000);
    assert_eq!(liquidity_vault.info().total_shares, 150_000_000);
    assert_eq!(setup.vault.info().shielded_liabilities, 350_000_000);
}
