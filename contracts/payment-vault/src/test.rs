#![cfg(test)]
extern crate std;

use crate::{PaymentVault, PaymentVaultClient};
use ed25519_dalek::{Signer, SigningKey};
use payment_types::{
    payment_attachment_hash, payment_context_digest, payment_public_inputs, relay_quote_digest,
    relay_quote_message, unsigned_relay_quote, PaymentAction, PaymentCircuit, PaymentContext,
    PaymentFeeConfig, PaymentIdentity, PaymentProofStatement, PaymentTransition, RelayQuote,
    PAYMENT_ATTACHMENT_LENGTH, PAYMENT_OUTPUT_ENVELOPE_LENGTH,
};
use privacy_types::output_envelope_hash;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec, U256};

const NOW: u64 = 10_000;
const EXPIRY: u64 = 20_000;
const PROOF: [u8; 4] = [7, 11, 13, 17];
const MAINNET_CPU_LIMIT: u64 = 400_000_000;
const MAINNET_MEMORY_LIMIT: u64 = 40 * 1024 * 1024;

#[contract]
struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn domain(env: Env) -> BytesN<32> {
        id(&env, 2)
    }

    pub fn verify(env: Env, statement: PaymentProofStatement, proof: Bytes) -> bool {
        payment_public_inputs(&env, &statement).is_ok() && proof == Bytes::from_array(&env, &PROOF)
    }
}

struct Setup {
    env: Env,
    vault: Address,
    token: Address,
    user: Address,
    admin: Address,
    network_domain: BytesN<32>,
    verifier_domain: BytesN<32>,
    protocol_identity: PaymentIdentity,
    relay_signing: SigningKey,
}

impl Setup {
    fn client(&self) -> PaymentVaultClient<'_> {
        PaymentVaultClient::new(&self.env, &self.vault)
    }

    fn deposit(&self, action_byte: u8, amount: i128) {
        let action_id = id(&self.env, action_byte);
        let context = PaymentContext {
            network_domain: self.network_domain.clone(),
            vault: self.vault.clone(),
            token: self.token.clone(),
            verifier_domain: self.verifier_domain.clone(),
            action: PaymentAction::Deposit,
            action_id: action_id.clone(),
            expiry: EXPIRY,
            public_account: Some(self.user.clone()),
            public_amount: amount,
            output_count: 2,
            append_count: 2,
            emergency: false,
            fee: PaymentFeeConfig {
                epoch: self.client().info().fee.epoch,
                protocol_fee: 0,
                protocol_identity: self.protocol_identity.clone(),
            },
            relay_quote_digest: field(&self.env, 0),
            relay_fee: 0,
            relay_identity: self.protocol_identity.clone(),
            attachment_hash: field(&self.env, 0),
        };
        let transition = transition(
            &self.env,
            PaymentCircuit::Deposit,
            payment_context_digest(&self.env, &context).unwrap(),
            field(&self.env, 0),
            &[],
            &[
                u32::from(action_byte) * 10 + 1,
                u32::from(action_byte) * 10 + 2,
            ],
            Bytes::new(&self.env),
            amount,
        );
        reset_network_budget(&self.env);
        self.client()
            .deposit(&self.user, &action_id, &EXPIRY, &transition);
    }
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = NOW;
        ledger.sequence_number = 100;
    });
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &100_000_000);
    let verifier = env.register(MockVerifier, ());
    let network_domain = id(&env, 1);
    let verifier_domain = id(&env, 2);
    let protocol_identity = identity(&env, 100);
    let relay_signing = SigningKey::from_bytes(&[9; 32]);
    let relay_key = BytesN::from_array(&env, &relay_signing.verifying_key().to_bytes());
    let vault = env.register(
        PaymentVault,
        (
            admin.clone(),
            token.clone(),
            verifier,
            network_domain.clone(),
            8u32,
            8u32,
            protocol_identity.clone(),
            Vec::from_array(&env, [relay_key]),
        ),
    );
    Setup {
        env,
        vault,
        token,
        user,
        admin,
        network_domain,
        verifier_domain,
        protocol_identity,
        relay_signing,
    }
}

fn field(env: &Env, value: u32) -> U256 {
    U256::from_u32(env, value)
}

fn reset_network_budget(env: &Env) {
    env.cost_estimate()
        .budget()
        .reset_limits(MAINNET_CPU_LIMIT, MAINNET_MEMORY_LIMIT);
}

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
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

fn identity(env: &Env, spend_key: u32) -> PaymentIdentity {
    let (viewing_public_key_x, viewing_public_key_y) = babyjub_base(env);
    PaymentIdentity {
        spend_public_key: field(env, spend_key),
        viewing_public_key_x,
        viewing_public_key_y,
    }
}

