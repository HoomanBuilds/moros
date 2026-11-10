use soroban_poseidon::poseidon2_hash;
use soroban_sdk::crypto::bn254::Bn254Fr;
use soroban_sdk::{
    contracterror, contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec, U256,
};

pub const OUTPUT_ENVELOPE_FIELDS: u32 = 15;

pub const OUTPUT_ENVELOPE_LENGTH: u32 = OUTPUT_ENVELOPE_FIELDS * 32;

pub const OUTPUT_ENVELOPE_VERSION: u32 = 1;

pub const OUTPUT_ENVELOPE_HASH_TAG: u32 = 1008;

pub const MERKLE_NODE_HASH_TAG: u32 = 1005;

const BN254_SCALAR_MODULUS: [u8; 32] = [
    48, 100, 78, 114, 225, 49, 160, 41, 184, 80, 69, 182, 129, 129, 88, 93, 40, 51, 232, 72, 121,
    185, 112, 145, 67, 225, 245, 147, 240, 0, 0, 1,
];

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationKeyBytes {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SignalError {
    InvalidShape = 1,
    NonCanonicalField = 2,
    MalformedProof = 4,
}

pub fn scalar_modulus(env: &Env) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &BN254_SCALAR_MODULUS))
}

pub fn is_canonical_field(env: &Env, value: &U256) -> bool {
    value < &scalar_modulus(env)
}

pub fn output_envelope_fields(env: &Env, envelope: &Bytes) -> Result<Vec<U256>, SignalError> {
    if envelope.len() != OUTPUT_ENVELOPE_LENGTH {
        return Err(SignalError::InvalidShape);
    }
    let mut fields = Vec::new(env);
    for index in 0..OUTPUT_ENVELOPE_FIELDS {
        let start = index * 32;
        let value: BytesN<32> = envelope
            .slice(start..start + 32)
            .try_into()
            .map_err(|_| SignalError::InvalidShape)?;
        let field = U256::from_be_bytes(env, &Bytes::from(value));
        push_field(env, &mut fields, &field)?;
    }
    if fields.get(0) != Some(U256::from_u32(env, OUTPUT_ENVELOPE_VERSION)) {
        return Err(SignalError::InvalidShape);
    }
    Ok(fields)
}

pub fn output_envelope_hash(env: &Env, envelope: &Bytes) -> Result<U256, SignalError> {
    let fields = output_envelope_fields(env, envelope)?;
    let mut preimage = Vec::new(env);
    preimage.push_back(U256::from_u32(env, OUTPUT_ENVELOPE_HASH_TAG));
    for field in fields.iter() {
        preimage.push_back(field);
    }
    Ok(poseidon2_hash::<4, Bn254Fr>(env, &preimage))
}

pub fn tagged_poseidon2_hash(env: &Env, tag: u32, fields: &Vec<U256>) -> Result<U256, SignalError> {
    let mut preimage = Vec::new(env);
    preimage.push_back(U256::from_u32(env, tag));
    for field in fields.iter() {
        push_field(env, &mut preimage, &field)?;
    }
    Ok(poseidon2_hash::<4, Bn254Fr>(env, &preimage))
}

pub fn merkle_node(env: &Env, left: &U256, right: &U256) -> Result<U256, SignalError> {
    tagged_poseidon2_hash(
        env,
        MERKLE_NODE_HASH_TAG,
        &Vec::from_array(env, [left.clone(), right.clone()]),
    )
}

pub fn empty_merkle_root(env: &Env, levels: u32) -> U256 {
    let mut root = U256::from_u32(env, 0);
    for _ in 0..levels {
        root = merkle_node(env, &root, &root).unwrap();
    }
    root
}

pub fn is_valid_babyjub_encryption_point(env: &Env, x: &U256, y: &U256) -> bool {
    if !is_canonical_field(env, x) || !is_canonical_field(env, y) {
        return false;
    }
    let bn = env.crypto().bn254();
    let a = Bn254Fr::from_u256(U256::from_u32(env, 168_700));
    let d = Bn254Fr::from_u256(U256::from_u32(env, 168_696));
    let one = Bn254Fr::from_u256(U256::from_u32(env, 1));
    let mut point = (Bn254Fr::from_u256(x.clone()), Bn254Fr::from_u256(y.clone()));
    let x_squared = bn.fr_mul(&point.0, &point.0);
    let y_squared = bn.fr_mul(&point.1, &point.1);
    let left = bn.fr_add(&bn.fr_mul(&a, &x_squared), &y_squared);
    let right = bn.fr_add(&one, &bn.fr_mul(&d, &bn.fr_mul(&x_squared, &y_squared)));
    if left != right {
        return false;
    }
    for _ in 0..3 {
        let product = bn.fr_mul(
            &bn.fr_mul(&point.0, &point.0),
            &bn.fr_mul(&point.1, &point.1),
        );
        let x_denominator = bn.fr_add(&one, &bn.fr_mul(&d, &product));
        let y_denominator = bn.fr_sub(&one, &bn.fr_mul(&d, &product));
        if x_denominator.as_u256() == &U256::from_u32(env, 0)
            || y_denominator.as_u256() == &U256::from_u32(env, 0)
        {
            return false;
        }
        let x_numerator = bn.fr_mul(
            &Bn254Fr::from_u256(U256::from_u32(env, 2)),
            &bn.fr_mul(&point.0, &point.1),
        );
        let y_numerator = bn.fr_sub(
            &bn.fr_mul(&point.1, &point.1),
            &bn.fr_mul(&a, &bn.fr_mul(&point.0, &point.0)),
        );
        point = (
            bn.fr_mul(&x_numerator, &x_denominator.inv()),
            bn.fr_mul(&y_numerator, &y_denominator.inv()),
        );
    }
    point.0.as_u256() != &U256::from_u32(env, 0)
}

