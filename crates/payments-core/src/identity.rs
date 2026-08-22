use bip39::{Language, Mnemonic};
use ed25519_dalek::{Signature, Signer, SigningKey};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{
    BabyJubPoint, Error, Network, PROTOCOL_VERSION, PaymentCode, Result,
    babyjub::little_endian_less_than,
};

const DERIVATION_SALT: &[u8] = b"moros/private-payments/master/v1";
const SUBGROUP_ORDER_LE: [u8; 32] = [
    241, 38, 33, 57, 220, 151, 114, 103, 10, 238, 32, 57, 184, 237, 62, 171, 11, 43, 48, 208, 182,
    8, 10, 55, 5, 52, 38, 92, 206, 137, 12, 6,
];

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterEntropy([u8; 32]);

impl MasterEntropy {
    pub fn from_bytes(bytes: [u8; 32]) -> Result<Self> {
        if bytes == [0; 32] {
            return Err(Error::InvalidRecoveryPhrase);
        }
        Ok(Self(bytes))
    }

    pub fn from_recovery_phrase(phrase: &str) -> Result<Self> {
        let mnemonic = Mnemonic::parse_in_normalized(Language::English, phrase)
            .map_err(|_| Error::InvalidRecoveryPhrase)?;
        let entropy = mnemonic.to_entropy();
        if entropy.len() != 32 {
            return Err(Error::InvalidRecoveryPhrase);
        }
        Self::from_bytes(
            entropy
                .as_slice()
                .try_into()
                .map_err(|_| Error::InvalidRecoveryPhrase)?,
        )
    }

    pub fn recovery_phrase(&self) -> Result<String> {
        Mnemonic::from_entropy(&self.0)
            .map(|mnemonic| mnemonic.to_string())
            .map_err(|_| Error::InvalidRecoveryPhrase)
    }

    pub fn derive_child(
        &self,
        network: Network,
        vault: [u8; 32],
        child_index: u64,
    ) -> Result<ChildIdentity> {
        if vault == [0; 32] {
            return Err(Error::InvalidDerivation);
        }

        let hkdf = Hkdf::<Sha256>::new(Some(DERIVATION_SALT), &self.0);
        let diversifier = derive_nonzero_bytes::<16>(&hkdf, network, vault, child_index, 1)?;
        let spend_secret = derive_scalar(&hkdf, network, vault, child_index, 2)?;
        let viewing_secret = derive_scalar(&hkdf, network, vault, child_index, 3)?;
        let signing_seed = derive_signing_seed(&hkdf, network, vault, child_index, 4)?;

        Ok(ChildIdentity {
            network,
            vault,
            diversifier,
            spend_secret,
            viewing_secret,
            signing_seed,
        })
    }
}

pub struct ChildIdentity {
    network: Network,
    vault: [u8; 32],
    diversifier: [u8; 16],
    spend_secret: [u8; 32],
    viewing_secret: [u8; 32],
    signing_seed: [u8; 32],
}

impl ChildIdentity {
    pub fn spend_secret_le(&self) -> [u8; 32] {
        self.spend_secret
    }

    pub fn viewing_secret_le(&self) -> [u8; 32] {
        self.viewing_secret
    }

    pub fn viewing_public_key(&self) -> Result<BabyJubPoint> {
        BabyJubPoint::from_secret_le(self.viewing_secret)
    }

    pub fn request_signing_public_key(&self) -> [u8; 32] {
        self.signing_key().verifying_key().to_bytes()
    }

    pub fn payment_code(&self) -> Result<PaymentCode> {
        PaymentCode::new(
            self.network,
            self.vault,
            self.diversifier,
            crate::spend_public_key(self.spend_secret)?,
            self.viewing_public_key()?,
            self.request_signing_public_key(),
        )
    }

    pub(crate) fn sign(&self, message: &[u8]) -> Signature {
        self.signing_key().sign(message)
    }

    fn signing_key(&self) -> SigningKey {
        SigningKey::from_bytes(&self.signing_seed)
    }
}

impl Drop for ChildIdentity {
    fn drop(&mut self) {
        self.spend_secret.zeroize();
        self.viewing_secret.zeroize();
        self.signing_seed.zeroize();
    }
}

