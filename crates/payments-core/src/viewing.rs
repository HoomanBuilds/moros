use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

use crate::{
    EncryptedOutput, Error, FieldElement, MasterEntropy, Network, PAYMENT_CODE_BYTES, PaymentCode,
    PrivateNote, Result,
};

pub const INCOMING_VIEW_PREFIX: &str = "moros_view_in_";
pub const MAX_VIEWING_IDENTITIES: u32 = 4_096;
const VIEWING_EXPORT_VERSION: u8 = 1;
const VIEWING_EXPORT_HEADER_BYTES: usize = 1 + 1 + 32 + 8 + 4;
const VIEWING_ENTRY_BYTES: usize = 8 + PAYMENT_CODE_BYTES + 32;
const VIEWING_CHECKSUM_BYTES: usize = 32;
const VIEWING_CHECKSUM_DOMAIN: &[u8] = b"moros/incoming-view/checksum/v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewingIdentity {
    pub child_index: u64,
    pub payment_code: PaymentCode,
    viewing_secret: [u8; 32],
}

impl ViewingIdentity {
    pub fn decrypt_output(
        &self,
        envelope: [FieldElement; 15],
        note_domain: FieldElement,
        expected_commitment: Option<FieldElement>,
    ) -> Result<PrivateNote> {
        EncryptedOutput::decrypt(
            envelope,
            self.viewing_secret,
            &self.payment_code,
            note_domain,
            expected_commitment,
        )
    }

