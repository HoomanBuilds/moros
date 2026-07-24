#![cfg(test)]
extern crate std;

use crate::{
    AllocationBinding, BatchProofStatement, BatchQuote, BatchSubmission, EncryptedOrder,
    EpochPhase, ExitCancelBinding, ExitMatchBinding, ExitRequestBinding, LiquidityBinding,
    OrderStatus, PaymentDestination, PrivateTransition, ProofAction, ProofStatement,
    SettlementState, ShieldedCollateralVault, ShieldedCollateralVaultClient,
};
use lmsr_market::{
    BatchQuote as LmsrBatchQuote, LmsrMarket, LmsrMarketClient, Outcome, PrivateMarketConfig,
};
use market_liquidity_vault::{MarketLiquidityVault, MarketLiquidityVaultClient};
use privacy_types::{OUTPUT_ENVELOPE_FIELDS, OUTPUT_ENVELOPE_LENGTH, OUTPUT_ENVELOPE_VERSION};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, xdr::ToXdr, Address, Bytes, BytesN, Env,
    Vec, U256,
};

const EXPIRY: u64 = 50_000;
const S: i128 = 1i128 << 32;

#[contracttype]
#[derive(Clone)]
enum VerifierKey {
    Expected,
    ExpectedBatch,
}

#[contract]
struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn domain(env: Env) -> BytesN<32> {
        id(&env, 2)
    }

    pub fn set_expected(env: Env, digest: U256) {
        env.storage()
            .instance()
            .set(&VerifierKey::Expected, &digest);
    }

    pub fn verify(env: Env, statement: ProofStatement, proof: Bytes) -> bool {
        let expected: Option<U256> = env.storage().instance().get(&VerifierKey::Expected);
        expected == Some(statement.context_digest)
            && proof == Bytes::from_array(&env, &[7, 11, 13, 17])
    }

    pub fn set_expected_batch(env: Env, digest: BytesN<32>) {
        env.storage()
            .instance()
            .set(&VerifierKey::ExpectedBatch, &digest);
    }

    pub fn verify_batch(env: Env, statement: BatchProofStatement, proof: Bytes) -> bool {
        let expected: Option<BytesN<32>> =
            env.storage().instance().get(&VerifierKey::ExpectedBatch);
        let digest: BytesN<32> = env.crypto().sha256(&statement.to_xdr(&env)).into();
        expected == Some(digest) && proof == Bytes::from_array(&env, &[19, 23, 29, 31])
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

fn babyjub_base(env: &Env) -> (U256, U256) {
    (
        U256::from_be_bytes(
            env,
            &Bytes::from_array(
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
            &Bytes::from_array(
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

fn payment_destination(env: &Env, commitment: u8) -> PaymentDestination {
    let (viewing_public_key_x, viewing_public_key_y) = babyjub_base(env);
    PaymentDestination {
        commitment: field_id(env, commitment),
        spend_public_key: field(env, 120),
        viewing_public_key_x,
        viewing_public_key_y,
        note_id: field(env, 121),
        blinding: field(env, 122),
    }
}

fn envelope(env: &Env, byte: u8) -> Bytes {
    let mut envelope = Bytes::new(env);
    for index in 0..OUTPUT_ENVELOPE_FIELDS {
        let mut field = [0u8; 32];
        field[31] = if index == 0 {
            OUTPUT_ENVELOPE_VERSION as u8
        } else {
            byte.wrapping_add(index as u8)
        };
        envelope.append(&Bytes::from_array(env, &field));
    }
    envelope
}

fn order_ciphertext(env: &Env, _byte: u8) -> EncryptedOrder {
    let (x, y) = babyjub_base(env);
    EncryptedOrder {
        yes_c1_x: x.clone(),
        yes_c1_y: y.clone(),
        yes_c2_x: x.clone(),
        yes_c2_y: y.clone(),
        no_c1_x: x.clone(),
        no_c1_y: y.clone(),
        no_c2_x: x,
        no_c2_y: y,
    }
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

fn transition_four(
    env: &Env,
    membership_root: u32,
    append_root: u32,
    new_root: u32,
    nullifiers: &[u32],
    commitments: [u32; 4],
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
            [
                field(env, commitments[0]),
                field(env, commitments[1]),
                field(env, commitments[2]),
                field(env, commitments[3]),
            ],
        ),
        encrypted_outputs: Vec::from_array(
            env,
            [
                envelope(env, 51),
                envelope(env, 52),
                envelope(env, 53),
                envelope(env, 54),
            ],
        ),
    }
}

struct Setup {
    env: Env,
    vault: ShieldedCollateralVaultClient<'static>,
    verifier: MockVerifierClient<'static>,
    token: Address,
    factory: Address,
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
            factory.clone(),
            governance.clone(),
            verifier_address.clone(),
            id(&env, 1),
            id(&env, 2),
            id(&env, 3),
            field(&env, 1),
            8u32,
            8u32,
            100u32,
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
        factory,
        governance,
        user,
    }
}

#[test]
fn extend_ttl_preserves_vault_state() {
    let setup = setup();
    let before = setup.vault.info();
    setup.vault.extend_ttl();
    assert_eq!(setup.vault.info(), before);
}

#[test]
#[should_panic]
fn constructor_rejects_wrong_verifier_domain() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let verifier = env.register(MockVerifier, ());
    env.register(
        ShieldedCollateralVault,
        (
            token,
            Address::generate(&env),
            Address::generate(&env),
            verifier,
            id(&env, 1),
            id(&env, 4),
            id(&env, 3),
            field(&env, 1),
            8u32,
            8u32,
            100u32,
        ),
    );
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
        &ShieldedCollateralVault::empty_binding(&setup.env),
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
    let operation_binding =
        ShieldedCollateralVault::liquidity_operation_binding(&setup.env, binding);
    let digest = setup.vault.context_digest(
        &action,
        action_id,
        &None,
        &public_amount,
        &Some(liquidity_vault.clone()),
        &operation_binding,
        &EXPIRY,
    );
    setup.verifier.set_expected(&digest);
}

fn expect_exit_request(
    setup: &Setup,
    market: &Address,
    action_id: &BytesN<32>,
    binding: &ExitRequestBinding,
) {
    let operation_binding =
        ShieldedCollateralVault::exit_request_operation_binding(&setup.env, binding);
    let digest = setup.vault.context_digest(
        &ProofAction::ExitRequest,
        action_id,
        &None,
        &0,
        &Some(market.clone()),
        &operation_binding,
        &EXPIRY,
    );
    setup.verifier.set_expected(&digest);
}

fn expect_exit_cancel(
    setup: &Setup,
    market: &Address,
    action_id: &BytesN<32>,
    binding: &ExitCancelBinding,
) {
    let operation_binding =
        ShieldedCollateralVault::exit_cancel_operation_binding(&setup.env, binding);
    let digest = setup.vault.context_digest(
        &ProofAction::ExitCancel,
        action_id,
        &None,
        &0,
        &Some(market.clone()),
        &operation_binding,
        &EXPIRY,
    );
    setup.verifier.set_expected(&digest);
}

fn expect_exit_match(
    setup: &Setup,
    market: &Address,
    action_id: &BytesN<32>,
    binding: &ExitMatchBinding,
) {
    let operation_binding =
        ShieldedCollateralVault::exit_match_operation_binding(&setup.env, binding);
    let digest = setup.vault.context_digest(
        &ProofAction::ExitMatch,
        action_id,
        &None,
        &0,
        &Some(market.clone()),
        &operation_binding,
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
    assert_eq!(first.encrypted_output.len(), OUTPUT_ENVELOPE_LENGTH);
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
        &transition(&setup.env, 2, 2, 3, &[51], [61, 62]),
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
        &transition(&setup.env, 2, 2, 3, &[21], [31, 32]),
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
        &transition(&setup.env, 2, 2, 3, &[21], [31, 90]),
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
        &transition(&setup.env, 3, 3, 4, &[41], [51, 91]),
    );
    assert_eq!(received, 50_000_000);
    assert_eq!(liquidity_vault.info().funded_assets, 150_000_000);
    assert_eq!(liquidity_vault.info().total_shares, 150_000_000);
    assert_eq!(setup.vault.info().shielded_liabilities, 350_000_000);
}

fn setup_private_market(setup: &Setup) -> (Address, Address, Address) {
    let resolver = Address::generate(&setup.env);
    let market_address = setup.env.register(
        LmsrMarket,
        (
            setup.factory.clone(),
            setup.token.clone(),
            20i128 * S,
            symbol_short!("XLM"),
            2_500_000_000_000i128,
            11_000u64,
            300u64,
        ),
    );
    let liquidity_address = setup.env.register(
        MarketLiquidityVault,
        (
            setup.token.clone(),
            setup.factory.clone(),
            setup.vault.address.clone(),
            id(&setup.env, 90),
            200_000_000i128,
            10_500u64,
            10_700u64,
            7u32,
        ),
    );
    let liquidity = MarketLiquidityVaultClient::new(&setup.env, &liquidity_address);
    StellarAssetClient::new(&setup.env, &setup.token).mint(&setup.vault.address, &200_000_000);
    liquidity.fund(&setup.vault.address, &id(&setup.env, 91), &200_000_000, &0);
    liquidity.activate(&setup.factory, &market_address, &1);
    LmsrMarketClient::new(&setup.env, &market_address).activate_private(
        &setup.factory,
        &PrivateMarketConfig {
            batcher: setup.vault.address.clone(),
            liquidity_vault: liquidity_address.clone(),
            resolver: resolver.clone(),
            rules_hash: id(&setup.env, 92),
            funding: 200_000_000,
            fee_bps: 400,
            lp_fee_share_bps: 5_000,
            lot_size: S,
            maximum_batch_size: 8,
            minimum_side_count: 0,
            maximum_price_movement: S / 4,
        },
    );
    let (committee_public_key_x, committee_public_key_y) = babyjub_base(&setup.env);
    setup.vault.register_market(
        &setup.factory,
        &market_address,
        &60,
        &120,
        &1,
        &id(&setup.env, 93),
        &committee_public_key_x,
        &committee_public_key_y,
    );
    let reserve_funder = Address::generate(&setup.env);
    StellarAssetClient::new(&setup.env, &setup.token).mint(&reserve_funder, &10_000_000);
    setup
        .vault
        .fund_rounding_reserve(&reserve_funder, &10_000_000);
    (market_address, liquidity_address, resolver)
}

#[test]
fn active_lp_exit_replacement_is_private_state_bound_and_keeps_market_backing() {
    let setup = setup();
    let (market, liquidity_address, _resolver) = setup_private_market(&setup);
    let liquidity = MarketLiquidityVaultClient::new(&setup.env, &liquidity_address);
    let market_balance = TokenClient::new(&setup.env, &setup.token).balance(&market);
    let snapshot = liquidity.market_snapshot().unwrap();
    assert_eq!(snapshot.state_version, 0);
    assert_eq!(liquidity.info().state_version, 3);

    let request_id = id(&setup.env, 100);
    let exit_id = id(&setup.env, 101);
    let destination = field_id(&setup.env, 102);
    let payment_destination = payment_destination(&setup.env, 103);
    let request_binding = ExitRequestBinding {
        liquidity_vault: liquidity_address.clone(),
        exit_id: exit_id.clone(),
        shares: 40_000_000,
        minimum_payment: 32_000_000,
        destination: destination.clone(),
        payment_destination: payment_destination.clone(),
        exit_expiry: 10_800,
        expected_version: 3,
    };
    expect_exit_request(&setup, &market, &request_id, &request_binding);
    setup.vault.request_liquidity_exit(
        &market,
        &liquidity_address,
        &exit_id,
        &40_000_000,
        &32_000_000,
        &destination,
        &payment_destination,
        &10_800,
        &3,
        &request_id,
        &EXPIRY,
        &transition(&setup.env, 1, 1, 2, &[21], [101, 102]),
    );
    assert_eq!(liquidity.info().locked_shares, 40_000_000);
    assert_eq!(
        liquidity.exit_intent(&exit_id).unwrap().destination,
        destination
    );

    let match_id = id(&setup.env, 103);
    let match_binding = ExitMatchBinding {
        liquidity_vault: liquidity_address.clone(),
        exit_id: exit_id.clone(),
        shares: 40_000_000,
        payment: 32_000_000,
        payment_destination,
        market_state_version: snapshot.state_version,
        equity_if_yes: snapshot.equity_if_yes,
        equity_if_no: snapshot.equity_if_no,
        conditional_lp_fees: snapshot.conditional_lp_fees,
        state_updated_at: snapshot.updated_at,
        maximum_state_age: 300,
        expected_version: 4,
        market_expiry: 11_000,
    };
    expect_exit_match(&setup, &market, &match_id, &match_binding);
    let fill = setup.vault.match_liquidity_exit(
        &market,
        &liquidity_address,
        &exit_id,
        &40_000_000,
        &32_000_000,
        &snapshot.state_version,
        &snapshot.equity_if_yes,
        &snapshot.equity_if_no,
        &snapshot.conditional_lp_fees,
        &snapshot.updated_at,
        &300,
        &4,
        &match_id,
        &EXPIRY,
        &transition_four(&setup.env, 2, 2, 3, &[31, 32], [103, 104, 105, 106]),
    );
    assert_eq!(fill.shares_transferred, 40_000_000);
    assert_eq!(fill.shares_remaining, 0);
    assert_eq!(setup.vault.info().next_leaf_index, 6);
    assert_eq!(liquidity.info().locked_shares, 0);
    assert_eq!(
        liquidity.exit_intent(&exit_id).unwrap().status,
        market_liquidity_vault::ExitStatus::Matched
    );
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&market),
        market_balance
    );
}

#[test]
fn active_lp_exit_can_be_cancelled_with_its_private_receipt() {
    let setup = setup();
    let (market, liquidity_address, _resolver) = setup_private_market(&setup);
    let liquidity = MarketLiquidityVaultClient::new(&setup.env, &liquidity_address);
    let market_balance = TokenClient::new(&setup.env, &setup.token).balance(&market);

    let request_id = id(&setup.env, 120);
    let exit_id = id(&setup.env, 121);
    let destination = field_id(&setup.env, 122);
    let payment_destination = payment_destination(&setup.env, 123);
    let request_binding = ExitRequestBinding {
        liquidity_vault: liquidity_address.clone(),
        exit_id: exit_id.clone(),
        shares: 40_000_000,
        minimum_payment: 32_000_000,
        destination: destination.clone(),
        payment_destination: payment_destination.clone(),
        exit_expiry: 10_800,
        expected_version: 3,
    };
    expect_exit_request(&setup, &market, &request_id, &request_binding);
    setup.vault.request_liquidity_exit(
        &market,
        &liquidity_address,
        &exit_id,
        &40_000_000,
        &32_000_000,
        &destination,
        &payment_destination,
        &10_800,
        &3,
        &request_id,
        &EXPIRY,
        &transition(&setup.env, 1, 1, 2, &[21], [121, 122]),
    );

    let cancel_id = id(&setup.env, 124);
    let cancel_binding = ExitCancelBinding {
        liquidity_vault: liquidity_address.clone(),
        exit_id: exit_id.clone(),
        shares_remaining: 40_000_000,
        minimum_payment_remaining: 32_000_000,
        destination,
        exit_expiry: 10_800,
        expected_version: 4,
    };
    expect_exit_cancel(&setup, &market, &cancel_id, &cancel_binding);
    setup.vault.cancel_liquidity_exit(
        &market,
        &liquidity_address,
        &exit_id,
        &4,
        &cancel_id,
        &EXPIRY,
        &transition(&setup.env, 2, 2, 3, &[31], [124, 125]),
    );

    assert_eq!(liquidity.info().locked_shares, 0);
    assert_eq!(
        liquidity.exit_intent(&exit_id).unwrap().status,
        market_liquidity_vault::ExitStatus::Cancelled
    );
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&market),
        market_balance
    );
}

