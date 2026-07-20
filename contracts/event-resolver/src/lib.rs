#![no_std]

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    symbol_short, token, vec, Address, BytesN, Env, IntoVal, String, Val, Vec,
};

const TTL_THRESHOLD: u32 = 120_960;
const TTL_EXTEND_TO: u32 = 6_307_200;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    Yes,
    No,
    Void,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketInfo {
    pub asset: soroban_sdk::Symbol,
    pub threshold: i128,
    pub expiry: u64,
    pub finalize_after: u64,
}

#[contractclient(name = "MarketClient")]
pub trait Market {
    fn market_info(env: Env) -> MarketInfo;
    fn admin(env: Env) -> Address;
    fn resolver(env: Env) -> Option<Address>;
    fn outcome(env: Env) -> Option<Outcome>;
    fn resolve(env: Env, caller: Address, outcome: Outcome);
    fn void(env: Env, caller: Address);
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub proposer: Address,
    pub outcome: Outcome,
    pub evidence_hash: BytesN<32>,
    pub evidence_ref: String,
    pub proposed_at: u64,
    pub challenge_until: u64,
    pub challenger: Option<Address>,
    pub challenged_outcome: Outcome,
    pub challenged_evidence_hash: Option<BytesN<32>>,
    pub challenged_evidence_ref: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub collateral: Address,
    pub bond: i128,
    pub challenge_period: u64,
    pub committee: Vec<Address>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Bond,
    ChallengePeriod,
    Committee,
    Threshold,
    RulesHash(Address),
    Vote(Address, Address),
    VoteCount(Address, Outcome),
    Proposal(Address),
    Finalized(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidConfig = 1,
    TooEarly = 2,
    WrongResolver = 3,
    AlreadyProposed = 4,
    NoProposal = 5,
    ChallengeClosed = 6,
    AlreadyChallenged = 7,
    SameOutcome = 8,
    Disputed = 9,
    Unauthorized = 10,
    AlreadyFinalized = 11,
    NotRegistered = 12,
    SelfChallenge = 13,
    InvalidEvidence = 14,
    AlreadyVoted = 15,
}

#[contractevent(topics = ["registered"], data_format = "vec")]
pub struct Registered {
    #[topic]
    pub market: Address,
    pub rules_hash: BytesN<32>,
}

#[contractevent(topics = ["proposed"], data_format = "vec")]
pub struct Proposed {
    #[topic]
    pub market: Address,
    #[topic]
    pub proposer: Address,
    pub outcome: Outcome,
    pub evidence_hash: BytesN<32>,
    pub evidence_ref: String,
    pub challenge_until: u64,
}

#[contractevent(topics = ["challenged"], data_format = "vec")]
pub struct Challenged {
    #[topic]
    pub market: Address,
    #[topic]
    pub challenger: Address,
    pub outcome: Outcome,
    pub evidence_hash: BytesN<32>,
    pub evidence_ref: String,
}

#[contractevent(topics = ["finalized"], data_format = "vec")]
pub struct Finalized {
    #[topic]
    pub market: Address,
    pub outcome: Outcome,
    pub disputed: bool,
}

#[contractevent(topics = ["vote"], data_format = "vec")]
pub struct VoteCast {
    #[topic]
    pub market: Address,
    #[topic]
    pub member: Address,
    pub outcome: Outcome,
    pub votes: u32,
}

#[contract]
pub struct EventResolver;

#[contractimpl]
impl EventResolver {
    pub fn __constructor(
        env: Env,
        collateral: Address,
        bond: i128,
        challenge_period: u64,
        committee: Vec<Address>,
        threshold: u32,
    ) {
        if bond <= 0
            || challenge_period < 300
            || challenge_period > 604_800
            || threshold == 0
            || committee.len() < threshold
            || committee.len() > 20
            || threshold.saturating_mul(2) <= committee.len()
        {
            panic!("invalid event resolver configuration");
        }
        let mut unique = Vec::new(&env);
        for member in committee.iter() {
            if unique.contains(&member) {
                panic!("duplicate committee member");
            }
            unique.push_back(member);
        }
        let storage = env.storage().instance();
        storage.set(&DataKey::Token, &collateral);
        storage.set(&DataKey::Bond, &bond);
        storage.set(&DataKey::ChallengePeriod, &challenge_period);
        storage.set(&DataKey::Committee, &committee);
        storage.set(&DataKey::Threshold, &threshold);
        Self::bump(&env);
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        let storage = env.storage().instance();
        let config = Config {
            collateral: storage.get(&DataKey::Token).ok_or(Error::InvalidConfig)?,
            bond: storage.get(&DataKey::Bond).ok_or(Error::InvalidConfig)?,
            challenge_period: storage
                .get(&DataKey::ChallengePeriod)
                .ok_or(Error::InvalidConfig)?,
            committee: storage
                .get(&DataKey::Committee)
                .ok_or(Error::InvalidConfig)?,
            threshold: storage
                .get(&DataKey::Threshold)
                .ok_or(Error::InvalidConfig)?,
        };
        Self::bump(&env);
        Ok(config)
    }

