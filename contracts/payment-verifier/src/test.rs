extern crate std;

use super::*;
use soroban_sdk::testutils::Address as _;

#[test]
fn starts_unfinalized_and_rejects_proofs() {
    let env = Env::default();
    let controller = Address::generate(&env);
    let contract_id = env.register(PaymentVerifier, (controller,));
    let client = PaymentVerifierClient::new(&env, &contract_id);
    let info = client.info();
    assert_eq!(info.circuits, 0);
    assert_eq!(info.required_circuits, PAYMENT_REQUIRED_CIRCUITS);
    assert!(!info.finalized);

    let statement = PaymentProofStatement {
        action: payment_types::PaymentAction::Transfer,
        circuit: PaymentCircuit::TransferOne,
        context_digest: U256::from_u32(&env, 1),
        membership_root: U256::from_u32(&env, 2),
        input_nullifiers: Vec::from_array(&env, [U256::from_u32(&env, 3)]),
        output_commitments: Vec::from_array(
            &env,
            [
                U256::from_u32(&env, 4),
                U256::from_u32(&env, 5),
                U256::from_u32(&env, 6),
                U256::from_u32(&env, 7),
            ],
        ),
        output_envelope_hashes: Vec::from_array(
            &env,
            [
                U256::from_u32(&env, 8),
                U256::from_u32(&env, 9),
                U256::from_u32(&env, 10),
                U256::from_u32(&env, 11),
            ],
        ),
        attachment_hash: U256::from_u32(&env, 12),
        public_amount: 0,
    };
    assert!(!client.verify(&statement, &Bytes::new(&env)));
}
