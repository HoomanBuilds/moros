use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{Error, MasterEntropy, Network, PROTOCOL_VERSION, Result};

pub const ARCHIVE_PAGE_CONTENT_BYTES: usize = 4_092;
pub const ARCHIVE_PAGE_BYTES: usize = 4_221;
pub const ACTIVITY_VIEW_PREFIX: &str = "moros_view_activity_";
const ARCHIVE_PADDED_BYTES: usize = ARCHIVE_PAGE_CONTENT_BYTES + 4;
const ARCHIVE_CIPHERTEXT_BYTES: usize = ARCHIVE_PADDED_BYTES + 16;
const ARCHIVE_VERSION: u8 = 1;
const ARCHIVE_HEADER_BYTES: usize = 1 + 8 + 8 + 4 + 24 + 32;
const ARCHIVE_SALT: &[u8] = b"moros/private-payments/archive/v1";
const ARCHIVE_PAGE_DOMAIN: &[u8] = b"moros/payment-archive/page/v1";
const SYNC_CHALLENGE_DOMAIN: &[u8] = b"moros/payment-sync/challenge/v1";
const ACTIVITY_VIEW_VERSION: u8 = 1;
const ACTIVITY_VIEW_BODY_BYTES: usize = 1 + 1 + 32 + 32 + 32 + 8;
const ACTIVITY_VIEW_BYTES: usize = ACTIVITY_VIEW_BODY_BYTES + 32;
const ACTIVITY_VIEW_CHECKSUM_DOMAIN: &[u8] = b"moros/activity-view/checksum/v1";

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct ArchiveIdentity {
    network: u8,
    vault: [u8; 32],
    locator: [u8; 32],
    signing_seed: [u8; 32],
    archive_root: [u8; 32],
}

impl ArchiveIdentity {
    pub fn derive(master: &MasterEntropy, network: Network, vault: [u8; 32]) -> Result<Self> {
        if vault == [0; 32] {
            return Err(Error::InvalidDerivation);
        }
        let hkdf = Hkdf::<Sha256>::new(Some(ARCHIVE_SALT), master.secret_bytes());
        let locator = derive(&hkdf, network, vault, 1, 0)?;
        let signing_seed = derive_signing_seed(&hkdf, network, vault)?;
        let archive_root = derive(&hkdf, network, vault, 3, 0)?;
        Ok(Self {
            network: network as u8,
            vault,
            locator,
            signing_seed,
            archive_root,
        })
    }

    pub fn locator(&self) -> [u8; 32] {
        self.locator
    }

    pub fn signing_public_key(&self) -> [u8; 32] {
        self.signing_key().verifying_key().to_bytes()
    }

    pub fn sign_challenge(&self, challenge: [u8; 32], expires_at: u64) -> [u8; 64] {
        self.signing_key()
            .sign(&challenge_message(self.locator, challenge, expires_at))
            .to_bytes()
    }

