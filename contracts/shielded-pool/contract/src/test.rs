#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as TestAddress, Ledger};
use soroban_sdk::{symbol_short, vec, Address, Bytes, BytesN, Env, Vec};

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn initialize(env: &Env, admin: Address, decimals: u32) {
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &admin);
        env.storage()
            .instance()
            .set(&symbol_short!("decimals"), &decimals);
    }

    pub fn mint(env: &Env, to: Address, amount: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap();
        admin.require_auth();
        let balance = env.storage().instance().get(&to).unwrap_or(0i128);
        env.storage().instance().set(&to, &(balance + amount));
    }

    pub fn balance(env: &Env, id: Address) -> i128 {
        env.storage().instance().get(&id).unwrap_or(0)
    }

    pub fn decimals(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("decimals"))
            .unwrap()
    }

    pub fn transfer(env: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_balance = env.storage().instance().get(&from).unwrap_or(0i128);
        if amount < 0 || from_balance < amount {
            panic!("insufficient balance");
        }
        let to_balance = env.storage().instance().get(&to).unwrap_or(0i128);
        env.storage()
            .instance()
            .set(&from, &(from_balance - amount));
        env.storage().instance().set(&to, &(to_balance + amount));
    }
}

#[contract]
pub struct MockMarket;

#[contractimpl]
impl MockMarket {
    pub fn __constructor(env: Env, expiry: u64, finalize_after: u64) {
        env.storage()
            .instance()
            .set(&symbol_short!("outcome"), &Option::<Outcome>::None);
        env.storage()
            .instance()
            .set(&symbol_short!("expiry"), &expiry);
        env.storage()
            .instance()
            .set(&symbol_short!("finalize"), &finalize_after);
        env.storage().instance().set(&symbol_short!("qy"), &0i128);
        env.storage().instance().set(&symbol_short!("qn"), &0i128);
    }

    pub fn outcome(env: Env) -> Option<Outcome> {
        env.storage()
            .instance()
            .get(&symbol_short!("outcome"))
            .unwrap()
    }

    pub fn set_outcome(env: Env, outcome: Option<Outcome>) {
        env.storage()
            .instance()
            .set(&symbol_short!("outcome"), &outcome);
    }

    pub fn market_info(env: Env) -> MarketInfo {
        MarketInfo {
            asset: symbol_short!("TEST"),
            threshold: 0,
            expiry: env
                .storage()
                .instance()
                .get(&symbol_short!("expiry"))
                .unwrap(),
            finalize_after: env
                .storage()
                .instance()
                .get(&symbol_short!("finalize"))
                .unwrap(),
        }
    }

    pub fn set_token(env: Env, token: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
    }

    pub fn quote_batch(_env: Env, dqyes: i128, dqno: i128) -> i128 {
        (dqyes + dqno) / 2
    }

    pub fn apply_batch(env: Env, batcher: Address, dqyes: i128, dqno: i128) -> i128 {
        let net = (dqyes + dqno) / 2;
        let token: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        soroban_sdk::token::Client::new(&env, &token).transfer(
            &batcher,
            &env.current_contract_address(),
            &net,
        );
        let qyes = env
            .storage()
            .instance()
            .get(&symbol_short!("qy"))
            .unwrap_or(0i128);
        let qno = env
            .storage()
            .instance()
            .get(&symbol_short!("qn"))
            .unwrap_or(0i128);
        env.storage()
            .instance()
            .set(&symbol_short!("qy"), &(qyes + dqyes));
        env.storage()
            .instance()
            .set(&symbol_short!("qn"), &(qno + dqno));
        net
    }

    pub fn price_yes(_env: Env) -> i128 {
        SCALE / 2
    }

    pub fn redeem(_env: Env, _trader: Address, _side: Side) -> i128 {
        0
    }
}

struct Setup {
    token: Address,
    pool: Address,
    market: Address,
    admin: Address,
    treasury: Address,
}

fn setup(env: &Env) -> Setup {
    env.mock_all_auths();
    let token_admin = Address::generate(env);
    let token = env.register(MockToken, ());
    MockTokenClient::new(env, &token).initialize(&token_admin, &7);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let market = env.register(MockMarket, (1_000u64, 1_100u64));
    MockMarketClient::new(env, &market).set_token(&token);
    let pool = env.register(
        PrivacyPoolsContract,
        (
            token.clone(),
            admin.clone(),
            market.clone(),
            treasury.clone(),
            200u32,
        ),
    );
    Setup {
        token,
        pool,
        market,
        admin,
        treasury,
    }
}

fn commitment(env: &Env, value: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[31] = value;
    BytesN::from_array(env, &bytes)
}

fn committee(env: &Env) -> (Address, Address, Address) {
    (
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
    )
}

