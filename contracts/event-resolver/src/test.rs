#![cfg(test)]

extern crate std;

use crate::{EventResolver, EventResolverClient, Outcome};
use lmsr_market::{LmsrMarket, LmsrMarketClient, Outcome as MarketOutcome};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, vec, Address, BytesN, Env, String};

const SCALE: i128 = 1 << 32;
const EXPIRY: u64 = 1_000;
const CHALLENGE_PERIOD: u64 = 300;
const BOND: i128 = 10_000_000;

struct Setup {
    resolver: Address,
    market: Address,
    token: Address,
    proposer: Address,
    challenger: Address,
    members: [Address; 3],
}

fn evidence(env: &Env, value: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[31] = value;
    BytesN::from_array(env, &bytes)
}

fn evidence_ref(env: &Env, value: u8) -> (String, BytesN<32>) {
    let reference = String::from_str(
        env,
        if value % 2 == 0 {
            "https://source.example/a"
        } else {
            "https://source.example/b"
        },
    );
    let hash = env.crypto().sha256(&reference.clone().to_xdr(env));
    (reference, BytesN::from_array(env, &hash.to_array()))
}

fn setup(env: &Env, timestamp: u64) -> Setup {
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.timestamp = timestamp);
    let creator = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(creator.clone())
        .address();
    let proposer = Address::generate(env);
    let challenger = Address::generate(env);
    let members = [
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
    ];
    let resolver = env.register(
        EventResolver,
        (
            token.clone(),
            BOND,
            CHALLENGE_PERIOD,
            vec![
                env,
                members[0].clone(),
                members[1].clone(),
                members[2].clone(),
            ],
            2u32,
        ),
    );
    let market = env.register(
        LmsrMarket,
        (
            creator.clone(),
            token.clone(),
            100i128 * SCALE,
            symbol_short!("EVENT"),
            1i128,
            EXPIRY,
            0u64,
        ),
    );
    LmsrMarketClient::new(env, &market).set_resolver(&creator, &resolver);
    EventResolverClient::new(env, &resolver).register_market(&market, &creator, &evidence(env, 99));
    StellarAssetClient::new(env, &token).mint(&proposer, &(BOND * 2));
    StellarAssetClient::new(env, &token).mint(&challenger, &(BOND * 2));
    Setup {
        resolver,
        market,
        token,
        proposer,
        challenger,
        members,
    }
}

#[test]
fn market_rules_are_bound_once_by_market_admin() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    assert_eq!(resolver.rules_hash(&s.market), Some(evidence(&env, 99)));
    assert!(resolver
        .try_register_market(&s.market, &Address::generate(&env), &evidence(&env, 10))
        .is_err());
    assert!(resolver
        .try_register_market(&s.market, &s.proposer, &evidence(&env, 10))
        .is_err());
}

#[test]
fn proposal_requires_market_finalization_time() {
    let env = Env::default();
    let s = setup(&env, EXPIRY - 1);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let (reference, hash) = evidence_ref(&env, 1);
    assert!(resolver
        .try_propose(&s.market, &s.proposer, &Outcome::Yes, &reference, &hash)
        .is_err());
}

#[test]
fn unchallenged_proposal_finalizes_and_returns_bond() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let token = TokenClient::new(&env, &s.token);
    let before = token.balance(&s.proposer);
    let (reference, hash) = evidence_ref(&env, 2);
    let proposal = resolver.propose(&s.market, &s.proposer, &Outcome::Yes, &reference, &hash);
    assert_eq!(token.balance(&s.proposer), before - BOND);
    assert_eq!(proposal.challenge_until, EXPIRY + CHALLENGE_PERIOD);
    assert!(resolver.try_finalize(&s.market).is_err());

    env.ledger()
        .with_mut(|ledger| ledger.timestamp = proposal.challenge_until);
    assert_eq!(resolver.finalize(&s.market), Outcome::Yes);
    assert_eq!(token.balance(&s.proposer), before);
    assert_eq!(
        LmsrMarketClient::new(&env, &s.market).outcome(),
        Some(MarketOutcome::Yes)
    );
}

