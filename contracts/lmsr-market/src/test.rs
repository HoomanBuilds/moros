#![cfg(test)]
extern crate std;

use crate::{math, LmsrMarket, LmsrMarketClient};
use soroban_sdk::Env;

const S: i128 = 1 << 32; // 2^32 fixed-point scale

#[test]
fn math_matches_validated_testnet_values() {
    // 60 YES, 40 NO, b=100 -> cost 119.8139, price 0.5498.
    // These exact integers were verified on Stellar testnet.
    assert_eq!(math::cost(60 * S, 40 * S, 100 * S), 514596724500);
    assert_eq!(math::price_yes(60 * S, 40 * S, 100 * S), 2361519037);
}

#[test]
fn price_is_half_at_zero() {
    let env = Env::default();
    let client = LmsrMarketClient::new(&env, &env.register(LmsrMarket {}, ()));
    client.init(&(100 * S));
    // exp(0)/(exp(0)+exp(0)) = 0.5
    assert_eq!(client.price_yes(), S / 2);
    assert_eq!(client.get_state(), (0, 0, 100 * S));
}

#[test]
fn rejects_bad_liquidity_param() {
    let env = Env::default();
    let client = LmsrMarketClient::new(&env, &env.register(LmsrMarket {}, ()));
    // b <= 0 is invalid
    assert!(client.try_init(&0).is_err());
}