fn place_orders(
    env: &Env,
    setup: &Setup,
    owner: &Address,
    count: u8,
) -> (Vec<BytesN<32>>, Vec<BytesN<32>>) {
    let client = PrivacyPoolsContractClient::new(env, &setup.pool);
    MockTokenClient::new(env, &setup.token).mint(owner, &(i128::from(count) * 100_000_000));
    let mut commitments = Vec::new(env);
    let mut nullifiers = Vec::new(env);
    for index in 0..count {
        let order_commitment = commitment(env, index + 1);
        client.place_order(owner, &order_commitment, &100_000_000);
        commitments.push_back(order_commitment);
        nullifiers.push_back(commitment(env, index + 101));
    }
    (commitments, nullifiers)
}

#[test]
fn constructor_sets_canonical_configuration() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);

    assert_eq!(client.get_admin(), setup.admin);
    assert_eq!(client.market(), setup.market);
    assert_eq!(client.collateral(), setup.token);
    assert_eq!(client.fee_config(), (setup.treasury, 200));
    assert_eq!(client.security_config(), (vec![&env], 0, false));
    assert_ne!(client.get_order_root(), BytesN::from_array(&env, &[0; 32]));
}

#[test]
#[should_panic(expected = "invalid fee configuration")]
fn constructor_rejects_fee_above_ten_percent() {
    let env = Env::default();
    env.mock_all_auths();
    let token_admin = Address::generate(&env);
    let token = env.register(MockToken, ());
    MockTokenClient::new(&env, &token).initialize(&token_admin, &7);
    let admin = Address::generate(&env);
    let market = env.register(MockMarket, (1_000u64, 1_100u64));
    env.register(
        PrivacyPoolsContract,
        (token, admin.clone(), market, admin, MAX_FEE_BPS + 1),
    );
}

#[test]
fn stake_buckets_hide_exact_order_amount() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);

    assert_eq!(client.required_stake(&1), 10_000_000);
    assert_eq!(client.required_stake(&2), 50_000_000);
    assert_eq!(client.required_stake(&11), 250_000_000);
    assert_eq!(client.required_stake(&1_000), 10_000_000_000);
    assert!(client.try_required_stake(&0).is_err());
    assert!(client.try_required_stake(&1_001).is_err());
}

#[test]
fn security_configuration_requires_admin_majority_and_unique_members() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);
    let outsider = Address::generate(&env);
    let (member1, member2, member3) = committee(&env);

    assert!(client
        .try_set_committee(
            &outsider,
            &vec![&env, member1.clone(), member2.clone(), member3.clone()],
            &2,
        )
        .is_err());
    assert!(client
        .try_set_committee(
            &setup.admin,
            &vec![&env, member1.clone(), member2.clone()],
            &1,
        )
        .is_err());
    assert!(client
        .try_set_committee(
            &setup.admin,
            &vec![&env, member1.clone(), member1.clone(), member2.clone()],
            &2,
        )
        .is_err());
    client.set_committee(
        &setup.admin,
        &vec![&env, member1.clone(), member2.clone(), member3.clone()],
        &2,
    );
    assert_eq!(
        client.security_config(),
        (
            vec![&env, member1.clone(), member2.clone(), member3.clone()],
            2,
            false,
        )
    );
    assert!(client
        .try_set_committee(&setup.admin, &vec![&env, member1, member2, member3], &2)
        .is_err());

    let key = Bytes::from_array(&env, &[1, 2, 3]);
    assert!(client.try_set_redeem_vk(&outsider, &key).is_err());
    client.set_redeem_vk(&setup.admin, &key);
    assert!(client.try_set_redeem_vk(&setup.admin, &key).is_err());
    assert!(client.security_config().2);
}

#[test]
fn place_order_rejects_invalid_duplicate_and_closed_orders() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);
    let token = MockTokenClient::new(&env, &setup.token);
    let owner = Address::generate(&env);
    token.mint(&owner, &300_000_000);
    let first = commitment(&env, 1);

    assert!(client.try_place_order(&owner, &first, &0).is_err());
    assert!(client.try_place_order(&owner, &first, &20_000_000).is_err());
    assert!(client
        .try_place_order(&owner, &first, &100_000_001)
        .is_err());
    client.place_order(&owner, &first, &100_000_000);
    assert!(client
        .try_place_order(&owner, &first, &100_000_000)
        .is_err());

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    assert!(client
        .try_place_order(&owner, &commitment(&env, 2), &100_000_000)
        .is_err());
    assert_eq!(token.balance(&setup.pool), 100_000_000);
}

#[test]
fn pending_order_refund_unlocks_at_final_batch_deadline() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);
    let token = MockTokenClient::new(&env, &setup.token);
    let owner = Address::generate(&env);
    let outsider = Address::generate(&env);
    let order_commitment = commitment(&env, 3);
    token.mint(&owner, &100_000_000);
    client.place_order(&owner, &order_commitment, &100_000_000);

    assert!(client
        .try_refund_order(&outsider, &order_commitment)
        .is_err());
    assert!(client.try_refund_order(&owner, &order_commitment).is_err());
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_100);
    assert_eq!(client.refund_order(&owner, &order_commitment), 100_000_000);
    assert_eq!(token.balance(&owner), 100_000_000);
    assert_eq!(
        client.get_order(&order_commitment).unwrap().status,
        OrderStatus::Refunded
    );
    assert!(client.try_refund_order(&owner, &order_commitment).is_err());
}