#[test]
fn active_lp_exit_replacement_rejects_a_stale_market_snapshot() {
    let setup = setup();
    let (market, liquidity_address, _resolver) = setup_private_market(&setup);
    let liquidity = MarketLiquidityVaultClient::new(&setup.env, &liquidity_address);
    let stale_snapshot = liquidity.market_snapshot().unwrap();

    let request_id = id(&setup.env, 110);
    let exit_id = id(&setup.env, 111);
    let destination = field_id(&setup.env, 112);
    let payment_destination = payment_destination(&setup.env, 113);
    let request_binding = ExitRequestBinding {
        liquidity_vault: liquidity_address.clone(),
        exit_id: exit_id.clone(),
        shares: 40_000_000,
        minimum_payment: 32_000_000,
        destination: destination.clone(),
        payment_destination: payment_destination.clone(),
        exit_expiry: 10_800,
        expected_version: 3,
    };
    expect_exit_request(&setup, &market, &request_id, &request_binding);
    setup.vault.request_liquidity_exit(
        &market,
        &liquidity_address,
        &exit_id,
        &40_000_000,
        &32_000_000,
        &destination,
        &payment_destination,
        &10_800,
        &3,
        &request_id,
        &EXPIRY,
        &transition(&setup.env, 1, 1, 2, &[21], [111, 112]),
    );

    StellarAssetClient::new(&setup.env, &setup.token).mint(&setup.vault.address, &50_000_000);
    LmsrMarketClient::new(&setup.env, &market).apply_private_batch(
        &setup.vault.address,
        &0,
        &4,
        &4,
    );
    let current_snapshot = liquidity.market_snapshot().unwrap();
    assert_eq!(current_snapshot.state_version, 1);
    assert_ne!(current_snapshot, stale_snapshot);

    let next_leaf_index = setup.vault.info().next_leaf_index;
    assert!(setup
        .vault
        .try_match_liquidity_exit(
            &market,
            &liquidity_address,
            &exit_id,
            &40_000_000,
            &32_000_000,
            &stale_snapshot.state_version,
            &stale_snapshot.equity_if_yes,
            &stale_snapshot.equity_if_no,
            &stale_snapshot.conditional_lp_fees,
            &stale_snapshot.updated_at,
            &300,
            &5,
            &id(&setup.env, 113),
            &EXPIRY,
            &transition_four(&setup.env, 2, 2, 3, &[31, 32], [113, 114, 115, 116],),
        )
        .is_err());
    assert_eq!(setup.vault.info().next_leaf_index, next_leaf_index);
    assert_eq!(liquidity.info().locked_shares, 40_000_000);
}

