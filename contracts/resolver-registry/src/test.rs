extern crate std;

use crate::{InitialRoute, ResolverRegistry, ResolverRegistryClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{symbol_short, Address, Env, Vec};

fn initial_routes(env: &Env, resolver: &Address) -> Vec<InitialRoute> {
    Vec::from_array(
        env,
        [
            InitialRoute {
                asset: symbol_short!("BTC"),
                resolver: resolver.clone(),
                risk_group: symbol_short!("CRYPTO"),
                registration_required: false,
            },
            InitialRoute {
                asset: symbol_short!("SPORTS"),
                resolver: Address::generate(env),
                risk_group: symbol_short!("SPORTS"),
                registration_required: true,
            },
        ],
    )
}

fn setup() -> (Env, ResolverRegistryClient<'static>, Address, Address) {
    let env = Env::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let governance = Address::generate(&env);
    let resolver = Address::generate(&env);
    let contract = env.register(
        ResolverRegistry,
        (governance.clone(), 300u64, initial_routes(&env, &resolver)),
    );
    let env_static = std::boxed::Box::leak(std::boxed::Box::new(env.clone()));
    let contract_static = std::boxed::Box::leak(std::boxed::Box::new(contract));
    (
        env,
        ResolverRegistryClient::new(env_static, contract_static),
        governance,
        resolver,
    )
}

#[test]
fn initial_routes_are_enabled_and_revisioned() {
    let (_, client, _, resolver) = setup();
    assert_eq!(client.config().assets.len(), 2);
    let route = client.active_route(&symbol_short!("BTC"));
    assert_eq!(route.resolver, resolver);
    assert_eq!(route.risk_group, symbol_short!("CRYPTO"));
    assert_eq!(route.revision, 1);
    assert!(!route.registration_required);
    assert!(route.enabled);
}

#[test]
fn extend_ttl_preserves_all_routes() {
    let (_, client, _, _) = setup();
    let before = client.config();
    client.extend_ttl();
    assert_eq!(client.config(), before);
    assert!(client.route(&symbol_short!("BTC")).is_some());
    assert!(client.route(&symbol_short!("SPORTS")).is_some());
}

#[test]
fn governance_change_is_delayed_and_permissionless_to_execute() {
    let (env, client, governance, _) = setup();
    env.mock_all_auths();
    let replacement = Address::generate(&env);
    let pending = client.propose_route(
        &governance,
        &symbol_short!("BTC"),
        &replacement,
        &symbol_short!("CRYPTO"),
        &false,
        &true,
    );
    assert_eq!(pending.execute_after, 1_300);
    assert_eq!(env.auths().len(), 1);
    assert_eq!(env.auths()[0].0, governance);
    assert!(client.try_execute_route(&symbol_short!("BTC")).is_err());
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_300);
    let route = client.execute_route(&symbol_short!("BTC"));
    assert_eq!(route.resolver, replacement);
    assert_eq!(route.revision, 2);
    assert!(client.is_current(&symbol_short!("BTC"), &2, &route.resolver,));
    assert!(!client.is_current(&symbol_short!("BTC"), &1, &route.resolver));
}

#[test]
fn non_governance_cannot_propose_or_cancel_routes() {
    let (env, client, _, _) = setup();
    env.mock_all_auths();
    let outsider = Address::generate(&env);
    assert!(client
        .try_propose_route(
            &outsider,
            &symbol_short!("BTC"),
            &Address::generate(&env),
            &symbol_short!("CRYPTO"),
            &false,
            &true,
        )
        .is_err());
    assert!(client
        .try_cancel_route(&outsider, &symbol_short!("BTC"))
        .is_err());
}

#[test]
fn disabled_routes_are_not_active() {
    let (env, client, governance, resolver) = setup();
    env.mock_all_auths();
    client.propose_route(
        &governance,
        &symbol_short!("BTC"),
        &resolver,
        &symbol_short!("CRYPTO"),
        &false,
        &false,
    );
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_300);
    let route = client.execute_route(&symbol_short!("BTC"));
    assert!(!route.enabled);
    assert!(client.try_active_route(&symbol_short!("BTC")).is_err());
    assert!(!client.is_current(&symbol_short!("BTC"), &2, &resolver));
}

#[test]
fn pending_change_can_be_cancelled_but_not_overwritten() {
    let (env, client, governance, _) = setup();
    env.mock_all_auths();
    let replacement = Address::generate(&env);
    client.propose_route(
        &governance,
        &symbol_short!("BTC"),
        &replacement,
        &symbol_short!("CRYPTO"),
        &false,
        &true,
    );
    assert!(client
        .try_propose_route(
            &governance,
            &symbol_short!("BTC"),
            &replacement,
            &symbol_short!("CRYPTO"),
            &false,
            &true,
        )
        .is_err());
    client.cancel_route(&governance, &symbol_short!("BTC"));
    assert_eq!(client.pending_route(&symbol_short!("BTC")), None);
}

#[test]
fn new_route_cannot_start_disabled() {
    let (env, client, governance, _) = setup();
    env.mock_all_auths();
    assert!(client
        .try_propose_route(
            &governance,
            &symbol_short!("WEATHER"),
            &Address::generate(&env),
            &symbol_short!("WEATHER"),
            &true,
            &false,
        )
        .is_err());
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_duplicate_assets() {
    let env = Env::default();
    let governance = Address::generate(&env);
    let resolver = Address::generate(&env);
    let duplicate = InitialRoute {
        asset: symbol_short!("BTC"),
        resolver,
        risk_group: symbol_short!("CRYPTO"),
        registration_required: false,
    };
    env.register(
        ResolverRegistry,
        (
            governance,
            300u64,
            Vec::from_array(&env, [duplicate.clone(), duplicate]),
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_unsafe_delay() {
    let env = Env::default();
    let governance = Address::generate(&env);
    let resolver = Address::generate(&env);
    env.register(
        ResolverRegistry,
        (governance, 299u64, initial_routes(&env, &resolver)),
    );
}
