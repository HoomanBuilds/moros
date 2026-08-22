use ark_ff::Zero;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::VerifyingKey;
use sha2::{Digest, Sha256};

use crate::{
    BabyJubPoint, Error, IDENTITY_VERSION, PROTOCOL_VERSION, Result, babyjub::canonical_field,
};

pub const PAYMENT_CODE_PREFIX: &str = "moros_pay_";
const PAYMENT_CODE_BODY_LENGTH: usize = 212;
const PAYMENT_CODE_LENGTH: usize = PAYMENT_CODE_BODY_LENGTH + 4;
const CHECKSUM_DOMAIN: &[u8] = b"moros/payment-code/checksum/v1";
const FINGERPRINT_DOMAIN: &[u8] = b"moros/payment-code/fingerprint/v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Network {
    Testnet = 1,
    Mainnet = 2,
}

impl TryFrom<u8> for Network {
    type Error = Error;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            1 => Ok(Self::Testnet),
            2 => Ok(Self::Mainnet),
            _ => Err(Error::UnsupportedNetwork),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaymentCodeExpectation {
    pub network: Network,
    pub vault: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentCode {
    pub protocol_version: u8,
    pub network: Network,
    pub vault: [u8; 32],
    pub identity_version: u8,
    pub diversifier: [u8; 16],
    pub spend_public_key: [u8; 32],
    pub viewing_public_key: BabyJubPoint,
    pub request_signing_public_key: [u8; 32],
}

impl PaymentCode {
    pub fn new(
        network: Network,
        vault: [u8; 32],
        diversifier: [u8; 16],
        spend_public_key: [u8; 32],
        viewing_public_key: BabyJubPoint,
        request_signing_public_key: [u8; 32],
    ) -> Result<Self> {
        let code = Self {
            protocol_version: PROTOCOL_VERSION,
            network,
            vault,
            identity_version: IDENTITY_VERSION,
            diversifier,
            spend_public_key,
            viewing_public_key,
            request_signing_public_key,
        };
        code.validate()?;
        Ok(code)
    }

    pub fn encode(&self) -> Result<String> {
        self.validate()?;
        let bytes = self.to_bytes();
        Ok(format!(
            "{PAYMENT_CODE_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(bytes)
        ))
    }

    pub fn decode(encoded: &str) -> Result<Self> {
        let payload = encoded
            .strip_prefix(PAYMENT_CODE_PREFIX)
            .ok_or(Error::InvalidPaymentCodePrefix)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| Error::InvalidPaymentCodeEncoding)?;
        if bytes.len() != PAYMENT_CODE_LENGTH {
            return Err(Error::InvalidPaymentCodeLength);
        }
        if URL_SAFE_NO_PAD.encode(&bytes) != payload {
            return Err(Error::InvalidPaymentCodeEncoding);
        }
        Self::from_bytes(&bytes)
    }

    pub fn validate_for(&self, expected: PaymentCodeExpectation) -> Result<()> {
        self.validate()?;
        if self.network != expected.network {
            return Err(Error::NetworkMismatch);
        }
        if self.vault != expected.vault {
            return Err(Error::VaultMismatch);
        }
        Ok(())
    }

    pub fn fingerprint(&self) -> Result<String> {
        self.validate()?;
        let digest = Sha256::new()
            .chain_update(FINGERPRINT_DOMAIN)
            .chain_update(self.to_bytes())
            .finalize();
        Ok(format!(
            "{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}",
            digest[0], digest[1], digest[2], digest[3], digest[4], digest[5]
        ))
    }

    pub(crate) fn canonical_bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        Ok(self.to_bytes().to_vec())
    }

    pub(crate) fn from_canonical_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != PAYMENT_CODE_LENGTH {
            return Err(Error::InvalidPaymentCodeLength);
        }
        Self::from_bytes(bytes)
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let expected_checksum = checksum(&bytes[..PAYMENT_CODE_BODY_LENGTH]);
        if bytes[PAYMENT_CODE_BODY_LENGTH..] != expected_checksum {
            return Err(Error::InvalidPaymentCodeChecksum);
        }

        let protocol_version = bytes[0];
        let network = Network::try_from(bytes[1])?;
        let identity_version = bytes[2];
        if bytes[3] != 0 {
            return Err(Error::InvalidPaymentCodeEncoding);
        }