fn accept_test_order(
    setup: &Setup,
    market: &Address,
    action_byte: u8,
    root: u32,
    nullifier: u32,
    commitments: [u32; 2],
) {
    let registration = setup.vault.registration(market).unwrap();
    let epoch = setup
        .vault
        .epoch(market, &registration.current_epoch)
        .unwrap();
    let encrypted_order = order_ciphertext(&setup.env, action_byte);
    let position_commitment = field(&setup.env, commitments[1]);
    let action_id = id(&setup.env, action_byte);
    let binding = setup.vault.order_binding(
        market,
        &epoch.epoch,
        &action_id,
        &position_commitment,
        &encrypted_order,
    );
    assert_eq!(binding.old_accepted_root, epoch.accepted_root);
    assert_eq!(binding.accepted_leaf_index, epoch.accepted_count);
    let operation_binding = ShieldedCollateralVault::order_operation_binding(&setup.env, &binding);
    let digest = setup.vault.context_digest(
        &ProofAction::Order,
        &action_id,
        &None,
        &0,
        &Some(market.clone()),
        &operation_binding,
        &binding.refund_at,
    );
    setup.verifier.set_expected(&digest);
    let append = setup.vault.info().current_root.to_u128().unwrap() as u32;
    setup.vault.accept_order(
        market,
        &epoch.epoch,
        &action_id,
        &position_commitment,
        &encrypted_order,
        &transition(&setup.env, append, append, root, &[nullifier], commitments),
    );
    let updated = setup.vault.epoch(market, &epoch.epoch).unwrap();
    assert_eq!(updated.accepted_root, binding.new_accepted_root);
    assert_eq!(updated.accepted_count, binding.accepted_leaf_index + 1);
}