#[test]
fn pending_order_remains_refundable_after_resolution() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);
    let owner = Address::generate(&env);
    let order_commitment = commitment(&env, 4);
    MockTokenClient::new(&env, &setup.token).mint(&owner, &100_000_000);
    client.place_order(&owner, &order_commitment, &100_000_000);

    MockMarketClient::new(&env, &setup.market).set_outcome(&Some(Outcome::Yes));
    assert_eq!(client.refund_order(&owner, &order_commitment), 100_000_000);
}

#[test]
fn committee_batches_require_quorum_members_and_full_pre_expiry_batch() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);
    let owner = Address::generate(&env);
    let (member1, member2, member3) = committee(&env);
    let outsider = Address::generate(&env);
    client.set_committee(
        &setup.admin,
        &vec![&env, member1.clone(), member2.clone(), member3],
        &2,
    );
    let (commitments, nullifiers) = place_orders(&env, &setup, &owner, 4);

    assert!(client
        .try_submit_batch_committee(
            &vec![&env, member1.clone(), member2.clone()],
            &1,
            &0,
            &vec![&env, nullifiers.get(0).unwrap()],
            &vec![&env, commitments.get(0).unwrap()],
        )
        .is_err());
    assert!(client
        .try_submit_batch_committee(
            &vec![&env, member1.clone(), member1.clone()],
            &2,
            &2,
            &nullifiers,
            &commitments,
        )
        .is_err());
    assert!(client
        .try_submit_batch_committee(
            &vec![&env, member1.clone(), outsider],
            &2,
            &2,
            &nullifiers,
            &commitments,
        )
        .is_err());
    client.submit_batch_committee(
        &vec![&env, member1, member2],
        &2,
        &2,
        &nullifiers,
        &commitments,
    );

    for order_commitment in commitments.iter() {
        assert_eq!(
            client.get_order(&order_commitment).unwrap().status,
            OrderStatus::Included
        );
    }
    assert_eq!(client.get_price(), SCALE / 2);
    assert_eq!(
        MockTokenClient::new(&env, &setup.token).balance(&setup.market),
        2
    );
    assert!(client
        .try_submit_batch_committee(
            &vec![&env, Address::generate(&env), Address::generate(&env)],
            &2,
            &2,
            &nullifiers,
            &commitments,
        )
        .is_err());
}

#[test]
fn final_batch_accepts_two_orders_after_expiry_and_rejects_after_deadline() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);
    let owner = Address::generate(&env);
    let (member1, member2, member3) = committee(&env);
    client.set_committee(
        &setup.admin,
        &vec![&env, member1.clone(), member2.clone(), member3],
        &2,
    );
    let (commitments, nullifiers) = place_orders(&env, &setup, &owner, 3);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    client.submit_batch_committee(
        &vec![&env, member1.clone(), member2.clone()],
        &1,
        &1,
        &Vec::from_array(
            &env,
            [nullifiers.get(0).unwrap(), nullifiers.get(1).unwrap()],
        ),
        &Vec::from_array(
            &env,
            [commitments.get(0).unwrap(), commitments.get(1).unwrap()],
        ),
    );
    assert_eq!(
        client
            .get_order(&commitments.get(2).unwrap())
            .unwrap()
            .status,
        OrderStatus::Pending
    );

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_100);
    assert!(client
        .try_submit_batch_committee(
            &vec![&env, member1, member2],
            &1,
            &0,
            &vec![&env, nullifiers.get(2).unwrap()],
            &vec![&env, commitments.get(2).unwrap()],
        )
        .is_err());
}

#[test]
fn voided_market_refunds_included_order() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);
    let owner = Address::generate(&env);
    let (member1, member2, member3) = committee(&env);
    client.set_committee(
        &setup.admin,
        &vec![&env, member1.clone(), member2.clone(), member3],
        &2,
    );
    let (commitments, nullifiers) = place_orders(&env, &setup, &owner, 4);
    client.submit_batch_committee(
        &vec![&env, member1, member2],
        &2,
        &2,
        &nullifiers,
        &commitments,
    );
    MockMarketClient::new(&env, &setup.market).set_outcome(&Some(Outcome::Void));

    let token = MockTokenClient::new(&env, &setup.token);
    let before = token.balance(&owner);
    assert_eq!(
        client.refund_order(&owner, &commitments.get(0).unwrap()),
        100_000_000
    );
    assert_eq!(token.balance(&owner), before + 100_000_000);
}

#[test]
fn claim_winnings_requires_resolved_non_void_market_and_is_one_time() {
    let env = Env::default();
    let setup = setup(&env);
    let client = PrivacyPoolsContractClient::new(&env, &setup.pool);

    assert!(client.try_claim_winnings().is_err());
    MockMarketClient::new(&env, &setup.market).set_outcome(&Some(Outcome::Void));
    assert!(client.try_claim_winnings().is_err());
    MockMarketClient::new(&env, &setup.market).set_outcome(&Some(Outcome::Yes));
    assert_eq!(client.claim_winnings(), 0);
    assert!(client.try_claim_winnings().is_err());
}