    pub fn viewing_secret_le(&self) -> [u8; 32] {
        self.viewing_secret
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingViewingExport {
    pub network: Network,
    pub vault: [u8; 32],
    pub maximum_child_index: u64,
    identities: Vec<ViewingIdentity>,
}

impl IncomingViewingExport {
    pub fn derive(
        master: &MasterEntropy,
        network: Network,
        vault: [u8; 32],
        maximum_child_index: u64,
    ) -> Result<Self> {
        let count = maximum_child_index
            .checked_add(1)
            .ok_or(Error::ViewingExportTooLarge)?;
        if count > u64::from(MAX_VIEWING_IDENTITIES) {
            return Err(Error::ViewingExportTooLarge);
        }
        let mut identities = Vec::with_capacity(count as usize);
        for child_index in 0..count {
            let child = master.derive_child(network, vault, child_index)?;
            identities.push(ViewingIdentity {
                child_index,
                payment_code: child.payment_code()?,
                viewing_secret: child.viewing_secret_le(),
            });
        }
        Ok(Self {
            network,
            vault,
            maximum_child_index,
            identities,
        })
    }

    pub fn identities(&self) -> &[ViewingIdentity] {
        &self.identities
    }

    pub fn encode(&self) -> Result<String> {
        self.validate()?;
        let mut bytes = Vec::with_capacity(
            VIEWING_EXPORT_HEADER_BYTES
                + self.identities.len() * VIEWING_ENTRY_BYTES
                + VIEWING_CHECKSUM_BYTES,
        );
        bytes.push(VIEWING_EXPORT_VERSION);
        bytes.push(self.network as u8);
        bytes.extend_from_slice(&self.vault);
        bytes.extend_from_slice(&self.maximum_child_index.to_be_bytes());
        bytes.extend_from_slice(&(self.identities.len() as u32).to_be_bytes());
        for identity in &self.identities {
            bytes.extend_from_slice(&identity.child_index.to_be_bytes());
            bytes.extend_from_slice(&identity.payment_code.canonical_bytes()?);
            bytes.extend_from_slice(&identity.viewing_secret);
        }
        let checksum = viewing_checksum(&bytes);
        bytes.extend_from_slice(&checksum);
        Ok(format!(
            "{INCOMING_VIEW_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(bytes)
        ))
    }

    pub fn decode(encoded: &str) -> Result<Self> {
        let payload = encoded
            .strip_prefix(INCOMING_VIEW_PREFIX)
            .ok_or(Error::InvalidViewingExport)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| Error::InvalidViewingExport)?;
        if URL_SAFE_NO_PAD.encode(&bytes) != payload
            || bytes.len() < VIEWING_EXPORT_HEADER_BYTES + VIEWING_CHECKSUM_BYTES
        {
            return Err(Error::InvalidViewingExport);
        }
        let body_length = bytes.len() - VIEWING_CHECKSUM_BYTES;
        if viewing_checksum(&bytes[..body_length]) != bytes[body_length..] {
            return Err(Error::InvalidViewingExport);
        }
        if bytes[0] != VIEWING_EXPORT_VERSION {
            return Err(Error::InvalidViewingExport);
        }
        let network = Network::try_from(bytes[1])?;
        let vault = bytes[2..34]
            .try_into()
            .map_err(|_| Error::InvalidViewingExport)?;
        let maximum_child_index = u64::from_be_bytes(
            bytes[34..42]
                .try_into()
                .map_err(|_| Error::InvalidViewingExport)?,
        );
        let count = u32::from_be_bytes(
            bytes[42..46]
                .try_into()
                .map_err(|_| Error::InvalidViewingExport)?,
        );
        if count == 0 || count > MAX_VIEWING_IDENTITIES {
            return Err(Error::ViewingExportTooLarge);
        }
        let expected_length = VIEWING_EXPORT_HEADER_BYTES
            .checked_add(count as usize * VIEWING_ENTRY_BYTES)
            .and_then(|length| length.checked_add(VIEWING_CHECKSUM_BYTES))
            .ok_or(Error::InvalidViewingExport)?;
        if bytes.len() != expected_length || maximum_child_index != u64::from(count - 1) {
            return Err(Error::InvalidViewingExport);
        }

        let mut identities = Vec::with_capacity(count as usize);
        let mut cursor = VIEWING_EXPORT_HEADER_BYTES;
        for expected_index in 0..u64::from(count) {
            let child_index = u64::from_be_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
            cursor += 8;
            if child_index != expected_index {
                return Err(Error::InvalidViewingExport);
            }
            let payment_code =
                PaymentCode::from_canonical_bytes(&bytes[cursor..cursor + PAYMENT_CODE_BYTES])?;
            cursor += PAYMENT_CODE_BYTES;
            let viewing_secret: [u8; 32] = bytes[cursor..cursor + 32].try_into().unwrap();
            cursor += 32;
            if payment_code.network != network
                || payment_code.vault != vault
                || crate::BabyJubPoint::from_secret_le(viewing_secret)?
                    != payment_code.viewing_public_key
            {
                return Err(Error::InvalidViewingExport);
            }
            identities.push(ViewingIdentity {
                child_index,
                payment_code,
                viewing_secret,
            });
        }
        let export = Self {
            network,
            vault,
            maximum_child_index,
            identities,
        };
        export.validate()?;
        if export.encode()? != encoded {
            return Err(Error::InvalidViewingExport);
        }
        Ok(export)
    }

    fn validate(&self) -> Result<()> {
        if self.vault == [0; 32]
            || self.identities.is_empty()
            || self.identities.len() > MAX_VIEWING_IDENTITIES as usize
            || self.maximum_child_index != self.identities.len() as u64 - 1
        {
            return Err(Error::InvalidViewingExport);
        }
        for (expected, identity) in self.identities.iter().enumerate() {
            if identity.child_index != expected as u64
                || identity.payment_code.network != self.network
                || identity.payment_code.vault != self.vault
                || crate::BabyJubPoint::from_secret_le(identity.viewing_secret)?
                    != identity.payment_code.viewing_public_key
            {
                return Err(Error::InvalidViewingExport);
            }
        }
        Ok(())
    }
}

fn viewing_checksum(bytes: &[u8]) -> [u8; 32] {
    Sha256::new()
        .chain_update(VIEWING_CHECKSUM_DOMAIN)
        .chain_update(bytes)
        .finalize()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{EncryptedOutput, PrivateNoteAmount};

    #[test]
    fn incoming_view_round_trip_decrypts_without_spend_authority() {
        let master = MasterEntropy::from_bytes([31; 32]).unwrap();
        let export = IncomingViewingExport::derive(&master, Network::Testnet, [7; 32], 2).unwrap();
        let encoded = export.encode().unwrap();
        let decoded = IncomingViewingExport::decode(&encoded).unwrap();
        assert_eq!(decoded, export);

        let recipient = &decoded.identities()[2];
        let mut ephemeral = [0_u8; 32];
        ephemeral[0] = 17;
        let output = EncryptedOutput::create(
            0,
            FieldElement::from_u64(41),
            1,
            PrivateNoteAmount::new(25_000_000).unwrap(),
            &recipient.payment_code,
            FieldElement::from_u64(43),
            FieldElement::from_u64(0),
            [FieldElement::from_u64(0), FieldElement::from_u64(0)],
            FieldElement::from_u64(47),
            ephemeral,
            FieldElement::from_u64(53),
        )
        .unwrap();
        let note = recipient
            .decrypt_output(
                output.envelope,
                output.note.note_domain,
                Some(output.note.commitment),
            )
            .unwrap();
        assert_eq!(note.amount.atomic(), 25_000_000);
        assert!(note.nullifier([0; 32], 1).is_err());

        for child_index in 0..=2 {
            let spend = master
                .derive_child(Network::Testnet, [7; 32], child_index)
                .unwrap()
                .spend_secret_le();
            assert!(
                !URL_SAFE_NO_PAD
                    .decode(encoded.strip_prefix(INCOMING_VIEW_PREFIX).unwrap())
                    .unwrap()
                    .windows(32)
                    .any(|window| window == spend)
            );
        }
    }

    #[test]
    fn incoming_view_rejects_tampering_and_oversized_ranges() {
        let master = MasterEntropy::from_bytes([31; 32]).unwrap();
        let export = IncomingViewingExport::derive(&master, Network::Testnet, [7; 32], 2).unwrap();
        let mut encoded = export.encode().unwrap().into_bytes();
        let index = encoded.len() - 3;
        encoded[index] = if encoded[index] == b'A' { b'B' } else { b'A' };
        assert!(IncomingViewingExport::decode(core::str::from_utf8(&encoded).unwrap()).is_err());
        assert_eq!(
            IncomingViewingExport::derive(
                &master,
                Network::Testnet,
                [7; 32],
                u64::from(MAX_VIEWING_IDENTITIES),
            ),
            Err(Error::ViewingExportTooLarge)
        );
    }
}