fn batch_quote(value: LmsrBatchQuote) -> BatchQuote {
    BatchQuote {
        state_version: value.state_version,
        batch_size: value.batch_size,
        yes_count: value.yes_count,
        no_count: value.no_count,
        pre_yes_price: value.pre_yes_price,
        post_yes_price: value.post_yes_price,
        yes_price: value.yes_price,
        no_price: value.no_price,
        aggregate_market_charge: value.aggregate_market_charge,
        yes_market_cost: value.yes_market_cost,
        no_market_cost: value.no_market_cost,
        yes_charge_per_position: value.yes_charge_per_position,
        no_charge_per_position: value.no_charge_per_position,
        rounding_contribution: value.rounding_contribution,
        fee_per_position: value.fee_per_position,
        fee_escrow: value.fee_escrow,
        conditional_lp_fee: value.conditional_lp_fee,
        conditional_protocol_fee: value.conditional_protocol_fee,
    }
}

fn valid_submission(
    setup: &Setup,
    market: &Address,
    yes_count: u32,
    no_count: u32,
) -> BatchSubmission {
    let epoch = setup.vault.epoch(market, &0).unwrap();
    let submission = BatchSubmission {
        yes_count,
        no_count,
        committee_epoch: epoch.committee_epoch,
        aggregate_ciphertext: order_ciphertext(&setup.env, 100),
        decryption_proof_hash: id(&setup.env, 101),
        committee_statement_hash: id(&setup.env, 102),
        allocation_root: field(&setup.env, 200),
        included_root: field(&setup.env, 201),
        proof: Bytes::from_array(&setup.env, &[19, 23, 29, 31]),
    };
    let statement = batch_statement(setup, market, &epoch, &submission, yes_count, no_count);
    expect_batch_statement(setup, &statement);
    submission
}