fn envelope(env: &Env, byte: u8) -> Bytes {
    let mut value = Bytes::new(env);
    for index in 0..PAYMENT_OUTPUT_ENVELOPE_LENGTH / 32 {
        let mut encoded = [0u8; 32];
        encoded[31] = if index == 0 {
            1
        } else {
            byte.wrapping_add(index as u8)
        };
        value.append(&Bytes::from_array(env, &encoded));
    }
    value
}

fn attachment(env: &Env, byte: u8) -> Bytes {
    let mut value = Bytes::new(env);
    for index in 0..PAYMENT_ATTACHMENT_LENGTH / 32 {
        let mut encoded = [0u8; 32];
        encoded[31] = byte.wrapping_add(index as u8);
        value.append(&Bytes::from_array(env, &encoded));
    }
    value
}

fn transition(
    env: &Env,
    circuit: PaymentCircuit,
    context_digest: U256,
    membership_root: U256,
    nullifiers: &[u32],
    commitments: &[u32],
    encrypted_attachment: Bytes,
    public_amount: i128,
) -> PaymentTransition {
    let mut input_nullifiers = Vec::new(env);
    for value in nullifiers {
        input_nullifiers.push_back(field(env, *value));
    }
    let mut output_commitments = Vec::new(env);
    let mut output_envelope_hashes = Vec::new(env);
    let mut encrypted_outputs = Vec::new(env);
    for (index, value) in commitments.iter().enumerate() {
        let encrypted_output = envelope(env, (*value as u8).wrapping_add(index as u8));
        output_commitments.push_back(field(env, *value));
        output_envelope_hashes.push_back(output_envelope_hash(env, &encrypted_output).unwrap());
        encrypted_outputs.push_back(encrypted_output);
    }
    let attachment_hash = if encrypted_attachment.is_empty() {
        field(env, 0)
    } else {
        payment_attachment_hash(env, &encrypted_attachment).unwrap()
    };
    PaymentTransition {
        statement: PaymentProofStatement {
            action: circuit.action(),
            circuit,
            context_digest,
            membership_root,
            input_nullifiers,
            output_commitments,
            output_envelope_hashes,
            attachment_hash,
            public_amount,
        },
        proof: Bytes::from_array(env, &PROOF),
        encrypted_outputs,
        attachment: encrypted_attachment,
    }
}

fn signed_quote(
    setup: &Setup,
    action_id: &BytesN<32>,
    quote_byte: u8,
    fee: i128,
) -> (RelayQuote, U256) {
    let mut quote = RelayQuote {
        quote_id: id(&setup.env, quote_byte),
        signing_key: BytesN::from_array(
            &setup.env,
            &setup.relay_signing.verifying_key().to_bytes(),
        ),
        payment_identity: identity(&setup.env, 200 + u32::from(quote_byte)),
        fee,
        expiry: EXPIRY,
        signature: BytesN::from_array(&setup.env, &[0; 64]),
    };
    let unsigned = unsigned_relay_quote(
        setup.network_domain.clone(),
        setup.vault.clone(),
        setup.token.clone(),
        action_id.clone(),
        &quote,
    );
    let message: std::vec::Vec<u8> = relay_quote_message(&setup.env, &unsigned).iter().collect();
    quote.signature =
        BytesN::from_array(&setup.env, &setup.relay_signing.sign(&message).to_bytes());
    let digest = relay_quote_digest(&setup.env, &unsigned).unwrap();
    (quote, digest)
}

fn transfer_transition(
    setup: &Setup,
    action_byte: u8,
    quote_byte: u8,
    root: U256,
    nullifier: u32,
    commitments: [u32; 4],
) -> (BytesN<32>, RelayQuote, PaymentTransition) {
    let action_id = id(&setup.env, action_byte);
    let (quote, quote_digest) = signed_quote(setup, &action_id, quote_byte, 1);
    let encrypted_attachment = attachment(&setup.env, action_byte);
    let attachment_hash = payment_attachment_hash(&setup.env, &encrypted_attachment).unwrap();
    let context = PaymentContext {
        network_domain: setup.network_domain.clone(),
        vault: setup.vault.clone(),
        token: setup.token.clone(),
        verifier_domain: setup.verifier_domain.clone(),
        action: PaymentAction::Transfer,
        action_id: action_id.clone(),
        expiry: EXPIRY,
        public_account: None,
        public_amount: 0,
        output_count: 4,
        append_count: 4,
        emergency: false,
        fee: setup.client().info().fee,
        relay_quote_digest: quote_digest,
        relay_fee: quote.fee,
        relay_identity: quote.payment_identity.clone(),
        attachment_hash,
    };
    let transition = transition(
        &setup.env,
        PaymentCircuit::TransferOne,
        payment_context_digest(&setup.env, &context).unwrap(),
        root,
        &[nullifier],
        &commitments,
        encrypted_attachment,
        0,
    );
    (action_id, quote, transition)
}

