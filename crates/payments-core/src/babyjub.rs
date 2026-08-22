use core::str::FromStr;

use ark_bn254::Fr;
use ark_ff::{BigInteger, Field, One, PrimeField, Zero};

use crate::{Error, Result};

const SUBGROUP_ORDER_LE: [u8; 32] = [
    241, 38, 33, 57, 220, 151, 114, 103, 10, 238, 32, 57, 184, 237, 62, 171, 11, 43, 48, 208, 182,
    8, 10, 55, 5, 52, 38, 92, 206, 137, 12, 6,
];
const BASE8_X: &str =
    "5299619240641551281634865583518297030282874472190772894086521144482721001553";
const BASE8_Y: &str =
    "16950150798460657717958625567821834550301663161624707787222815936182638968203";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BabyJubPoint {
    x: Fr,
    y: Fr,
}

impl BabyJubPoint {
    pub fn from_le_bytes(x: [u8; 32], y: [u8; 32]) -> Result<Self> {
        let x_field = canonical_field(x)?;
        let y_field = canonical_field(y)?;
        let point = Self {
            x: x_field,
            y: y_field,
        };
        if !point.is_on_curve() {
            return Err(Error::InvalidPoint);
        }
        if point.is_identity() || !point.is_prime_subgroup() {
            return Err(Error::LowOrderPoint);
        }
        Ok(point)
    }

    pub fn from_secret_le(secret: [u8; 32]) -> Result<Self> {
        if secret == [0; 32] || !little_endian_less_than(&secret, &SUBGROUP_ORDER_LE) {
            return Err(Error::InvalidDerivation);
        }
        Self::base8().multiply(&secret)
    }

    pub fn to_le_bytes(self) -> ([u8; 32], [u8; 32]) {
        (field_bytes(self.x), field_bytes(self.y))
    }

    pub(crate) fn multiply_scalar(self, scalar: [u8; 32]) -> Result<Self> {
        if scalar == [0; 32] || !little_endian_less_than(&scalar, &SUBGROUP_ORDER_LE) {
            return Err(Error::InvalidDerivation);
        }
        self.multiply(&scalar)
    }

    pub(crate) fn multiply_small(self, scalar: u8) -> Result<Self> {
        let mut bytes = [0_u8; 32];
        bytes[0] = scalar;
        self.multiply(&bytes)
    }

    fn base8() -> Self {
        Self {
            x: Fr::from_str(BASE8_X).expect("valid BabyJub Base8 x"),
            y: Fr::from_str(BASE8_Y).expect("valid BabyJub Base8 y"),
        }
    }

    fn identity() -> Self {
        Self {
            x: Fr::zero(),
            y: Fr::one(),
        }
    }

    fn is_identity(self) -> bool {
        self == Self::identity()
    }

    fn is_on_curve(self) -> bool {
        let a = Fr::from(168700_u64);
        let d = Fr::from(168696_u64);
        let x_squared = self.x.square();
        let y_squared = self.y.square();
        a * x_squared + y_squared == Fr::one() + d * x_squared * y_squared
    }

    fn is_prime_subgroup(self) -> bool {
        self.multiply_unchecked(&SUBGROUP_ORDER_LE)
            .is_some_and(Self::is_identity)
    }

    fn multiply(self, scalar: &[u8; 32]) -> Result<Self> {
        let result = self.multiply_unchecked(scalar).ok_or(Error::InvalidPoint)?;
        if result.is_identity() {
            return Err(Error::LowOrderPoint);
        }
        Ok(result)
    }

    fn multiply_unchecked(self, scalar: &[u8; 32]) -> Option<Self> {
        let mut result = Self::identity();
        let mut addend = self;
        for byte in scalar {
            let mut bits = *byte;
            for _ in 0..8 {
                if bits & 1 == 1 {
                    result = result.add(addend)?;
                }
                addend = addend.add(addend)?;
                bits >>= 1;
            }
        }
        Some(result)
    }

    fn add(self, other: Self) -> Option<Self> {
        let a = Fr::from(168700_u64);
        let d = Fr::from(168696_u64);
        let product = self.x * other.x * self.y * other.y;
        let x_denominator = (Fr::one() + d * product).inverse()?;
        let y_denominator = (Fr::one() - d * product).inverse()?;
        Some(Self {
            x: (self.x * other.y + self.y * other.x) * x_denominator,
            y: (self.y * other.y - a * self.x * other.x) * y_denominator,
        })
    }
}

pub(crate) fn canonical_field(bytes: [u8; 32]) -> Result<Fr> {
    let field = Fr::from_le_bytes_mod_order(&bytes);
    if field_bytes(field) != bytes {
        return Err(Error::InvalidPoint);
    }
    Ok(field)
}

pub(crate) fn little_endian_less_than(left: &[u8; 32], right: &[u8; 32]) -> bool {
    for index in (0..32).rev() {
        match left[index].cmp(&right[index]) {
            core::cmp::Ordering::Less => return true,
            core::cmp::Ordering::Greater => return false,
            core::cmp::Ordering::Equal => {}
        }
    }
    false
}

pub(crate) fn field_bytes(field: Fr) -> [u8; 32] {
    let bytes = field.into_bigint().to_bytes_le();
    let mut output = [0_u8; 32];
    output[..bytes.len()].copy_from_slice(&bytes);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base8_matches_existing_moros_fixture() {
        let secret = {
            let mut value = [0_u8; 32];
            value[0] = 1;
            value
        };
        assert_eq!(
            BabyJubPoint::from_secret_le(secret).unwrap(),
            BabyJubPoint::base8()
        );
    }

    #[test]
    fn point_round_trip_is_canonical() {
        let mut secret = [0_u8; 32];
        secret[0] = 201;
        let point = BabyJubPoint::from_secret_le(secret).unwrap();
        let (x, y) = point.to_le_bytes();
        assert_eq!(BabyJubPoint::from_le_bytes(x, y).unwrap(), point);
    }

    #[test]
    fn rejects_identity_and_noncanonical_coordinates() {
        let mut one = [0_u8; 32];
        one[0] = 1;
        assert_eq!(
            BabyJubPoint::from_le_bytes([0; 32], one),
            Err(Error::LowOrderPoint)
        );
        assert_eq!(
            BabyJubPoint::from_le_bytes([255; 32], one),
            Err(Error::InvalidPoint)
        );
    }

    #[test]
    fn rejects_zero_and_out_of_range_secrets() {
        assert_eq!(
            BabyJubPoint::from_secret_le([0; 32]),
            Err(Error::InvalidDerivation)
        );
        assert_eq!(
            BabyJubPoint::from_secret_le(SUBGROUP_ORDER_LE),
            Err(Error::InvalidDerivation)
        );
    }
}
