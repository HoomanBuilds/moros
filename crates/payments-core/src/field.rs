use core::fmt;

use ark_bn254::Fr;
use ark_ff::Zero;

use crate::{
    Error, Result,
    babyjub::{canonical_field, field_bytes},
};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct FieldElement(pub(crate) Fr);

impl FieldElement {
    pub fn from_le_bytes(bytes: [u8; 32]) -> Result<Self> {
        canonical_field(bytes)
            .map(Self)
            .map_err(|_| Error::InvalidFieldElement)
    }

    pub fn from_u64(value: u64) -> Self {
        Self(Fr::from(value))
    }

    pub fn from_atomic(value: i128) -> Result<Self> {
        if value < 0 {
            return Err(Error::InvalidAmount);
        }
        Ok(Self(Fr::from(value as u128)))
    }

    pub fn to_le_bytes(self) -> [u8; 32] {
        field_bytes(self.0)
    }

    pub fn is_zero(self) -> bool {
        self.0.is_zero()
    }

    pub(crate) fn from_field(value: Fr) -> Self {
        Self(value)
    }

    pub(crate) fn to_nonnegative_i128(self) -> Result<i128> {
        let bytes = self.to_le_bytes();
        if bytes[16..].iter().any(|byte| *byte != 0) || bytes[15] & 0x80 != 0 {
            return Err(Error::InvalidAmount);
        }
        let value = i128::from_le_bytes(bytes[..16].try_into().map_err(|_| Error::InvalidAmount)?);
        Ok(value)
    }
}

impl fmt::Debug for FieldElement {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "FieldElement({})", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_encoding_is_canonical() {
        let field = FieldElement::from_u64(42);
        assert_eq!(
            FieldElement::from_le_bytes(field.to_le_bytes()).unwrap(),
            field
        );
        assert_eq!(field.to_nonnegative_i128().unwrap(), 42);
        assert_eq!(
            FieldElement::from_le_bytes([255; 32]),
            Err(Error::InvalidFieldElement)
        );
    }

    #[test]
    fn amount_conversion_accepts_zero_and_rejects_large_fields() {
        assert_eq!(FieldElement::from_u64(0).to_nonnegative_i128(), Ok(0));
        let mut too_large = [0_u8; 32];
        too_large[16] = 1;
        assert_eq!(
            FieldElement::from_le_bytes(too_large)
                .unwrap()
                .to_nonnegative_i128(),
            Err(Error::InvalidAmount)
        );
    }
}