    pub fn viewing_export(&self, maximum_epoch: u64) -> Result<ActivityViewingKey> {
        if maximum_epoch == 0 {
            return Err(Error::InvalidViewingExport);
        }
        Ok(ActivityViewingKey {
            network: self.network,
            vault: self.vault,
            locator: self.locator,
            archive_root: self.archive_root,
            maximum_epoch,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn encrypt_page(
        &self,
        epoch: u64,
        generation: u64,
        page: u32,
        previous_hash: [u8; 32],
        nonce: [u8; 24],
        content: &[u8],
    ) -> Result<EncryptedArchivePage> {
        if epoch == 0 || generation == 0 || nonce == [0; 24] {
            return Err(Error::InvalidArchive);
        }
        if content.len() > ARCHIVE_PAGE_CONTENT_BYTES {
            return Err(Error::ArchiveTooLarge);
        }
        let header = archive_header(epoch, generation, page, nonce, previous_hash);
        let mut padded = [0_u8; ARCHIVE_PADDED_BYTES];
        padded[..4].copy_from_slice(&(content.len() as u32).to_be_bytes());
        padded[4..4 + content.len()].copy_from_slice(content);
        let key = self.page_key(epoch)?;
        let cipher = XChaCha20Poly1305::new((&key).into());
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &padded,
                    aad: &archive_aad(self.locator, &header),
                },
            )
            .map_err(|_| Error::InvalidArchive)?;
        let ciphertext: [u8; ARCHIVE_CIPHERTEXT_BYTES] =
            ciphertext.try_into().map_err(|_| Error::InvalidArchive)?;
        let hash = page_hash(self.locator, &header, &ciphertext);
        Ok(EncryptedArchivePage {
            epoch,
            generation,
            page,
            nonce,
            previous_hash,
            ciphertext,
            hash,
        })
    }

    pub fn decrypt_page(&self, encrypted: &EncryptedArchivePage) -> Result<Vec<u8>> {
        decrypt_page(self.locator, self.archive_root, encrypted)
    }

    fn page_key(&self, epoch: u64) -> Result<[u8; 32]> {
        page_key(self.archive_root, epoch)
    }

    fn signing_key(&self) -> SigningKey {
        SigningKey::from_bytes(&self.signing_seed)
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct ActivityViewingKey {
    network: u8,
    pub vault: [u8; 32],
    locator: [u8; 32],
    archive_root: [u8; 32],
    pub maximum_epoch: u64,
}

impl ActivityViewingKey {
    pub fn network(&self) -> Result<Network> {
        Network::try_from(self.network)
    }

    pub fn locator(&self) -> [u8; 32] {
        self.locator
    }

    pub fn decrypt_page(&self, encrypted: &EncryptedArchivePage) -> Result<Vec<u8>> {
        if encrypted.epoch > self.maximum_epoch {
            return Err(Error::InvalidViewingExport);
        }
        decrypt_page(self.locator, self.archive_root, encrypted)
    }

    pub fn encode(&self) -> String {
        let mut body = [0_u8; ACTIVITY_VIEW_BODY_BYTES];
        body[0] = ACTIVITY_VIEW_VERSION;
        body[1] = self.network;
        body[2..34].copy_from_slice(&self.vault);
        body[34..66].copy_from_slice(&self.locator);
        body[66..98].copy_from_slice(&self.archive_root);
        body[98..].copy_from_slice(&self.maximum_epoch.to_be_bytes());
        let mut encoded = [0_u8; ACTIVITY_VIEW_BYTES];
        encoded[..ACTIVITY_VIEW_BODY_BYTES].copy_from_slice(&body);
        encoded[ACTIVITY_VIEW_BODY_BYTES..].copy_from_slice(&activity_view_checksum(&body));
        format!("{ACTIVITY_VIEW_PREFIX}{}", URL_SAFE_NO_PAD.encode(encoded))
    }

    pub fn decode(encoded: &str) -> Result<Self> {
        let payload = encoded
            .strip_prefix(ACTIVITY_VIEW_PREFIX)
            .ok_or(Error::InvalidViewingExport)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| Error::InvalidViewingExport)?;
        if URL_SAFE_NO_PAD.encode(&bytes) != payload || bytes.len() != ACTIVITY_VIEW_BYTES {
            return Err(Error::InvalidViewingExport);
        }
        let body: [u8; ACTIVITY_VIEW_BODY_BYTES] = bytes[..ACTIVITY_VIEW_BODY_BYTES]
            .try_into()
            .map_err(|_| Error::InvalidViewingExport)?;
        if body[0] != ACTIVITY_VIEW_VERSION
            || activity_view_checksum(&body) != bytes[ACTIVITY_VIEW_BODY_BYTES..]
        {
            return Err(Error::InvalidViewingExport);
        }
        Network::try_from(body[1])?;
        let network = body[1];
        let vault = body[2..34].try_into().unwrap();
        let locator = body[34..66].try_into().unwrap();
        let archive_root = body[66..98].try_into().unwrap();
        let maximum_epoch = u64::from_be_bytes(body[98..].try_into().unwrap());
        if vault == [0; 32] || locator == [0; 32] || archive_root == [0; 32] || maximum_epoch == 0 {
            return Err(Error::InvalidViewingExport);
        }
        let view = Self {
            network,
            vault,
            locator,
            archive_root,
            maximum_epoch,
        };
        if view.encode() != encoded {
            return Err(Error::InvalidViewingExport);
        }
        Ok(view)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedArchivePage {
    pub epoch: u64,
    pub generation: u64,
    pub page: u32,
    pub nonce: [u8; 24],
    pub previous_hash: [u8; 32],
    pub ciphertext: [u8; ARCHIVE_CIPHERTEXT_BYTES],
    pub hash: [u8; 32],
}

impl EncryptedArchivePage {
    pub fn encode(&self) -> [u8; ARCHIVE_PAGE_BYTES] {
        let header = archive_header(
            self.epoch,
            self.generation,
            self.page,
            self.nonce,
            self.previous_hash,
        );
        let mut encoded = [0_u8; ARCHIVE_PAGE_BYTES];
        encoded[..ARCHIVE_HEADER_BYTES].copy_from_slice(&header);
        encoded[ARCHIVE_HEADER_BYTES..ARCHIVE_HEADER_BYTES + ARCHIVE_CIPHERTEXT_BYTES]
            .copy_from_slice(&self.ciphertext);
        encoded[ARCHIVE_PAGE_BYTES - 32..].copy_from_slice(&self.hash);
        encoded
    }

    pub fn decode(encoded: [u8; ARCHIVE_PAGE_BYTES]) -> Result<Self> {
        if encoded[0] != ARCHIVE_VERSION {
            return Err(Error::InvalidArchive);
        }
        let epoch = u64::from_be_bytes(encoded[1..9].try_into().unwrap());
        let generation = u64::from_be_bytes(encoded[9..17].try_into().unwrap());
        let page = u32::from_be_bytes(encoded[17..21].try_into().unwrap());
        let nonce = encoded[21..45].try_into().unwrap();
        let previous_hash = encoded[45..77].try_into().unwrap();
        let ciphertext = encoded
            [ARCHIVE_HEADER_BYTES..ARCHIVE_HEADER_BYTES + ARCHIVE_CIPHERTEXT_BYTES]
            .try_into()
            .unwrap();
        let hash = encoded[ARCHIVE_PAGE_BYTES - 32..].try_into().unwrap();
        Ok(Self {
            epoch,
            generation,
            page,
            nonce,
            previous_hash,
            ciphertext,
            hash,
        })
    }
}

pub fn verify_sync_challenge(
    signing_public_key: [u8; 32],
    locator: [u8; 32],
    challenge: [u8; 32],
    expires_at: u64,
    signature: [u8; 64],
) -> Result<()> {
    let key = VerifyingKey::from_bytes(&signing_public_key).map_err(|_| Error::InvalidArchive)?;
    if key.is_weak() {
        return Err(Error::InvalidArchive);
    }
    key.verify(
        &challenge_message(locator, challenge, expires_at),
        &Signature::from_bytes(&signature),
    )
    .map_err(|_| Error::ArchiveAuthenticationFailed)
}

fn derive(
    hkdf: &Hkdf<Sha256>,
    network: Network,
    vault: [u8; 32],
    purpose: u8,
    attempt: u16,
) -> Result<[u8; 32]> {
    let mut info = [0_u8; 37];
    info[0] = PROTOCOL_VERSION;
    info[1] = network as u8;
    info[2..34].copy_from_slice(&vault);
    info[34] = purpose;
    info[35..].copy_from_slice(&attempt.to_be_bytes());
    let mut output = [0_u8; 32];
    hkdf.expand(&info, &mut output)
        .map_err(|_| Error::InvalidDerivation)?;
    if output == [0; 32] {
        return Err(Error::InvalidDerivation);
    }
    Ok(output)
}

fn derive_signing_seed(hkdf: &Hkdf<Sha256>, network: Network, vault: [u8; 32]) -> Result<[u8; 32]> {
    for attempt in 0..=u16::MAX {
        let candidate = derive(hkdf, network, vault, 2, attempt)?;
        if !SigningKey::from_bytes(&candidate).verifying_key().is_weak() {
            return Ok(candidate);
        }
    }
    Err(Error::InvalidDerivation)
}

fn archive_header(
    epoch: u64,
    generation: u64,
    page: u32,
    nonce: [u8; 24],
    previous_hash: [u8; 32],
) -> [u8; ARCHIVE_HEADER_BYTES] {
    let mut header = [0_u8; ARCHIVE_HEADER_BYTES];
    header[0] = ARCHIVE_VERSION;
    header[1..9].copy_from_slice(&epoch.to_be_bytes());
    header[9..17].copy_from_slice(&generation.to_be_bytes());
    header[17..21].copy_from_slice(&page.to_be_bytes());
    header[21..45].copy_from_slice(&nonce);
    header[45..77].copy_from_slice(&previous_hash);
    header
}

fn archive_aad(locator: [u8; 32], header: &[u8; ARCHIVE_HEADER_BYTES]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(ARCHIVE_PAGE_DOMAIN.len() + 32 + ARCHIVE_HEADER_BYTES);
    aad.extend_from_slice(ARCHIVE_PAGE_DOMAIN);
    aad.extend_from_slice(&locator);
    aad.extend_from_slice(header);
    aad
}

fn page_hash(
    locator: [u8; 32],
    header: &[u8; ARCHIVE_HEADER_BYTES],
    ciphertext: &[u8; ARCHIVE_CIPHERTEXT_BYTES],
) -> [u8; 32] {
    Sha256::new()
        .chain_update(ARCHIVE_PAGE_DOMAIN)
        .chain_update(locator)
        .chain_update(header)
        .chain_update(ciphertext)
        .finalize()
        .into()
}

fn challenge_message(locator: [u8; 32], challenge: [u8; 32], expires_at: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(SYNC_CHALLENGE_DOMAIN.len() + 72);
    message.extend_from_slice(SYNC_CHALLENGE_DOMAIN);
    message.extend_from_slice(&locator);
    message.extend_from_slice(&challenge);
    message.extend_from_slice(&expires_at.to_be_bytes());
    message
}

fn decrypt_page(
    locator: [u8; 32],
    archive_root: [u8; 32],
    encrypted: &EncryptedArchivePage,
) -> Result<Vec<u8>> {
    let header = archive_header(
        encrypted.epoch,
        encrypted.generation,
        encrypted.page,
        encrypted.nonce,
        encrypted.previous_hash,
    );
    if encrypted.epoch == 0
        || encrypted.generation == 0
        || encrypted.nonce == [0; 24]
        || page_hash(locator, &header, &encrypted.ciphertext) != encrypted.hash
    {
        return Err(Error::InvalidArchive);
    }
    let key = page_key(archive_root, encrypted.epoch)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let padded = cipher
        .decrypt(
            XNonce::from_slice(&encrypted.nonce),
            Payload {
                msg: &encrypted.ciphertext,
                aad: &archive_aad(locator, &header),
            },
        )
        .map_err(|_| Error::ArchiveAuthenticationFailed)?;
    if padded.len() != ARCHIVE_PADDED_BYTES {
        return Err(Error::InvalidArchive);
    }
    let length =
        u32::from_be_bytes(padded[..4].try_into().map_err(|_| Error::InvalidArchive)?) as usize;
    if length > ARCHIVE_PAGE_CONTENT_BYTES || padded[4 + length..].iter().any(|byte| *byte != 0) {
        return Err(Error::InvalidArchive);
    }
    Ok(padded[4..4 + length].to_vec())
}

fn page_key(archive_root: [u8; 32], epoch: u64) -> Result<[u8; 32]> {
    let hkdf = Hkdf::<Sha256>::new(Some(ARCHIVE_PAGE_DOMAIN), &archive_root);
    let mut info = [0_u8; 17];
    info[0] = PROTOCOL_VERSION;
    info[1..9].copy_from_slice(&epoch.to_be_bytes());
    info[9..].copy_from_slice(b"page-key");
    let mut key = [0_u8; 32];
    hkdf.expand(&info, &mut key)
        .map_err(|_| Error::InvalidDerivation)?;
    if key == [0; 32] {
        return Err(Error::InvalidDerivation);
    }
    Ok(key)
}

fn activity_view_checksum(body: &[u8; ACTIVITY_VIEW_BODY_BYTES]) -> [u8; 32] {
    Sha256::new()
        .chain_update(ACTIVITY_VIEW_CHECKSUM_DOMAIN)
        .chain_update(body)
        .finalize()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(seed: u8) -> ArchiveIdentity {
        ArchiveIdentity::derive(
            &MasterEntropy::from_bytes([seed; 32]).unwrap(),
            Network::Testnet,
            [9; 32],
        )
        .unwrap()
    }

    #[test]
    fn archive_page_round_trip_is_fixed_and_chained() {
        let current = identity(7);
        let page = current
            .encrypt_page(1, 2, 3, [4; 32], [5; 24], b"private activity")
            .unwrap();
        let encoded = page.encode();
        assert_eq!(encoded.len(), ARCHIVE_PAGE_BYTES);
        let decoded = EncryptedArchivePage::decode(encoded).unwrap();
        assert_eq!(decoded, page);
        assert_eq!(current.decrypt_page(&decoded).unwrap(), b"private activity");
    }

    #[test]
    fn archive_rejects_tampering_wrong_identity_and_invalid_shape() {
        let current = identity(7);
        let page = current
            .encrypt_page(1, 2, 3, [4; 32], [5; 24], b"private activity")
            .unwrap();
        assert_eq!(identity(8).decrypt_page(&page), Err(Error::InvalidArchive));
        let mut encoded = page.encode();
        encoded[100] ^= 1;
        let changed = EncryptedArchivePage::decode(encoded).unwrap();
        assert_eq!(current.decrypt_page(&changed), Err(Error::InvalidArchive));
        assert_eq!(
            current.encrypt_page(1, 1, 0, [0; 32], [0; 24], b"x"),
            Err(Error::InvalidArchive)
        );
        assert_eq!(
            current.encrypt_page(
                1,
                1,
                0,
                [0; 32],
                [1; 24],
                &vec![0; ARCHIVE_PAGE_CONTENT_BYTES + 1],
            ),
            Err(Error::ArchiveTooLarge)
        );
    }

    #[test]
    fn sync_challenge_authentication_is_scoped() {
        let identity = identity(7);
        let challenge = [8; 32];
        let signature = identity.sign_challenge(challenge, 1_000);
        verify_sync_challenge(
            identity.signing_public_key(),
            identity.locator(),
            challenge,
            1_000,
            signature,
        )
        .unwrap();
        assert_eq!(
            verify_sync_challenge(
                identity.signing_public_key(),
                identity.locator(),
                challenge,
                1_001,
                signature,
            ),
            Err(Error::ArchiveAuthenticationFailed)
        );
    }

    #[test]
    fn archive_identity_is_network_and_vault_separated() {
        let master = MasterEntropy::from_bytes([7; 32]).unwrap();
        let testnet = ArchiveIdentity::derive(&master, Network::Testnet, [9; 32]).unwrap();
        let mainnet = ArchiveIdentity::derive(&master, Network::Mainnet, [9; 32]).unwrap();
        let other_vault = ArchiveIdentity::derive(&master, Network::Testnet, [10; 32]).unwrap();
        assert_ne!(testnet.locator(), mainnet.locator());
        assert_ne!(testnet.locator(), other_vault.locator());
        assert_ne!(testnet.signing_public_key(), mainnet.signing_public_key());
    }

    #[test]
    fn activity_view_is_past_only_and_cannot_authenticate_sync() {
        let current = identity(7);
        let page = current
            .encrypt_page(2, 1, 0, [0; 32], [3; 24], b"receipt")
            .unwrap();
        let encoded = current.viewing_export(2).unwrap().encode();
        let restored = ActivityViewingKey::decode(&encoded).unwrap();
        assert_eq!(restored.decrypt_page(&page).unwrap(), b"receipt");

        let future = current
            .encrypt_page(3, 2, 0, page.hash, [4; 24], b"future")
            .unwrap();
        assert_eq!(
            restored.decrypt_page(&future),
            Err(Error::InvalidViewingExport)
        );
        assert!(
            !encoded
                .as_bytes()
                .windows(32)
                .any(|window| window == current.signing_seed)
        );
    }

    #[test]
    fn activity_view_rejects_tampering_and_zero_epoch() {
        let current = identity(7);
        assert!(current.viewing_export(0).is_err());
        let mut encoded = current.viewing_export(2).unwrap().encode().into_bytes();
        let index = encoded.len() - 2;
        encoded[index] = if encoded[index] == b'A' { b'B' } else { b'A' };
        assert!(ActivityViewingKey::decode(core::str::from_utf8(&encoded).unwrap()).is_err());
    }
}