fn batch_statement(
    setup: &Setup,
    market: &Address,
    epoch: &crate::EpochState,
    submission: &BatchSubmission,
    yes_count: u32,
    no_count: u32,
) -> BatchProofStatement {
    BatchProofStatement {
        network_domain: setup.vault.info().network_domain,
        vault: setup.vault.address.clone(),
        market: market.clone(),
        epoch: epoch.epoch,
        accepted_root: epoch.accepted_root.clone(),
        accepted_count: epoch.accepted_count,
        first_sequence: epoch.first_sequence,
        last_sequence: epoch.last_sequence,
        committee_epoch: epoch.committee_epoch,
        committee_config_hash: epoch.committee_config_hash.clone(),
        committee_public_key_x: epoch.committee_public_key_x.clone(),
        committee_public_key_y: epoch.committee_public_key_y.clone(),
        aggregate_ciphertext: Vec::from_array(
            &setup.env,
            [
                submission.aggregate_ciphertext.yes_c1_x.clone(),
                submission.aggregate_ciphertext.yes_c1_y.clone(),
                submission.aggregate_ciphertext.yes_c2_x.clone(),
                submission.aggregate_ciphertext.yes_c2_y.clone(),
                submission.aggregate_ciphertext.no_c1_x.clone(),
                submission.aggregate_ciphertext.no_c1_y.clone(),
                submission.aggregate_ciphertext.no_c2_x.clone(),
                submission.aggregate_ciphertext.no_c2_y.clone(),
            ],
        ),
        decryption_proof_hash: submission.decryption_proof_hash.clone(),
        committee_statement_hash: submission.committee_statement_hash.clone(),
        allocation_root: submission.allocation_root.clone(),
        included_root: submission.included_root.clone(),
        lot_size: setup.vault.registration(market).unwrap().lot_size,
        quote: batch_quote(
            LmsrMarketClient::new(&setup.env, market).quote_private_batch(
                &epoch.market_state_version,
                &yes_count,
                &no_count,
            ),
        ),
    }
}