        let vault = array(&bytes[4..36]);
        let diversifier = array(&bytes[36..52]);
        let spend_public_key = array(&bytes[52..84]);
        let viewing_x = array(&bytes[84..116]);
        let viewing_y = array(&bytes[116..148]);
        let request_signing_public_key = array(&bytes[148..180]);
        if bytes[180..PAYMENT_CODE_BODY_LENGTH]
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err(Error::InvalidPaymentCodeEncoding);
        }

        let code = Self {
            protocol_version,
            network,
            vault,
            identity_version,
            diversifier,
            spend_public_key,
            viewing_public_key: BabyJubPoint::from_le_bytes(viewing_x, viewing_y)?,
            request_signing_public_key,
        };
        code.validate()?;
        if code.to_bytes().as_slice() != bytes {
            return Err(Error::InvalidPaymentCodeEncoding);
        }
        Ok(code)
    }

    fn to_bytes(&self) -> [u8; PAYMENT_CODE_LENGTH] {
        let mut bytes = [0_u8; PAYMENT_CODE_LENGTH];
        bytes[0] = self.protocol_version;
        bytes[1] = self.network as u8;
        bytes[2] = self.identity_version;
        bytes[4..36].copy_from_slice(&self.vault);
        bytes[36..52].copy_from_slice(&self.diversifier);
        bytes[52..84].copy_from_slice(&self.spend_public_key);
        let (viewing_x, viewing_y) = self.viewing_public_key.to_le_bytes();
        bytes[84..116].copy_from_slice(&viewing_x);
        bytes[116..148].copy_from_slice(&viewing_y);
        bytes[148..180].copy_from_slice(&self.request_signing_public_key);
        let checksum = checksum(&bytes[..PAYMENT_CODE_BODY_LENGTH]);
        bytes[PAYMENT_CODE_BODY_LENGTH..].copy_from_slice(&checksum);
        bytes
    }

    fn validate(&self) -> Result<()> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(Error::UnsupportedProtocolVersion);
        }
        if self.identity_version != IDENTITY_VERSION {
            return Err(Error::UnsupportedIdentityVersion);
        }
        if self.vault == [0; 32] || self.diversifier == [0; 16] {
            return Err(Error::InvalidPaymentCodeEncoding);
        }
        if canonical_field(self.spend_public_key)?.is_zero() {
            return Err(Error::InvalidPaymentCodeEncoding);
        }
        let signing_key = VerifyingKey::from_bytes(&self.request_signing_public_key)
            .map_err(|_| Error::InvalidPaymentCodeEncoding)?;
        if signing_key.is_weak() {
            return Err(Error::InvalidPaymentCodeEncoding);
        }
        let (x, y) = self.viewing_public_key.to_le_bytes();
        BabyJubPoint::from_le_bytes(x, y)?;
        Ok(())
    }
}

fn checksum(bytes: &[u8]) -> [u8; 4] {
    let first = Sha256::new()
        .chain_update(CHECKSUM_DOMAIN)
        .chain_update(bytes)
        .finalize();
    let second = Sha256::digest(first);
    [second[0], second[1], second[2], second[3]]
}

fn array<const LENGTH: usize>(bytes: &[u8]) -> [u8; LENGTH] {
    bytes.try_into().expect("checked payment code layout")
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::SigningKey;

    use super::*;

    fn fixture() -> PaymentCode {
        let mut viewing_secret = [0_u8; 32];
        viewing_secret[0] = 11;
        let signing = SigningKey::from_bytes(&[9; 32]);
        let mut spend = [0_u8; 32];
        spend[0] = 7;
        PaymentCode::new(
            Network::Testnet,
            [3; 32],
            [4; 16],
            spend,
            BabyJubPoint::from_secret_le(viewing_secret).unwrap(),
            signing.verifying_key().to_bytes(),
        )
        .unwrap()
    }

    #[test]
    fn payment_code_round_trip_is_canonical() {
        let code = fixture();
        let encoded = code.encode().unwrap();
        assert!(encoded.starts_with(PAYMENT_CODE_PREFIX));
        assert_eq!(PaymentCode::decode(&encoded).unwrap(), code);
        assert_eq!(
            PaymentCode::decode(&encoded).unwrap().encode().unwrap(),
            encoded
        );
        assert_eq!(code.fingerprint().unwrap().len(), 14);
    }

    #[test]
    fn rejects_checksum_reserved_bytes_and_trailing_data() {
        let code = fixture();
        let mut bytes = code.to_bytes().to_vec();
        bytes[10] ^= 1;
        let encoded = format!("{PAYMENT_CODE_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes));
        assert_eq!(
            PaymentCode::decode(&encoded),
            Err(Error::InvalidPaymentCodeChecksum)
        );

        let mut bytes = code.to_bytes();
        bytes[181] = 1;
        let checksum = checksum(&bytes[..PAYMENT_CODE_BODY_LENGTH]);
        bytes[PAYMENT_CODE_BODY_LENGTH..].copy_from_slice(&checksum);
        let encoded = format!("{PAYMENT_CODE_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes));
        assert_eq!(
            PaymentCode::decode(&encoded),
            Err(Error::InvalidPaymentCodeEncoding)
        );

        let encoded = format!("{}A", code.encode().unwrap());
        assert!(PaymentCode::decode(&encoded).is_err());
    }

    #[test]
    fn validates_network_and_vault() {
        let code = fixture();
        code.validate_for(PaymentCodeExpectation {
            network: Network::Testnet,
            vault: [3; 32],
        })
        .unwrap();
        assert_eq!(
            code.validate_for(PaymentCodeExpectation {
                network: Network::Mainnet,
                vault: [3; 32],
            }),
            Err(Error::NetworkMismatch)
        );
        assert_eq!(
            code.validate_for(PaymentCodeExpectation {
                network: Network::Testnet,
                vault: [8; 32],
            }),
            Err(Error::VaultMismatch)
        );
    }
}