fn derive_nonzero_bytes<const LENGTH: usize>(
    hkdf: &Hkdf<Sha256>,
    network: Network,
    vault: [u8; 32],
    child_index: u64,
    purpose: u8,
) -> Result<[u8; LENGTH]> {
    for attempt in 0..=u16::MAX {
        let candidate = derive_bytes::<LENGTH>(
            hkdf,
            network,
            vault,
            child_index,
            purpose,
            u32::from(attempt),
        )?;
        if candidate != [0; LENGTH] {
            return Ok(candidate);
        }
    }
    Err(Error::InvalidDerivation)
}

fn derive_signing_seed(
    hkdf: &Hkdf<Sha256>,
    network: Network,
    vault: [u8; 32],
    child_index: u64,
    purpose: u8,
) -> Result<[u8; 32]> {
    for attempt in 0..=u16::MAX {
        let candidate = derive_bytes::<32>(
            hkdf,
            network,
            vault,
            child_index,
            purpose,
            u32::from(attempt),
        )?;
        if !SigningKey::from_bytes(&candidate).verifying_key().is_weak() {
            return Ok(candidate);
        }
    }
    Err(Error::InvalidDerivation)
}

fn derive_scalar(
    hkdf: &Hkdf<Sha256>,
    network: Network,
    vault: [u8; 32],
    child_index: u64,
    purpose: u8,
) -> Result<[u8; 32]> {
    for attempt in 0..=u16::MAX {
        let candidate = derive_bytes::<32>(
            hkdf,
            network,
            vault,
            child_index,
            purpose,
            u32::from(attempt),
        )?;
        if candidate != [0; 32] && little_endian_less_than(&candidate, &SUBGROUP_ORDER_LE) {
            return Ok(candidate);
        }
    }
    Err(Error::InvalidDerivation)
}

fn derive_bytes<const LENGTH: usize>(
    hkdf: &Hkdf<Sha256>,
    network: Network,
    vault: [u8; 32],
    child_index: u64,
    purpose: u8,
    attempt: u32,
) -> Result<[u8; LENGTH]> {
    let mut info = [0_u8; 48];
    info[0] = PROTOCOL_VERSION;
    info[1] = network as u8;
    info[2..34].copy_from_slice(&vault);
    info[34..42].copy_from_slice(&child_index.to_be_bytes());
    info[42] = purpose;
    info[43] = LENGTH as u8;
    info[44..48].copy_from_slice(&attempt.to_be_bytes());

    let mut output = [0_u8; LENGTH];
    hkdf.expand(&info, &mut output)
        .map_err(|_| Error::InvalidDerivation)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENTROPY: [u8; 32] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
        25, 26, 27, 28, 29, 30, 31,
    ];

    #[test]
    fn recovery_phrase_round_trip_uses_24_words() {
        let entropy = MasterEntropy::from_bytes(ENTROPY).unwrap();
        let phrase = entropy.recovery_phrase().unwrap();
        assert_eq!(phrase.split_whitespace().count(), 24);
        assert_eq!(
            MasterEntropy::from_recovery_phrase(&phrase)
                .unwrap()
                .recovery_phrase()
                .unwrap(),
            phrase
        );
        assert!(MasterEntropy::from_recovery_phrase("not a recovery phrase").is_err());
    }

    #[test]
    fn derivation_is_stable_and_domain_separated() {
        let master = MasterEntropy::from_bytes(ENTROPY).unwrap();
        let first = master.derive_child(Network::Testnet, [7; 32], 0).unwrap();
        let same = master.derive_child(Network::Testnet, [7; 32], 0).unwrap();
        let next = master.derive_child(Network::Testnet, [7; 32], 1).unwrap();
        let mainnet = master.derive_child(Network::Mainnet, [7; 32], 0).unwrap();

        assert_eq!(first.spend_secret_le(), same.spend_secret_le());
        assert_eq!(first.viewing_secret_le(), same.viewing_secret_le());
        assert_ne!(first.spend_secret_le(), first.viewing_secret_le());
        assert_ne!(first.spend_secret_le(), next.spend_secret_le());
        assert_ne!(first.spend_secret_le(), mainnet.spend_secret_le());
        assert_ne!(
            first.request_signing_public_key(),
            next.request_signing_public_key()
        );
    }

    #[test]
    fn rejects_zero_vault() {
        let master = MasterEntropy::from_bytes(ENTROPY).unwrap();
        assert!(master.derive_child(Network::Testnet, [0; 32], 0).is_err());
    }

    #[test]
    fn rejects_zero_master_entropy() {
        assert!(MasterEntropy::from_bytes([0; 32]).is_err());
    }
}