fn expect_batch_statement(setup: &Setup, statement: &BatchProofStatement) {
    let digest: BytesN<32> = setup
        .env
        .crypto()
        .sha256(&statement.to_xdr(&setup.env))
        .into();
    setup.verifier.set_expected_batch(&digest);
}

#[test]
fn complete_epoch_executes_once_with_mandatory_proof_and_exact_accounting() {
    let setup = setup();
    let (market_address, liquidity_address, resolver) = setup_private_market(&setup);
    deposit(&setup, 10, 2, [11, 12], 100_000_000);
    for index in 0..8u32 {
        accept_test_order(
            &setup,
            &market_address,
            20 + index as u8,
            3 + index,
            100 + index * 2,
            [200 + index * 2, 201 + index * 2],
        );
    }
    let sealed = setup.vault.seal_epoch(&market_address, &0);
    assert_eq!(sealed.phase, EpochPhase::Sealed);
    assert_eq!(sealed.accepted_count, 8);

    let submission = valid_submission(&setup, &market_address, 2, 6);
    setup.env.set_auths(&[]);
    let mut invalid = submission.clone();
    invalid.proof = Bytes::from_array(&setup.env, &[1]);
    assert!(setup
        .vault
        .try_submit_batch(&market_address, &0, &invalid)
        .is_err());
    assert_eq!(
        LmsrMarketClient::new(&setup.env, &market_address).state_version(),
        0
    );

    let epoch = setup.vault.epoch(&market_address, &0).unwrap();
    let mut wrong_committee = batch_statement(&setup, &market_address, &epoch, &submission, 2, 6);
    wrong_committee.committee_config_hash = id(&setup.env, 94);
    expect_batch_statement(&setup, &wrong_committee);
    assert!(setup
        .vault
        .try_submit_batch(&market_address, &0, &submission)
        .is_err());
    let submission = valid_submission(&setup, &market_address, 2, 6);
    let batch = setup.vault.submit_batch(&market_address, &0, &submission);
    assert_eq!(batch.quote.aggregate_market_charge, 40_998_338);
    assert_eq!(batch.quote.rounding_contribution, 2);
    assert_eq!(batch.quote.fee_escrow, 798_008);
    assert_eq!(batch.user_market_charge, 40_998_336);
    assert_eq!(
        setup.vault.epoch(&market_address, &0).unwrap().phase,
        EpochPhase::Executed
    );
    for sequence in 1..=8 {
        assert_eq!(
            setup
                .vault
                .order(&market_address, &sequence)
                .unwrap()
                .status,
            OrderStatus::Executed
        );
    }
    let info = setup.vault.info();
    assert_eq!(info.shielded_liabilities, 59_001_664);
    assert_eq!(info.rounding_reserve, 9_999_998);
    assert_eq!(info.rounding_receivable, 2);
    assert_eq!(setup.vault.unallocated_balance(), 0);
    let accounting = setup.vault.accounting(&market_address).unwrap();
    assert_eq!(accounting.user_market_charges, 40_998_336);
    assert_eq!(accounting.fee_escrow, 798_008);
    let next_epoch = setup.vault.open_next_epoch(&market_address, &0);
    assert_eq!(next_epoch.epoch, 1);
    assert_eq!(
        next_epoch.market_state_version,
        LmsrMarketClient::new(&setup.env, &market_address).state_version()
    );
    assert_eq!(next_epoch.accepted_count, 0);
    assert_eq!(next_epoch.committee_config_hash, id(&setup.env, 93));
    assert_eq!(
        setup
            .vault
            .registration(&market_address)
            .unwrap()
            .current_epoch,
        1
    );

    let change_action = id(&setup.env, 50);
    let change_expiry = 10_500u64;
    let change_binding = AllocationBinding {
        market: market_address.clone(),
        epoch: 0,
        allocation_root: batch.allocation_root.clone(),
        outcome: SettlementState::Pending,
        lot_size: S,
        quote: batch.quote.clone(),
    };
    let change_operation_binding =
        ShieldedCollateralVault::allocation_operation_binding(&setup.env, &change_binding);
    let change_digest = setup.vault.context_digest(
        &ProofAction::ExecutionChange,
        &change_action,
        &None,
        &0,
        &Some(market_address.clone()),
        &change_operation_binding,
        &change_expiry,
    );
    setup.verifier.set_expected(&change_digest);
    setup.vault.recover_execution_change(
        &market_address,
        &0,
        &change_action,
        &change_expiry,
        &transition(&setup.env, 10, 10, 11, &[500], [501, 502]),
    );
    assert!(setup
        .vault
        .try_recover_execution_change(
            &market_address,
            &0,
            &id(&setup.env, 51),
            &change_expiry,
            &transition(&setup.env, 11, 11, 12, &[500], [503, 504]),
        )
        .is_err());

    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = 11_301);
    setup.env.mock_all_auths();
    LmsrMarketClient::new(&setup.env, &market_address).resolve(&resolver, &Outcome::Yes);
    setup.env.set_auths(&[]);
    let finalized = setup.vault.finalize_market(&market_address);
    assert_eq!(finalized.finalized_outcome, SettlementState::Yes);
    assert_eq!(setup.vault.info().rounding_reserve, 10_000_000);
    assert_eq!(setup.vault.info().rounding_receivable, 0);
    assert_eq!(setup.vault.info().protocol_fees, 399_003);
    assert_eq!(
        MarketLiquidityVaultClient::new(&setup.env, &liquidity_address)
            .info()
            .terminal_assets,
        221_397_341
    );

    let treasury_action = id(&setup.env, 60);
    let terminal_expiry = 11_500u64;
    let treasury_digest = setup.vault.context_digest(
        &ProofAction::Treasury,
        &treasury_action,
        &None,
        &399_003,
        &None,
        &ShieldedCollateralVault::treasury_operation_binding(
            &setup.env,
            &setup.vault.info().treasury_key,
        ),
        &terminal_expiry,
    );
    setup.verifier.set_expected(&treasury_digest);
    setup.vault.shield_protocol_fees(
        &399_003,
        &treasury_action,
        &terminal_expiry,
        &transition(&setup.env, 11, 11, 12, &[], [601, 602]),
    );
    assert_eq!(setup.vault.info().protocol_fees, 0);

    let claim_action = id(&setup.env, 61);
    let claim_binding = AllocationBinding {
        market: market_address.clone(),
        epoch: 0,
        allocation_root: batch.allocation_root,
        outcome: SettlementState::Yes,
        lot_size: S,
        quote: batch.quote,
    };
    let claim_operation_binding =
        ShieldedCollateralVault::allocation_operation_binding(&setup.env, &claim_binding);
    let claim_digest = setup.vault.context_digest(
        &ProofAction::Claim,
        &claim_action,
        &None,
        &0,
        &Some(market_address.clone()),
        &claim_operation_binding,
        &terminal_expiry,
    );
    setup.verifier.set_expected(&claim_digest);
    setup.vault.claim_position(
        &market_address,
        &0,
        &claim_action,
        &terminal_expiry,
        &transition(&setup.env, 12, 12, 13, &[700], [701, 702]),
    );
}