    pub fn register_market(
        env: Env,
        market: Address,
        admin: Address,
        rules_hash: BytesN<32>,
    ) -> Result<(), Error> {
        admin.require_auth();
        let client = MarketClient::new(&env, &market);
        if client.resolver() != Some(env.current_contract_address()) {
            return Err(Error::WrongResolver);
        }
        if client.admin() != admin {
            return Err(Error::Unauthorized);
        }
        let key = DataKey::RulesHash(market.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyProposed);
        }
        env.storage().persistent().set(&key, &rules_hash);
        Self::bump_key(&env, &key);
        Registered { market, rules_hash }.publish(&env);
        Self::bump(&env);
        Ok(())
    }

    pub fn rules_hash(env: Env, market: Address) -> Option<BytesN<32>> {
        let key = DataKey::RulesHash(market);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_key(&env, &key);
        }
        value
    }

    pub fn proposal(env: Env, market: Address) -> Option<Proposal> {
        let key = DataKey::Proposal(market);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_key(&env, &key);
        }
        value
    }

    pub fn propose(
        env: Env,
        market: Address,
        proposer: Address,
        outcome: Outcome,
        evidence_ref: String,
        evidence_hash: BytesN<32>,
    ) -> Result<Proposal, Error> {
        proposer.require_auth();
        Self::validate_market(&env, &market)?;
        Self::validate_evidence(&env, &evidence_ref, &evidence_hash)?;
        let key = DataKey::Proposal(market.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyProposed);
        }
        let proposed_at = env.ledger().timestamp();
        let challenge_period: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ChallengePeriod)
            .ok_or(Error::InvalidConfig)?;
        let challenge_until = proposed_at
            .checked_add(challenge_period)
            .ok_or(Error::InvalidConfig)?;
        Self::collect_bond(&env, &proposer)?;
        let proposal = Proposal {
            proposer: proposer.clone(),
            outcome,
            evidence_hash: evidence_hash.clone(),
            evidence_ref: evidence_ref.clone(),
            proposed_at,
            challenge_until,
            challenger: None,
            challenged_outcome: outcome,
            challenged_evidence_hash: None,
            challenged_evidence_ref: None,
        };
        env.storage().persistent().set(&key, &proposal);
        Self::bump_key(&env, &key);
        Proposed {
            market,
            proposer,
            outcome,
            evidence_hash,
            evidence_ref,
            challenge_until,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(proposal)
    }

    pub fn challenge(
        env: Env,
        market: Address,
        challenger: Address,
        outcome: Outcome,
        evidence_ref: String,
        evidence_hash: BytesN<32>,
    ) -> Result<Proposal, Error> {
        challenger.require_auth();
        Self::validate_market(&env, &market)?;
        let key = DataKey::Proposal(market.clone());
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NoProposal)?;
        if env.ledger().timestamp() >= proposal.challenge_until {
            return Err(Error::ChallengeClosed);
        }
        if proposal.challenger.is_some() {
            return Err(Error::AlreadyChallenged);
        }
        if proposal.proposer == challenger {
            return Err(Error::SelfChallenge);
        }
        if proposal.outcome == outcome {
            return Err(Error::SameOutcome);
        }
        Self::validate_evidence(&env, &evidence_ref, &evidence_hash)?;
        Self::collect_bond(&env, &challenger)?;
        proposal.challenger = Some(challenger.clone());
        proposal.challenged_outcome = outcome;
        proposal.challenged_evidence_hash = Some(evidence_hash.clone());
        proposal.challenged_evidence_ref = Some(evidence_ref.clone());
        env.storage().persistent().set(&key, &proposal);
        Self::bump_key(&env, &key);
        Challenged {
            market,
            challenger,
            outcome,
            evidence_hash,
            evidence_ref,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(proposal)
    }

    pub fn finalize(env: Env, market: Address) -> Result<Outcome, Error> {
        Self::validate_market(&env, &market)?;
        let key = DataKey::Proposal(market.clone());
        let proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NoProposal)?;
        if env.ledger().timestamp() < proposal.challenge_until {
            return Err(Error::ChallengeClosed);
        }
        if let Some(challenger) = proposal.challenger.clone() {
            let challenge_period: u64 = env
                .storage()
                .instance()
                .get(&DataKey::ChallengePeriod)
                .ok_or(Error::InvalidConfig)?;
            let arbitration_until = proposal
                .challenge_until
                .checked_add(challenge_period)
                .ok_or(Error::InvalidConfig)?;
            if env.ledger().timestamp() < arbitration_until {
                return Err(Error::Disputed);
            }
            Self::settle_market(&env, &market, Outcome::Void)?;
            let bond = Self::bond(&env)?;
            Self::pay(&env, &proposal.proposer, bond)?;
            Self::pay(&env, &challenger, bond)?;
            Self::mark_finalized(&env, &market, Outcome::Void, true)?;
            return Ok(Outcome::Void);
        }
        Self::settle_market(&env, &market, proposal.outcome)?;
        let bond = Self::bond(&env)?;
        Self::pay(&env, &proposal.proposer, bond)?;
        Self::mark_finalized(&env, &market, proposal.outcome, false)?;
        Ok(proposal.outcome)
    }

    pub fn vote(
        env: Env,
        market: Address,
        member: Address,
        outcome: Outcome,
    ) -> Result<u32, Error> {
        Self::validate_market(&env, &market)?;
        let key = DataKey::Proposal(market.clone());
        let proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NoProposal)?;
        proposal.challenger.clone().ok_or(Error::NoProposal)?;
        Self::require_member(&env, &member)?;
        let vote_key = DataKey::Vote(market.clone(), member.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(Error::AlreadyVoted);
        }
        env.storage().persistent().set(&vote_key, &outcome);
        Self::bump_key(&env, &vote_key);
        let count_key = DataKey::VoteCount(market.clone(), outcome);
        let votes: u32 = env
            .storage()
            .persistent()
            .get(&count_key)
            .unwrap_or(0u32)
            .checked_add(1)
            .ok_or(Error::InvalidConfig)?;
        env.storage().persistent().set(&count_key, &votes);
        Self::bump_key(&env, &count_key);
        VoteCast {
            market: market.clone(),
            member,
            outcome,
            votes,
        }
        .publish(&env);
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .ok_or(Error::InvalidConfig)?;
        if votes >= threshold {
            Self::settle_dispute(&env, &market, &proposal, outcome)?;
        }
        Self::bump(&env);
        Ok(votes)
    }
}

