use ark_bn254::Fr;

use crate::{
    Error, FieldElement, Result,
    babyjub::{canonical_field, field_bytes, little_endian_less_than},
};

const SUBGROUP_ORDER_LE: [u8; 32] = [
    241, 38, 33, 57, 220, 151, 114, 103, 10, 238, 32, 57, 184, 237, 62, 171, 11, 43, 48, 208, 182,
    8, 10, 55, 5, 52, 38, 92, 206, 137, 12, 6,
];
const SPEND_KEY_TAG: u64 = 1002;
const RATE: usize = 3;

pub fn spend_public_key(secret: [u8; 32]) -> Result<[u8; 32]> {
    if secret == [0; 32] || !little_endian_less_than(&secret, &SUBGROUP_ORDER_LE) {
        return Err(Error::InvalidDerivation);
    }
    let secret = canonical_field(secret)?;
    Ok(field_bytes(hash_fixed(&[Fr::from(SPEND_KEY_TAG), secret])))
}

pub(crate) fn hash_fields(input: &[FieldElement]) -> FieldElement {
    let fields: Vec<Fr> = input.iter().map(|field| field.0).collect();
    FieldElement::from_field(hash_fixed(&fields))
}

fn hash_fixed(input: &[Fr]) -> Fr {
    let domain = Fr::from((input.len() as u128) << 64);
    let mut state = [Fr::from(0_u64), Fr::from(0_u64), Fr::from(0_u64), domain];

    for chunk in input.chunks(RATE) {
        for (index, value) in chunk.iter().enumerate() {
            state[index] += value;
        }
        state = taceo_poseidon2::bn254::t4::permutation(&state);
    }
    state[0]
}

#[cfg(test)]
mod tests {
    use core::str::FromStr;

    use super::*;

    #[test]
    fn spend_key_matches_existing_moros_javascript_fixture() {
        let mut secret = [0_u8; 32];
        secret[0] = 201;
        let expected = Fr::from_str(
            "18992353299202376752156775177927579764501358211626385520790654541754953847100",
        )
        .unwrap();
        assert_eq!(spend_public_key(secret).unwrap(), field_bytes(expected));
    }

    #[test]
    fn spend_key_rejects_invalid_scalars() {
        assert_eq!(spend_public_key([0; 32]), Err(Error::InvalidDerivation));
        assert_eq!(
            spend_public_key(SUBGROUP_ORDER_LE),
            Err(Error::InvalidDerivation)
        );
    }
}