#[test]
fn a_full_epoch_rejects_the_next_order_before_consuming_its_notes() {
    let setup = setup();
    let (market_address, _liquidity_address, _resolver) = setup_private_market(&setup);
    deposit(&setup, 10, 2, [11, 12], 100_000_000);
    for index in 0..8u32 {
        accept_test_order(
            &setup,
            &market_address,
            20 + index as u8,
            3 + index,
            100 + index * 2,
            [200 + index * 2, 201 + index * 2],
        );
    }

    let current_root = setup.vault.info().current_root.to_u128().unwrap() as u32;
    let rejected_nullifier = field(&setup.env, 999);
    let next_output_index = setup.vault.info().next_leaf_index;
    assert!(setup
        .vault
        .try_accept_order(
            &market_address,
            &0,
            &id(&setup.env, 80),
            &field(&setup.env, 801),
            &order_ciphertext(&setup.env, 80),
            &transition(
                &setup.env,
                current_root,
                current_root,
                99,
                &[999],
                [800, 801],
            ),
        )
        .is_err());
    assert!(!setup.vault.is_spent(&rejected_nullifier));
    assert_eq!(setup.vault.output(&next_output_index), None);
    assert_eq!(
        setup.vault.info().current_root,
        field(&setup.env, current_root)
    );
}

