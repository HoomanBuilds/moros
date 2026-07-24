#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, Symbol, Vec,
};

#[cfg(test)]
mod test;

const MIN_DELAY: u64 = 300;
const MAX_DELAY: u64 = 1_209_600;
const MAX_INITIAL_ROUTES: u32 = 64;
const TTL_THRESHOLD: u32 = 350_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub governance: Address,
    pub delay: u64,
    pub assets: Vec<Symbol>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitialRoute {
    pub asset: Symbol,
    pub resolver: Address,
    pub risk_group: Symbol,
    pub registration_required: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolverRoute {
    pub resolver: Address,
    pub risk_group: Symbol,
    pub registration_required: bool,
    pub enabled: bool,
    pub revision: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingRoute {
    pub resolver: Address,
    pub risk_group: Symbol,
    pub registration_required: bool,
    pub enabled: bool,
    pub expected_revision: u32,
    pub execute_after: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Route(Symbol),
    Pending(Symbol),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidConfiguration = 1,
    Unauthorized = 2,
    RouteNotFound = 3,
    RouteDisabled = 4,
    PendingExists = 5,
    NoPendingRoute = 6,
    TooEarly = 7,
    StaleRevision = 8,
    Arithmetic = 9,
}

#[contractevent(topics = ["route_proposed"], data_format = "vec")]
pub struct RouteProposed {
    #[topic]
    pub asset: Symbol,
    pub resolver: Address,
    pub risk_group: Symbol,
    pub registration_required: bool,
    pub enabled: bool,
    pub expected_revision: u32,
    pub execute_after: u64,
}

#[contractevent(topics = ["route_executed"], data_format = "vec")]
pub struct RouteExecuted {
    #[topic]
    pub asset: Symbol,
    pub resolver: Address,
    pub risk_group: Symbol,
    pub registration_required: bool,
    pub enabled: bool,
    pub revision: u32,
}

#[contractevent(topics = ["route_cancelled"], data_format = "vec")]
pub struct RouteCancelled {
    #[topic]
    pub asset: Symbol,
    pub expected_revision: u32,
}

#[contract]
pub struct ResolverRegistry;

#[contractimpl]
impl ResolverRegistry {
    pub fn __constructor(
        env: Env,
        governance: Address,
        delay: u64,
        initial_routes: Vec<InitialRoute>,
    ) {
        if !(MIN_DELAY..=MAX_DELAY).contains(&delay)
            || initial_routes.is_empty()
            || initial_routes.len() > MAX_INITIAL_ROUTES
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        let mut assets = Vec::new(&env);
        for index in 0..initial_routes.len() {
            let route = initial_routes.get(index).unwrap();
            for prior in 0..index {
                if initial_routes.get(prior).unwrap().asset == route.asset {
                    panic_with_error!(&env, Error::InvalidConfiguration);
                }
            }
            assets.push_back(route.asset.clone());
            let key = DataKey::Route(route.asset);
            env.storage().persistent().set(
                &key,
                &ResolverRoute {
                    resolver: route.resolver,
                    risk_group: route.risk_group,
                    registration_required: route.registration_required,
                    enabled: true,
                    revision: 1,
                },
            );
            Self::bump_key(&env, &key);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                governance,
                delay,
                assets,
            },
        );
        Self::bump(&env);
    }

    pub fn config(env: Env) -> Config {
        Self::bump(&env);
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn route(env: Env, asset: Symbol) -> Option<ResolverRoute> {
        Self::bump(&env);
        let key = DataKey::Route(asset);
        let route = env.storage().persistent().get(&key);
        if route.is_some() {
            Self::bump_key(&env, &key);
        }
        route
    }

    pub fn active_route(env: Env, asset: Symbol) -> Result<ResolverRoute, Error> {
        let route = Self::route(env, asset).ok_or(Error::RouteNotFound)?;
        if !route.enabled {
            return Err(Error::RouteDisabled);
        }
        Ok(route)
    }

    pub fn pending_route(env: Env, asset: Symbol) -> Option<PendingRoute> {
        let key = DataKey::Pending(asset);
        let pending = env.storage().persistent().get(&key);
        if pending.is_some() {
            Self::bump_key(&env, &key);
        }
        pending
    }

    pub fn is_current(env: Env, asset: Symbol, revision: u32, resolver: Address) -> bool {
        Self::route(env, asset).is_some_and(|route| {
            route.enabled && route.revision == revision && route.resolver == resolver
        })
    }

    pub fn propose_route(
        env: Env,
        governance: Address,
        asset: Symbol,
        resolver: Address,
        risk_group: Symbol,
        registration_required: bool,
        enabled: bool,
    ) -> Result<PendingRoute, Error> {
        let config = Self::require_governance(&env, &governance)?;
        let key = DataKey::Pending(asset.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::PendingExists);
        }
        let current = Self::route(env.clone(), asset.clone());
        if current.is_none() && (!enabled || config.assets.len() >= MAX_INITIAL_ROUTES) {
            return Err(Error::InvalidConfiguration);
        }
        let expected_revision = current.map(|route| route.revision).unwrap_or(0);
        let execute_after = env
            .ledger()
            .timestamp()
            .checked_add(config.delay)
            .ok_or(Error::Arithmetic)?;
        let pending = PendingRoute {
            resolver: resolver.clone(),
            risk_group: risk_group.clone(),
            registration_required,
            enabled,
            expected_revision,
            execute_after,
        };
        env.storage().persistent().set(&key, &pending);
        Self::bump_key(&env, &key);
        RouteProposed {
            asset,
            resolver,
            risk_group,
            registration_required,
            enabled,
            expected_revision,
            execute_after,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(pending)
    }

    pub fn execute_route(env: Env, asset: Symbol) -> Result<ResolverRoute, Error> {
        let pending_key = DataKey::Pending(asset.clone());
        let pending: PendingRoute = env
            .storage()
            .persistent()
            .get(&pending_key)
            .ok_or(Error::NoPendingRoute)?;
        if env.ledger().timestamp() < pending.execute_after {
            return Err(Error::TooEarly);
        }
        let current_revision = Self::route(env.clone(), asset.clone())
            .map(|route| route.revision)
            .unwrap_or(0);
        if current_revision != pending.expected_revision {
            return Err(Error::StaleRevision);
        }
        let mut config = Self::config(env.clone());
        if current_revision == 0 && config.assets.len() >= MAX_INITIAL_ROUTES {
            return Err(Error::InvalidConfiguration);
        }
        let route = ResolverRoute {
            resolver: pending.resolver,
            risk_group: pending.risk_group,
            registration_required: pending.registration_required,
            enabled: pending.enabled,
            revision: current_revision.checked_add(1).ok_or(Error::Arithmetic)?,
        };
        let route_key = DataKey::Route(asset.clone());
        env.storage().persistent().set(&route_key, &route);
        Self::bump_key(&env, &route_key);
        if current_revision == 0 {
            config.assets.push_back(asset.clone());
            env.storage().instance().set(&DataKey::Config, &config);
        }
        env.storage().persistent().remove(&pending_key);
        RouteExecuted {
            asset,
            resolver: route.resolver.clone(),
            risk_group: route.risk_group.clone(),
            registration_required: route.registration_required,
            enabled: route.enabled,
            revision: route.revision,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(route)
    }

    pub fn cancel_route(env: Env, governance: Address, asset: Symbol) -> Result<(), Error> {
        Self::require_governance(&env, &governance)?;
        let key = DataKey::Pending(asset.clone());
        let pending: PendingRoute = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NoPendingRoute)?;
        env.storage().persistent().remove(&key);
        RouteCancelled {
            asset,
            expected_revision: pending.expected_revision,
        }
        .publish(&env);
        Self::bump(&env);
        Ok(())
    }

    pub fn extend_ttl(env: Env) {
        Self::bump(&env);
        let config = Self::config(env.clone());
        for asset in config.assets {
            for key in [DataKey::Route(asset.clone()), DataKey::Pending(asset)] {
                if env.storage().persistent().has(&key) {
                    Self::bump_key(&env, &key);
                }
            }
        }
    }
}

impl ResolverRegistry {
    fn require_governance(env: &Env, governance: &Address) -> Result<Config, Error> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::InvalidConfiguration)?;
        if *governance != config.governance {
            return Err(Error::Unauthorized);
        }
        config.governance.require_auth();
        Ok(config)
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