pub fn bytes32_limbs(env: &Env, value: &BytesN<32>) -> (U256, U256) {
    let bytes = value.to_array();
    let mut high = [0u8; 16];
    let mut low = [0u8; 16];
    high.copy_from_slice(&bytes[..16]);
    low.copy_from_slice(&bytes[16..]);
    (
        U256::from_u128(env, u128::from_be_bytes(high)),
        U256::from_u128(env, u128::from_be_bytes(low)),
    )
}

pub fn address_limbs(env: &Env, value: &Address) -> (U256, U256) {
    let digest: BytesN<32> = env.crypto().sha256(&value.to_xdr(env)).into();
    bytes32_limbs(env, &digest)
}

fn push_field(env: &Env, signals: &mut Vec<U256>, value: &U256) -> Result<(), SignalError> {
    if !is_canonical_field(env, value) {
        return Err(SignalError::NonCanonicalField);
    }
    signals.push_back(value.clone());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn babyjub_base(env: &Env) -> (U256, U256) {
        (
            U256::from_be_bytes(
                env,
                &Bytes::from_array(
                    env,
                    &[
                        0x0b, 0xb7, 0x7a, 0x6a, 0xd6, 0x3e, 0x73, 0x9b, 0x4e, 0xac, 0xb2, 0xe0,
                        0x9d, 0x62, 0x77, 0xc1, 0x2a, 0xb8, 0xd8, 0x01, 0x05, 0x34, 0xe0, 0xb6,
                        0x28, 0x93, 0xf3, 0xf6, 0xbb, 0x95, 0x70, 0x51,
                    ],
                ),
            ),
            U256::from_be_bytes(
                env,
                &Bytes::from_array(
                    env,
                    &[
                        0x25, 0x79, 0x72, 0x03, 0xf7, 0xa0, 0xb2, 0x49, 0x25, 0x57, 0x2e, 0x1c,
                        0xd1, 0x6b, 0xf9, 0xed, 0xfc, 0xe0, 0x05, 0x1f, 0xb9, 0xe1, 0x33, 0x77,
                        0x4b, 0x3c, 0x25, 0x7a, 0x87, 0x2d, 0x7d, 0x8b,
                    ],
                ),
            ),
        )
    }
    #[test]
    fn poseidon2_sponge_matches_the_circom_fixture() {
        let env = Env::default();
        let mut fields = Vec::new(&env);
        for value in 1..=46 {
            fields.push_back(U256::from_u32(&env, value));
        }
        let expected = U256::from_be_bytes(
            &env,
            &Bytes::from_array(
                &env,
                &[
                    22, 119, 97, 0, 240, 22, 230, 38, 170, 203, 93, 22, 146, 147, 151, 24, 127, 10,
                    243, 33, 66, 105, 169, 50, 163, 189, 185, 205, 144, 207, 243, 94,
                ],
            ),
        );
        assert_eq!(poseidon2_hash::<4, Bn254Fr>(&env, &fields), expected);
    }
    #[test]
    fn babyjub_encryption_points_reject_invalid_and_low_order_values() {
        let env = Env::default();
        let (x, y) = babyjub_base(&env);
        assert!(is_valid_babyjub_encryption_point(&env, &x, &y));
        assert!(!is_valid_babyjub_encryption_point(
            &env,
            &U256::from_u32(&env, 0),
            &U256::from_u32(&env, 1),
        ));
        assert!(!is_valid_babyjub_encryption_point(
            &env,
            &U256::from_u32(&env, 5),
            &U256::from_u32(&env, 6),
        ));
    }
    #[test]
    fn accepted_tree_empty_root_matches_the_circom_fixture() {
        let env = Env::default();
        let expected = U256::from_be_bytes(
            &env,
            &Bytes::from_array(
                &env,
                &[
                    0x25, 0x61, 0x58, 0xb7, 0x46, 0xd8, 0x43, 0x71, 0x46, 0xcb, 0xaf, 0xca, 0x04,
                    0x1c, 0xec, 0x2b, 0x79, 0x92, 0x0d, 0x28, 0x1a, 0x1c, 0xeb, 0x4f, 0xf7, 0xda,
                    0x54, 0x4b, 0x2d, 0xef, 0xae, 0x9d,
                ],
            ),
        );
        assert_eq!(empty_merkle_root(&env, 6), expected);
    }
    #[test]
    fn output_envelope_hash_matches_the_typescript_fixture() {
        let env = Env::default();
        let mut envelope = Bytes::new(&env);
        for value in 1..=OUTPUT_ENVELOPE_FIELDS {
            envelope.append(&U256::from_u32(&env, value).to_be_bytes());
        }
        let expected = U256::from_be_bytes(
            &env,
            &Bytes::from_array(
                &env,
                &[
                    17, 31, 117, 18, 203, 191, 250, 139, 52, 131, 61, 124, 8, 107, 107, 247, 36,
                    149, 83, 33, 114, 128, 7, 189, 162, 140, 110, 82, 181, 244, 78, 87,
                ],
            ),
        );
        assert_eq!(output_envelope_hash(&env, &envelope), Ok(expected));

        envelope.set(31, 2);
        assert_eq!(
            output_envelope_hash(&env, &envelope),
            Err(SignalError::InvalidShape)
        );
    }
}
