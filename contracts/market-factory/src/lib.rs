#![no_std]

use privacy_types::is_valid_babyjub_encryption_point;
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, symbol_short, token, xdr::ToXdr, Address, BytesN, Env, Symbol, Vec, U256,
};

#[cfg(test)]
mod test;

const MAX_ALLOWED_ASSETS: u32 = 64;
const MAX_LIQUIDITY_TIERS: u32 = 8;
const MAX_PRIVATE_BATCH_SIZE: u32 = 8;
const MAX_USDC_AMOUNT: i128 = 1_000_000_000_000_000_000;
const MAX_LOT_SIZE: i128 = 1i128 << 60;
const FIXED_SCALE: i128 = 1i128 << 32;
const LN2_FIXED: i128 = 2_977_044_472;
const USDC_DECIMALS: u32 = 7;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalPhase {
    Proposed,
    Funding,
    Ready,
    Active,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LiquidityPhase {
    Funding,
    Ready,
    Active,
    Cancelled,
    Settled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FactoryConfig {
    pub governance: Address,
    pub collateral: Address,
    pub shared_vault: Address,
    pub resolver: Address,
    pub network_domain: BytesN<32>,
    pub market_wasm_hash: BytesN<32>,
    pub liquidity_wasm_hash: BytesN<32>,
    pub allowed_assets: Vec<Symbol>,
    pub liquidity_tiers: Vec<i128>,
    pub minimum_funding_window: u64,
    pub minimum_open_window: u64,
    pub maximum_market_duration: u64,
    pub batch_grace: u64,
    pub epoch_duration: u64,
    pub refund_delay: u64,
    pub committee_epoch: u64,
    pub committee_config_hash: BytesN<32>,
    pub committee_public_key_x: U256,
    pub committee_public_key_y: U256,
    pub maximum_fee_bps: u32,
    pub lp_fee_share_bps: u32,
    pub fixed_batch_size: u32,
    pub minimum_side_count: u32,
    pub maximum_price_movement: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalRequest {
    pub creator: Address,
    pub nonce: BytesN<32>,
    pub asset: Symbol,
    pub threshold: i128,
    pub rules_hash: BytesN<32>,
    pub metadata_hash: BytesN<32>,
    pub funding_deadline: u64,
    pub activation_cutoff: u64,
    pub expiry: u64,
    pub liquidity_target: i128,
    pub lot_size: i128,
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalPreimage {
    pub factory: Address,
    pub network_domain: BytesN<32>,
    pub collateral: Address,
    pub shared_vault: Address,
    pub resolver: Address,
    pub market_wasm_hash: BytesN<32>,
    pub liquidity_wasm_hash: BytesN<32>,
    pub batch_grace: u64,
    pub epoch_duration: u64,
    pub refund_delay: u64,
    pub committee_epoch: u64,
    pub committee_config_hash: BytesN<32>,
    pub committee_public_key_x: U256,
    pub committee_public_key_y: U256,
    pub lp_fee_share_bps: u32,
    pub fixed_batch_size: u32,
    pub minimum_side_count: u32,
    pub maximum_price_movement: i128,
    pub request: ProposalRequest,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub proposal_id: BytesN<32>,
    pub creator: Address,
    pub asset: Symbol,
    pub threshold: i128,
    pub rules_hash: BytesN<32>,
    pub metadata_hash: BytesN<32>,
    pub funding_deadline: u64,
    pub activation_cutoff: u64,
    pub expiry: u64,
    pub liquidity_target: i128,
    pub lot_size: i128,
    pub fee_bps: u32,
    pub liquidity_vault: Option<Address>,
    pub market: Option<Address>,
    pub phase: ProposalPhase,
    pub state_version: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityInfo {
    pub token: Address,
    pub factory: Address,
    pub share_controller: Address,
    pub proposal_id: BytesN<32>,
    pub target_assets: i128,
    pub funded_assets: i128,
    pub total_shares: i128,
    pub locked_shares: i128,
    pub terminal_assets: i128,
    pub funding_deadline: u64,
    pub activation_cutoff: u64,
    pub decimals: u32,
    pub phase: LiquidityPhase,
    pub market: Option<Address>,
    pub state_version: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivateMarketConfig {
    pub batcher: Address,
    pub liquidity_vault: Address,
    pub resolver: Address,
    pub rules_hash: BytesN<32>,
    pub funding: i128,
    pub fee_bps: u32,
    pub lp_fee_share_bps: u32,
    pub lot_size: i128,
    pub fixed_batch_size: u32,
    pub minimum_side_count: u32,
    pub maximum_price_movement: i128,
}

#[contractclient(crate_path = "soroban_sdk", name = "LiquidityVaultClient")]
pub trait LiquidityVault {
    fn info(env: Env) -> LiquidityInfo;
    fn cancel(env: Env, expected_version: u64);
    fn activate(env: Env, factory: Address, market: Address, expected_version: u64) -> i128;
}

#[contractclient(crate_path = "soroban_sdk", name = "MarketClient")]
pub trait Market {
    fn activate_private(env: Env, factory: Address, config: PrivateMarketConfig);
    fn batcher(env: Env) -> Option<Address>;
    fn collateral(env: Env) -> Address;
    fn private_config(env: Env) -> Option<PrivateMarketConfig>;
    fn resolver(env: Env) -> Option<Address>;
}

#[contractclient(crate_path = "soroban_sdk", name = "SharedVaultClient")]
pub trait SharedVault {
    fn register_market(
        env: Env,
        factory: Address,
        market: Address,
        epoch_duration: u64,
        refund_delay: u64,
        committee_epoch: u64,
        committee_config_hash: BytesN<32>,
        committee_public_key_x: U256,
        committee_public_key_y: U256,
    );
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Proposal(BytesN<32>),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidConfiguration = 1,
    InvalidProposal = 2,
    UnsupportedAsset = 3,
    UnsupportedLiquidity = 4,
    DuplicateProposal = 5,
    ProposalNotFound = 6,
    InvalidPhase = 7,
    DeadlinePassed = 8,
    TooEarly = 9,
    StaleState = 10,
    DeploymentMismatch = 11,
    Arithmetic = 12,
}

#[contractevent(topics = ["market_proposed"], data_format = "vec")]
pub struct MarketProposed {
    #[topic]
    pub proposal_id: BytesN<32>,
    pub creator: Address,
    pub asset: Symbol,
    pub expiry: u64,
    pub liquidity_target: i128,
}

#[contractevent(topics = ["liquidity_deployed"], data_format = "vec")]
pub struct LiquidityDeployed {
    #[topic]
    pub proposal_id: BytesN<32>,
    pub liquidity_vault: Address,
    pub state_version: u64,
}

#[contractevent(topics = ["proposal_phase"], data_format = "vec")]
pub struct ProposalPhaseChanged {
    #[topic]
    pub proposal_id: BytesN<32>,
    pub phase: ProposalPhase,
    pub state_version: u64,
}

#[contractevent(topics = ["market_activated"], data_format = "vec")]
pub struct MarketActivated {
    #[topic]
    pub proposal_id: BytesN<32>,
    pub market: Address,
    pub liquidity_vault: Address,
    pub liquidity_parameter: i128,
    pub state_version: u64,
}

#[contract]
pub struct MarketFactory;

#[contractimpl]
impl MarketFactory {
    pub fn __constructor(env: Env, config: FactoryConfig) {
        if token::Client::new(&env, &config.collateral).decimals() != USDC_DECIMALS
            || Self::is_zero(&config.network_domain)
            || Self::is_zero(&config.market_wasm_hash)
            || Self::is_zero(&config.liquidity_wasm_hash)
            || config.allowed_assets.is_empty()
            || config.allowed_assets.len() > MAX_ALLOWED_ASSETS
            || config.liquidity_tiers.is_empty()
            || config.liquidity_tiers.len() > MAX_LIQUIDITY_TIERS
            || config.minimum_funding_window == 0
            || config.minimum_open_window == 0
            || config.maximum_market_duration <= config.minimum_open_window
            || config.batch_grace > config.minimum_open_window
            || config.batch_grace > 86_400
            || config.epoch_duration == 0
            || config.refund_delay == 0
            || config.refund_delay > config.batch_grace
            || config
                .epoch_duration
                .checked_add(config.refund_delay)
                .is_none_or(|duration| duration > 86_400)
            || config.committee_epoch == 0
            || Self::is_zero(&config.committee_config_hash)
            || !is_valid_babyjub_encryption_point(
                &env,
                &config.committee_public_key_x,
                &config.committee_public_key_y,
            )
            || config.maximum_fee_bps > 1_000
            || config.lp_fee_share_bps > 10_000
            || config.fixed_batch_size < 8
            || config.fixed_batch_size > MAX_PRIVATE_BATCH_SIZE
            || config.minimum_side_count < 2
            || config
                .minimum_side_count
                .checked_mul(2)
                .is_none_or(|count| count > config.fixed_batch_size)
            || config.maximum_price_movement <= 0
            || config.maximum_price_movement > FIXED_SCALE
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        for i in 0..config.allowed_assets.len() {
            for prior in 0..i {
                if config.allowed_assets.get(i) == config.allowed_assets.get(prior) {
                    panic_with_error!(&env, Error::InvalidConfiguration);
                }
            }
        }
        for i in 0..config.liquidity_tiers.len() {
            let tier = config.liquidity_tiers.get(i).unwrap();
            if tier <= 0 || tier > MAX_USDC_AMOUNT {
                panic_with_error!(&env, Error::InvalidConfiguration);
            }
            for prior in 0..i {
                if config.liquidity_tiers.get(prior) == Some(tier) {
                    panic_with_error!(&env, Error::InvalidConfiguration);
                }
            }
        }
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump(&env);
    }

    pub fn config(env: Env) -> FactoryConfig {
        Self::bump(&env);
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn extend_ttl(env: Env) {
        Self::bump(&env);
    }

    pub fn proposal_id(env: Env, request: ProposalRequest) -> BytesN<32> {
        let config = Self::config(env.clone());
        Self::validate_request(&env, &config, &request);
        Self::derive_id(&env, &config, request)
    }

    pub fn propose(env: Env, request: ProposalRequest) -> BytesN<32> {
        request.creator.require_auth();
        let config = Self::config(env.clone());
        Self::validate_request(&env, &config, &request);
        let proposal_id = Self::derive_id(&env, &config, request.clone());
        let key = DataKey::Proposal(proposal_id.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::DuplicateProposal);
        }
        let proposal = Proposal {
            proposal_id: proposal_id.clone(),
            creator: request.creator.clone(),
            asset: request.asset.clone(),
            threshold: request.threshold,
            rules_hash: request.rules_hash,
            metadata_hash: request.metadata_hash,
            funding_deadline: request.funding_deadline,
            activation_cutoff: request.activation_cutoff,
            expiry: request.expiry,
            liquidity_target: request.liquidity_target,
            lot_size: request.lot_size,
            fee_bps: request.fee_bps,
            liquidity_vault: None,
            market: None,
            phase: ProposalPhase::Proposed,
            state_version: 0,
        };
        env.storage().persistent().set(&key, &proposal);
        Self::bump_key(&env, &key);
        MarketProposed {
            proposal_id: proposal_id.clone(),
            creator: request.creator,
            asset: request.asset,
            expiry: request.expiry,
            liquidity_target: request.liquidity_target,
        }
        .publish(&env);
        proposal_id
    }

    pub fn liquidity_address(env: Env, proposal_id: BytesN<32>) -> Address {
        env.deployer()
            .with_current_contract(proposal_id)
            .deployed_address()
    }

    pub fn market_address(env: Env, proposal_id: BytesN<32>) -> Address {
        env.deployer()
            .with_current_contract(Self::market_salt(&env, &proposal_id))
            .deployed_address()
    }

    pub fn liquidity_parameter(env: Env, target_assets: i128) -> i128 {
        Self::derive_liquidity_parameter(&env, target_assets)
    }

    pub fn deploy_liquidity(env: Env, proposal_id: BytesN<32>, expected_version: u64) -> Address {
        let key = DataKey::Proposal(proposal_id.clone());
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ProposalNotFound));
        if proposal.phase != ProposalPhase::Proposed {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        if proposal.state_version != expected_version {
            panic_with_error!(&env, Error::StaleState);
        }
        if env.ledger().timestamp() > proposal.funding_deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }
        let config = Self::config(env.clone());
        let address = env
            .deployer()
            .with_current_contract(proposal_id.clone())
            .deploy_v2(
                config.liquidity_wasm_hash,
                (
                    config.collateral,
                    env.current_contract_address(),
                    config.shared_vault,
                    proposal_id.clone(),
                    proposal.liquidity_target,
                    proposal.funding_deadline,
                    proposal.activation_cutoff,
                    USDC_DECIMALS,
                ),
            );
        let expected = Self::liquidity_address(env.clone(), proposal_id.clone());
        if address != expected {
            panic_with_error!(&env, Error::DeploymentMismatch);
        }
        proposal.liquidity_vault = Some(address.clone());
        proposal.phase = ProposalPhase::Funding;
        proposal.state_version = proposal
            .state_version
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        env.storage().persistent().set(&key, &proposal);
        Self::bump_key(&env, &key);
        LiquidityDeployed {
            proposal_id,
            liquidity_vault: address.clone(),
            state_version: proposal.state_version,
        }
        .publish(&env);
        address
    }

    pub fn sync_funding(env: Env, proposal_id: BytesN<32>, expected_version: u64) -> ProposalPhase {
        let key = DataKey::Proposal(proposal_id.clone());
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ProposalNotFound));
        if proposal.phase != ProposalPhase::Funding || proposal.state_version != expected_version {
            panic_with_error!(&env, Error::StaleState);
        }
        let liquidity = proposal
            .liquidity_vault
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, Error::DeploymentMismatch));
        let info = LiquidityVaultClient::new(&env, &liquidity).info();
        Self::validate_liquidity_info(&env, &proposal, &info);
        if info.phase != LiquidityPhase::Ready {
            return ProposalPhase::Funding;
        }
        proposal.phase = ProposalPhase::Ready;
        proposal.state_version = proposal
            .state_version
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        env.storage().persistent().set(&key, &proposal);
        Self::bump_key(&env, &key);
        ProposalPhaseChanged {
            proposal_id,
            phase: ProposalPhase::Ready,
            state_version: proposal.state_version,
        }
        .publish(&env);
        ProposalPhase::Ready
    }

    pub fn activate(
        env: Env,
        proposal_id: BytesN<32>,
        expected_version: u64,
        liquidity_version: u64,
    ) -> Address {
        let key = DataKey::Proposal(proposal_id.clone());
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ProposalNotFound));
        if proposal.phase != ProposalPhase::Ready {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        if proposal.state_version != expected_version {
            panic_with_error!(&env, Error::StaleState);
        }
        if env.ledger().timestamp() > proposal.activation_cutoff {
            panic_with_error!(&env, Error::DeadlinePassed);
        }

        let config = Self::config(env.clone());
        Self::revalidate_activation(&env, &config, &proposal);
        let liquidity = proposal
            .liquidity_vault
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, Error::DeploymentMismatch));
        let liquidity_client = LiquidityVaultClient::new(&env, &liquidity);
        let info = liquidity_client.info();
        Self::validate_liquidity_info(&env, &proposal, &info);
        if info.state_version != liquidity_version {
            panic_with_error!(&env, Error::StaleState);
        }
        if info.phase != LiquidityPhase::Ready
            || info.funded_assets != proposal.liquidity_target
            || info.total_shares <= 0
        {
            panic_with_error!(&env, Error::InvalidPhase);
        }

        let liquidity_parameter = Self::derive_liquidity_parameter(&env, proposal.liquidity_target);
        let market_salt = Self::market_salt(&env, &proposal_id);
        let market = env.deployer().with_current_contract(market_salt).deploy_v2(
            config.market_wasm_hash,
            (
                env.current_contract_address(),
                config.collateral.clone(),
                liquidity_parameter,
                proposal.asset.clone(),
                proposal.threshold,
                proposal.expiry,
                config.batch_grace,
            ),
        );
        if market != Self::market_address(env.clone(), proposal_id.clone()) {
            panic_with_error!(&env, Error::DeploymentMismatch);
        }

        let moved_assets =
            liquidity_client.activate(&env.current_contract_address(), &market, &liquidity_version);
        if moved_assets != proposal.liquidity_target {
            panic_with_error!(&env, Error::DeploymentMismatch);
        }

        let private_config = PrivateMarketConfig {
            batcher: config.shared_vault.clone(),
            liquidity_vault: liquidity.clone(),
            resolver: config.resolver.clone(),
            rules_hash: proposal.rules_hash.clone(),
            funding: moved_assets,
            fee_bps: proposal.fee_bps,
            lp_fee_share_bps: config.lp_fee_share_bps,
            lot_size: proposal.lot_size,
            fixed_batch_size: config.fixed_batch_size,
            minimum_side_count: config.minimum_side_count,
            maximum_price_movement: config.maximum_price_movement,
        };
        let market_client = MarketClient::new(&env, &market);
        market_client.activate_private(&env.current_contract_address(), &private_config);
        if market_client.collateral() != config.collateral
            || market_client.batcher() != Some(config.shared_vault.clone())
            || market_client.resolver() != Some(config.resolver)
            || market_client.private_config() != Some(private_config)
        {
            panic_with_error!(&env, Error::DeploymentMismatch);
        }
        SharedVaultClient::new(&env, &config.shared_vault).register_market(
            &env.current_contract_address(),
            &market,
            &config.epoch_duration,
            &config.refund_delay,
            &config.committee_epoch,
            &config.committee_config_hash,
            &config.committee_public_key_x,
            &config.committee_public_key_y,
        );

        proposal.market = Some(market.clone());
        proposal.phase = ProposalPhase::Active;
        proposal.state_version = proposal
            .state_version
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        env.storage().persistent().set(&key, &proposal);
        Self::bump_key(&env, &key);
        MarketActivated {
            proposal_id,
            market: market.clone(),
            liquidity_vault: liquidity,
            liquidity_parameter,
            state_version: proposal.state_version,
        }
        .publish(&env);
        market
    }

    pub fn cancel(
        env: Env,
        proposal_id: BytesN<32>,
        expected_version: u64,
        liquidity_version: u64,
    ) {
        let key = DataKey::Proposal(proposal_id.clone());
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ProposalNotFound));
        if proposal.state_version != expected_version {
            panic_with_error!(&env, Error::StaleState);
        }
        if proposal.phase == ProposalPhase::Proposed {
            if env.ledger().timestamp() <= proposal.funding_deadline {
                panic_with_error!(&env, Error::TooEarly);
            }
        } else if proposal.phase == ProposalPhase::Funding || proposal.phase == ProposalPhase::Ready
        {
            let liquidity = proposal
                .liquidity_vault
                .clone()
                .unwrap_or_else(|| panic_with_error!(&env, Error::DeploymentMismatch));
            LiquidityVaultClient::new(&env, &liquidity).cancel(&liquidity_version);
        } else {
            panic_with_error!(&env, Error::InvalidPhase);
        }
        proposal.phase = ProposalPhase::Cancelled;
        proposal.state_version = proposal
            .state_version
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Arithmetic));
        env.storage().persistent().set(&key, &proposal);
        Self::bump_key(&env, &key);
        ProposalPhaseChanged {
            proposal_id,
            phase: ProposalPhase::Cancelled,
            state_version: proposal.state_version,
        }
        .publish(&env);
    }

    pub fn proposal(env: Env, proposal_id: BytesN<32>) -> Option<Proposal> {
        let key = DataKey::Proposal(proposal_id);
        let proposal = env.storage().persistent().get(&key);
        if proposal.is_some() {
            Self::bump_key(&env, &key);
        }
        proposal
    }

    fn validate_request(env: &Env, config: &FactoryConfig, request: &ProposalRequest) {
        let now = env.ledger().timestamp();
        let latest_expiry = now
            .checked_add(config.maximum_market_duration)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        let minimum_expiry = request
            .activation_cutoff
            .checked_add(config.minimum_open_window)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        let minimum_funding_deadline = now
            .checked_add(config.minimum_funding_window)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        if request.threshold <= 0
            || request.funding_deadline < minimum_funding_deadline
            || request.activation_cutoff < request.funding_deadline
            || request.expiry < minimum_expiry
            || request.expiry > latest_expiry
            || request.lot_size <= 0
            || request.lot_size > MAX_LOT_SIZE
            || request.fee_bps > config.maximum_fee_bps
            || Self::is_zero(&request.nonce)
            || Self::is_zero(&request.rules_hash)
            || Self::is_zero(&request.metadata_hash)
        {
            panic_with_error!(env, Error::InvalidProposal);
        }
        if !config.allowed_assets.contains(&request.asset) {
            panic_with_error!(env, Error::UnsupportedAsset);
        }
        if !config.liquidity_tiers.contains(&request.liquidity_target) {
            panic_with_error!(env, Error::UnsupportedLiquidity);
        }
    }

    fn validate_liquidity_info(env: &Env, proposal: &Proposal, info: &LiquidityInfo) {
        let config = Self::config(env.clone());
        if info.token != config.collateral
            || info.factory != env.current_contract_address()
            || info.share_controller != config.shared_vault
            || info.proposal_id != proposal.proposal_id
            || info.target_assets != proposal.liquidity_target
            || info.funding_deadline != proposal.funding_deadline
            || info.activation_cutoff != proposal.activation_cutoff
            || info.decimals != USDC_DECIMALS
        {
            panic_with_error!(env, Error::DeploymentMismatch);
        }
    }

    fn revalidate_activation(env: &Env, config: &FactoryConfig, proposal: &Proposal) {
        let minimum_expiry = env
            .ledger()
            .timestamp()
            .checked_add(config.minimum_open_window)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        if proposal.threshold <= 0
            || proposal.expiry < minimum_expiry
            || proposal.fee_bps > config.maximum_fee_bps
            || proposal.lot_size <= 0
            || proposal.lot_size > MAX_LOT_SIZE
            || Self::is_zero(&proposal.rules_hash)
        {
            panic_with_error!(env, Error::InvalidProposal);
        }
        if !config.allowed_assets.contains(&proposal.asset) {
            panic_with_error!(env, Error::UnsupportedAsset);
        }
        if !config.liquidity_tiers.contains(&proposal.liquidity_target) {
            panic_with_error!(env, Error::UnsupportedLiquidity);
        }
    }

    fn derive_liquidity_parameter(env: &Env, target_assets: i128) -> i128 {
        if target_assets <= 0 || target_assets > MAX_USDC_AMOUNT {
            panic_with_error!(env, Error::UnsupportedLiquidity);
        }
        let numerator = target_assets
            .checked_mul(FIXED_SCALE)
            .and_then(|value| value.checked_mul(FIXED_SCALE))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        let denominator = LN2_FIXED
            .checked_mul(10i128.pow(USDC_DECIMALS))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        let mut liquidity_parameter = numerator
            .checked_div(denominator)
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
            .min(MAX_LOT_SIZE);
        if liquidity_parameter <= 0 {
            panic_with_error!(env, Error::UnsupportedLiquidity);
        }
        while Self::required_funding(env, liquidity_parameter) > target_assets {
            liquidity_parameter = liquidity_parameter
                .checked_sub(1)
                .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        }
        while liquidity_parameter < MAX_LOT_SIZE
            && Self::required_funding(env, liquidity_parameter + 1) <= target_assets
        {
            liquidity_parameter += 1;
        }
        liquidity_parameter
    }

    fn required_funding(env: &Env, liquidity_parameter: i128) -> i128 {
        let fixed_loss = liquidity_parameter
            .checked_mul(LN2_FIXED)
            .and_then(|value| value.checked_div(FIXED_SCALE))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        let scaled = fixed_loss
            .checked_mul(10i128.pow(USDC_DECIMALS))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic));
        scaled
            .checked_add(FIXED_SCALE - 1)
            .and_then(|value| value.checked_div(FIXED_SCALE))
            .unwrap_or_else(|| panic_with_error!(env, Error::Arithmetic))
    }

    fn market_salt(env: &Env, proposal_id: &BytesN<32>) -> BytesN<32> {
        env.crypto()
            .sha256(&(proposal_id.clone(), symbol_short!("market")).to_xdr(env))
            .into()
    }

    fn derive_id(env: &Env, config: &FactoryConfig, request: ProposalRequest) -> BytesN<32> {
        let preimage = ProposalPreimage {
            factory: env.current_contract_address(),
            network_domain: config.network_domain.clone(),
            collateral: config.collateral.clone(),
            shared_vault: config.shared_vault.clone(),
            resolver: config.resolver.clone(),
            market_wasm_hash: config.market_wasm_hash.clone(),
            liquidity_wasm_hash: config.liquidity_wasm_hash.clone(),
            batch_grace: config.batch_grace,
            epoch_duration: config.epoch_duration,
            refund_delay: config.refund_delay,
            committee_epoch: config.committee_epoch,
            committee_config_hash: config.committee_config_hash.clone(),
            committee_public_key_x: config.committee_public_key_x.clone(),
            committee_public_key_y: config.committee_public_key_y.clone(),
            lp_fee_share_bps: config.lp_fee_share_bps,
            fixed_batch_size: config.fixed_batch_size,
            minimum_side_count: config.minimum_side_count,
            maximum_price_movement: config.maximum_price_movement,
            request,
        };
        env.crypto().sha256(&preimage.to_xdr(env)).into()
    }

    fn is_zero(value: &BytesN<32>) -> bool {
        value.to_array().iter().all(|byte| *byte == 0)
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