#[test]
fn invalid_order_points_fail_before_note_consumption() {
    let setup = setup();
    let (market_address, _liquidity_address, _resolver) = setup_private_market(&setup);
    deposit(&setup, 10, 2, [11, 12], 25_000_000);
    let nullifier = field(&setup.env, 100);
    let invalid = EncryptedOrder {
        yes_c1_x: field(&setup.env, 5),
        yes_c1_y: field(&setup.env, 6),
        yes_c2_x: field(&setup.env, 7),
        yes_c2_y: field(&setup.env, 8),
        no_c1_x: field(&setup.env, 9),
        no_c1_y: field(&setup.env, 10),
        no_c2_x: field(&setup.env, 11),
        no_c2_y: field(&setup.env, 12),
    };
    assert!(setup
        .vault
        .try_accept_order(
            &market_address,
            &0,
            &id(&setup.env, 20),
            &field(&setup.env, 201),
            &invalid,
            &transition(&setup.env, 2, 2, 3, &[100], [200, 201]),
        )
        .is_err());
    assert!(!setup.vault.is_spent(&nullifier));
    assert_eq!(
        setup
            .vault
            .epoch(&market_address, &0)
            .unwrap()
            .accepted_count,
        0
    );
}

#[test]
fn singleton_epoch_executes_after_its_window() {
    let setup = setup();
    let (market_address, _liquidity_address, _resolver) = setup_private_market(&setup);
    deposit(&setup, 10, 2, [11, 12], 25_000_000);
    accept_test_order(&setup, &market_address, 20, 3, 100, [200, 201]);
    let epoch = setup.vault.epoch(&market_address, &0).unwrap();
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = epoch.cutoff);
    let sealed = setup.vault.seal_epoch(&market_address, &0);
    assert_eq!(sealed.accepted_count, 1);
    let submission = valid_submission(&setup, &market_address, 1, 0);
    let batch = setup.vault.submit_batch(&market_address, &0, &submission);
    assert_eq!(batch.quote.yes_count, 1);
    assert_eq!(batch.quote.no_count, 0);
    assert!(batch.quote.post_yes_price > batch.quote.pre_yes_price);
}

#[test]
fn missed_batch_never_moves_price_and_every_order_reaches_private_refund() {
    let setup = setup();
    let (market_address, _liquidity_address, _resolver) = setup_private_market(&setup);
    deposit(&setup, 10, 2, [11, 12], 25_000_000);
    accept_test_order(&setup, &market_address, 20, 3, 100, [200, 201]);
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = 10_181);
    let refundable = setup.vault.make_epoch_refundable(&market_address, &0);
    assert_eq!(refundable.phase, EpochPhase::Refundable);
    assert_eq!(
        LmsrMarketClient::new(&setup.env, &market_address).get_state(),
        (0, 0, 20 * S)
    );

    let action_id = id(&setup.env, 40);
    let action_expiry = 10_500u64;
    let binding = crate::RefundBinding {
        market: market_address.clone(),
        epoch: 0,
        accepted_root: refundable.accepted_root,
    };
    let operation_binding = ShieldedCollateralVault::refund_operation_binding(&setup.env, &binding);
    let digest = setup.vault.context_digest(
        &ProofAction::Refund,
        &action_id,
        &None,
        &0,
        &Some(market_address.clone()),
        &operation_binding,
        &action_expiry,
    );
    setup.verifier.set_expected(&digest);
    setup.vault.refund_order(
        &market_address,
        &0,
        &action_id,
        &action_expiry,
        &transition(&setup.env, 3, 3, 4, &[300], [301, 302]),
    );
    assert!(setup.vault.is_spent(&field(&setup.env, 300)));
    assert_eq!(
        setup.vault.order(&market_address, &1).unwrap().status,
        OrderStatus::Pending
    );
    assert_eq!(setup.vault.info().shielded_liabilities, 25_000_000);
}

#[test]
fn void_restores_user_charges_fees_rounding_and_lp_principal_without_platform_revenue() {
    let setup = setup();
    let (market_address, liquidity_address, resolver) = setup_private_market(&setup);
    deposit(&setup, 10, 2, [11, 12], 100_000_000);
    for index in 0..8u32 {
        accept_test_order(
            &setup,
            &market_address,
            20 + index as u8,
            3 + index,
            100 + index * 2,
            [200 + index * 2, 201 + index * 2],
        );
    }
    setup.vault.seal_epoch(&market_address, &0);
    let submission = valid_submission(&setup, &market_address, 2, 6);
    setup.vault.submit_batch(&market_address, &0, &submission);
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = 11_301);
    LmsrMarketClient::new(&setup.env, &market_address).void(&resolver);
    setup.env.set_auths(&[]);
    let accounting = setup.vault.finalize_market(&market_address);

    assert_eq!(accounting.finalized_outcome, SettlementState::Void);
    let info = setup.vault.info();
    assert_eq!(info.shielded_liabilities, 100_000_000);
    assert_eq!(info.rounding_reserve, 10_000_000);
    assert_eq!(info.rounding_receivable, 0);
    assert_eq!(info.protocol_fees, 0);
    assert_eq!(setup.vault.unallocated_balance(), 0);
    assert_eq!(
        MarketLiquidityVaultClient::new(&setup.env, &liquidity_address)
            .info()
            .terminal_assets,
        200_000_000
    );
}