#[test]
fn deposit_is_backed_and_idempotent() {
    let setup = setup();
    setup.deposit(10, 10_000_000);
    let info = setup.client().info();
    assert_eq!(info.liabilities, 10_000_000);
    assert_eq!(info.next_leaf_index, 2);
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&setup.vault),
        10_000_000
    );

    setup.deposit(10, 10_000_000);
    assert_eq!(setup.client().info().next_leaf_index, 2);
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&setup.vault),
        10_000_000
    );
}

#[test]
fn transfers_accept_the_same_historical_root_without_a_tree_race() {
    let setup = setup();
    setup.deposit(10, 10_000_000);
    let historical_root = setup.client().info().current_root;
    let (first_id, first_quote, first) = transfer_transition(
        &setup,
        20,
        30,
        historical_root.clone(),
        101,
        [201, 202, 203, 204],
    );
    reset_network_budget(&setup.env);
    setup
        .client()
        .transfer(&first_id, &EXPIRY, &0, &first_quote, &first);
    let (second_id, second_quote, second) =
        transfer_transition(&setup, 21, 31, historical_root, 102, [205, 206, 207, 208]);
    reset_network_budget(&setup.env);
    setup
        .client()
        .transfer(&second_id, &EXPIRY, &0, &second_quote, &second);

    assert_eq!(setup.client().info().next_leaf_index, 10);
    assert!(setup.client().nullifier_spent(&field(&setup.env, 101)));
    assert!(setup.client().nullifier_spent(&field(&setup.env, 102)));
}

#[test]
fn emergency_withdraw_works_while_paused_after_fees_are_enabled() {
    let setup = setup();
    setup.deposit(10, 10_000_000);
    let root = setup.client().info().current_root;
    reset_network_budget(&setup.env);
    setup.client().schedule_fee(
        &setup.admin,
        &50_000,
        &setup.protocol_identity,
        &(NOW + 3_600),
    );
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = NOW + 3_600);
    reset_network_budget(&setup.env);
    setup.client().activate_fee();
    reset_network_budget(&setup.env);
    setup.client().set_paused(&setup.admin, &true);

    let action_id = id(&setup.env, 40);
    let active_fee = setup.client().info().fee;
    let context = PaymentContext {
        network_domain: setup.network_domain.clone(),
        vault: setup.vault.clone(),
        token: setup.token.clone(),
        verifier_domain: setup.verifier_domain.clone(),
        action: PaymentAction::Withdraw,
        action_id: action_id.clone(),
        expiry: EXPIRY,
        public_account: Some(setup.user.clone()),
        public_amount: -1_000_000,
        output_count: 0,
        append_count: 0,
        emergency: true,
        fee: PaymentFeeConfig {
            epoch: active_fee.epoch,
            protocol_fee: 0,
            protocol_identity: active_fee.protocol_identity.clone(),
        },
        relay_quote_digest: field(&setup.env, 0),
        relay_fee: 0,
        relay_identity: active_fee.protocol_identity,
        attachment_hash: field(&setup.env, 0),
    };
    let transition = transition(
        &setup.env,
        PaymentCircuit::WithdrawOne,
        payment_context_digest(&setup.env, &context).unwrap(),
        root,
        &[301],
        &[],
        Bytes::new(&setup.env),
        -1_000_000,
    );
    let before = TokenClient::new(&setup.env, &setup.token).balance(&setup.user);
    reset_network_budget(&setup.env);
    setup.client().withdraw(
        &setup.user,
        &action_id,
        &EXPIRY,
        &true,
        &active_fee.epoch,
        &None,
        &transition,
    );
    assert_eq!(
        TokenClient::new(&setup.env, &setup.token).balance(&setup.user),
        before + 1_000_000
    );
    assert_eq!(setup.client().info().liabilities, 9_000_000);
}

#[test]
#[should_panic]
fn a_spent_nullifier_cannot_be_reused() {
    let setup = setup();
    setup.deposit(10, 10_000_000);
    let root = setup.client().info().current_root;
    let (first_id, first_quote, first) =
        transfer_transition(&setup, 20, 30, root.clone(), 101, [201, 202, 203, 204]);
    reset_network_budget(&setup.env);
    setup
        .client()
        .transfer(&first_id, &EXPIRY, &0, &first_quote, &first);
    let (second_id, second_quote, second) =
        transfer_transition(&setup, 21, 31, root, 101, [205, 206, 207, 208]);
    reset_network_budget(&setup.env);
    setup
        .client()
        .transfer(&second_id, &EXPIRY, &0, &second_quote, &second);
}