impl EventResolver {
    fn validate_market(env: &Env, market: &Address) -> Result<(), Error> {
        if env
            .storage()
            .persistent()
            .has(&DataKey::Finalized(market.clone()))
        {
            return Err(Error::AlreadyFinalized);
        }
        if !env
            .storage()
            .persistent()
            .has(&DataKey::RulesHash(market.clone()))
        {
            return Err(Error::NotRegistered);
        }
        let client = MarketClient::new(env, market);
        if client.resolver() != Some(env.current_contract_address()) {
            return Err(Error::WrongResolver);
        }
        if client.outcome().is_some() {
            return Err(Error::AlreadyFinalized);
        }
        if env.ledger().timestamp() < client.market_info().finalize_after {
            return Err(Error::TooEarly);
        }
        Ok(())
    }

    fn collect_bond(env: &Env, from: &Address) -> Result<(), Error> {
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::InvalidConfig)?;
        token::Client::new(env, &token_address).transfer(
            from,
            &env.current_contract_address(),
            &Self::bond(env)?,
        );
        Ok(())
    }

    fn validate_evidence(
        env: &Env,
        evidence_ref: &String,
        evidence_hash: &BytesN<32>,
    ) -> Result<(), Error> {
        if evidence_ref.len() < 8 || evidence_ref.len() > 512 {
            return Err(Error::InvalidEvidence);
        }
        let computed = env.crypto().sha256(&evidence_ref.clone().to_xdr(env));
        if computed.to_array() != evidence_hash.to_array() {
            return Err(Error::InvalidEvidence);
        }
        Ok(())
    }

    fn pay(env: &Env, to: &Address, amount: i128) -> Result<(), Error> {
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::InvalidConfig)?;
        let current = env.current_contract_address();
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token_address.clone(),
                    fn_name: symbol_short!("transfer"),
                    args: (current.clone(), to.clone(), amount).into_val(env),
                },
                sub_invocations: vec![env],
            }),
        ]);
        token::Client::new(env, &token_address).transfer(&current, to, &amount);
        Ok(())
    }

    fn settle_market(env: &Env, market: &Address, outcome: Outcome) -> Result<(), Error> {
        let client = MarketClient::new(env, market);
        let current = env.current_contract_address();
        let function = if outcome == Outcome::Void {
            symbol_short!("void")
        } else {
            symbol_short!("resolve")
        };
        let args: Vec<Val> = if outcome == Outcome::Void {
            (current.clone(),).into_val(env)
        } else {
            (current.clone(), outcome).into_val(env)
        };
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: market.clone(),
                    fn_name: function,
                    args,
                },
                sub_invocations: vec![env],
            }),
        ]);
        if outcome == Outcome::Void {
            client.void(&current);
        } else {
            client.resolve(&current, &outcome);
        }
        Ok(())
    }

    fn require_member(env: &Env, member: &Address) -> Result<(), Error> {
        let committee: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Committee)
            .ok_or(Error::InvalidConfig)?;
        if !committee.contains(member) {
            return Err(Error::Unauthorized);
        }
        member.require_auth();
        Ok(())
    }

    fn settle_dispute(
        env: &Env,
        market: &Address,
        proposal: &Proposal,
        outcome: Outcome,
    ) -> Result<(), Error> {
        let challenger = proposal.challenger.clone().ok_or(Error::NoProposal)?;
        Self::settle_market(env, market, outcome)?;
        let bond = Self::bond(env)?;
        if outcome == proposal.outcome {
            Self::pay(
                env,
                &proposal.proposer,
                bond.checked_mul(2).ok_or(Error::InvalidConfig)?,
            )?;
        } else if proposal.challenged_outcome == outcome {
            Self::pay(
                env,
                &challenger,
                bond.checked_mul(2).ok_or(Error::InvalidConfig)?,
            )?;
        } else {
            Self::pay(env, &proposal.proposer, bond)?;
            Self::pay(env, &challenger, bond)?;
        }
        Self::mark_finalized(env, market, outcome, true)
    }

    fn mark_finalized(
        env: &Env,
        market: &Address,
        outcome: Outcome,
        disputed: bool,
    ) -> Result<(), Error> {
        let key = DataKey::Finalized(market.clone());
        env.storage().persistent().set(&key, &true);
        Self::bump_key(env, &key);
        Finalized {
            market: market.clone(),
            outcome,
            disputed,
        }
        .publish(env);
        Self::bump(env);
        Ok(())
    }

    fn bond(env: &Env) -> Result<i128, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Bond)
            .ok_or(Error::InvalidConfig)
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn bump_key(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