#[test]
fn challenger_wins_both_bonds_after_committee_arbitration() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let token = TokenClient::new(&env, &s.token);
    let (proposal_ref, proposal_hash) = evidence_ref(&env, 3);
    resolver.propose(
        &s.market,
        &s.proposer,
        &Outcome::Yes,
        &proposal_ref,
        &proposal_hash,
    );
    let challenger_before = token.balance(&s.challenger);
    let (challenge_ref, challenge_hash) = evidence_ref(&env, 4);
    resolver.challenge(
        &s.market,
        &s.challenger,
        &Outcome::No,
        &challenge_ref,
        &challenge_hash,
    );
    assert_eq!(token.balance(&s.challenger), challenger_before - BOND);
    assert!(resolver.try_finalize(&s.market).is_err());

    assert_eq!(resolver.vote(&s.market, &s.members[0], &Outcome::No), 1);
    assert_eq!(resolver.vote(&s.market, &s.members[2], &Outcome::No), 2);
    assert_eq!(token.balance(&s.challenger), challenger_before + BOND);
    assert_eq!(
        LmsrMarketClient::new(&env, &s.market).outcome(),
        Some(MarketOutcome::No)
    );
}

#[test]
fn committee_can_void_ambiguous_or_cancelled_event() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let (proposal_ref, proposal_hash) = evidence_ref(&env, 5);
    let (challenge_ref, challenge_hash) = evidence_ref(&env, 6);
    resolver.propose(
        &s.market,
        &s.proposer,
        &Outcome::Yes,
        &proposal_ref,
        &proposal_hash,
    );
    resolver.challenge(
        &s.market,
        &s.challenger,
        &Outcome::No,
        &challenge_ref,
        &challenge_hash,
    );
    resolver.vote(&s.market, &s.members[0], &Outcome::Void);
    resolver.vote(&s.market, &s.members[1], &Outcome::Void);
    assert_eq!(
        LmsrMarketClient::new(&env, &s.market).outcome(),
        Some(MarketOutcome::Void)
    );
}

#[test]
fn arbitration_rejects_non_member_and_duplicate_vote() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let (proposal_ref, proposal_hash) = evidence_ref(&env, 7);
    let (challenge_ref, challenge_hash) = evidence_ref(&env, 8);
    resolver.propose(
        &s.market,
        &s.proposer,
        &Outcome::Yes,
        &proposal_ref,
        &proposal_hash,
    );
    resolver.challenge(
        &s.market,
        &s.challenger,
        &Outcome::No,
        &challenge_ref,
        &challenge_hash,
    );
    assert!(resolver
        .try_vote(&s.market, &Address::generate(&env), &Outcome::No)
        .is_err());
    resolver.vote(&s.market, &s.members[0], &Outcome::No);
    assert!(resolver
        .try_vote(&s.market, &s.members[0], &Outcome::No)
        .is_err());
}

#[test]
fn proposer_cannot_challenge_own_result() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let (proposal_ref, proposal_hash) = evidence_ref(&env, 11);
    resolver.propose(
        &s.market,
        &s.proposer,
        &Outcome::Yes,
        &proposal_ref,
        &proposal_hash,
    );
    let (challenge_ref, challenge_hash) = evidence_ref(&env, 12);
    assert!(resolver
        .try_challenge(
            &s.market,
            &s.proposer,
            &Outcome::No,
            &challenge_ref,
            &challenge_hash
        )
        .is_err());
}

#[test]
fn proposal_rejects_evidence_hash_mismatch() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let (reference, _) = evidence_ref(&env, 13);
    assert!(resolver
        .try_propose(
            &s.market,
            &s.proposer,
            &Outcome::Yes,
            &reference,
            &evidence(&env, 13)
        )
        .is_err());
}

#[test]
fn unresolved_dispute_times_out_to_void_and_returns_bonds() {
    let env = Env::default();
    let s = setup(&env, EXPIRY);
    let resolver = EventResolverClient::new(&env, &s.resolver);
    let token = TokenClient::new(&env, &s.token);
    let proposer_before = token.balance(&s.proposer);
    let challenger_before = token.balance(&s.challenger);
    let (proposal_ref, proposal_hash) = evidence_ref(&env, 14);
    let proposal = resolver.propose(
        &s.market,
        &s.proposer,
        &Outcome::Yes,
        &proposal_ref,
        &proposal_hash,
    );
    let (challenge_ref, challenge_hash) = evidence_ref(&env, 15);
    resolver.challenge(
        &s.market,
        &s.challenger,
        &Outcome::No,
        &challenge_ref,
        &challenge_hash,
    );
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = proposal.challenge_until + CHALLENGE_PERIOD - 1);
    assert!(resolver.try_finalize(&s.market).is_err());
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = proposal.challenge_until + CHALLENGE_PERIOD);
    assert_eq!(resolver.finalize(&s.market), Outcome::Void);
    assert_eq!(token.balance(&s.proposer), proposer_before);
    assert_eq!(token.balance(&s.challenger), challenger_before);
    assert_eq!(
        LmsrMarketClient::new(&env, &s.market).outcome(),
        Some(MarketOutcome::Void)
    );
}
