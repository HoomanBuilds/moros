use crate::{BabyJubPoint, Error, FieldElement, PaymentCode, Result, poseidon::hash_fields};

pub const PAYMENT_ATTACHMENT_BYTES: usize = 128;
pub const MAX_MEMO_BYTES: usize = 96;
const ATTACHMENT_FIELD_COUNT: usize = 4;
const PACKED_FIELD_BYTES: usize = 31;
const PACKED_BYTES: usize = ATTACHMENT_FIELD_COUNT * PACKED_FIELD_BYTES;
const ATTACHMENT_VERSION: u8 = 1;
const PAYMENT_ATTACHMENT_TAG: u64 = 1110;
const PAYMENT_ATTACHMENT_PAD_TAG: u64 = 1112;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedAttachment {
    pub fields: [FieldElement; ATTACHMENT_FIELD_COUNT],
    pub hash: FieldElement,
}

impl EncryptedAttachment {
    pub fn create(
        memo: &str,
        recipient: &PaymentCode,
        ephemeral_secret: [u8; 32],
        nonce: FieldElement,
    ) -> Result<Self> {
        let memo = memo.as_bytes();
        if memo.len() > MAX_MEMO_BYTES {
            return Err(Error::MemoTooLong);
        }
        if nonce.is_zero() {
            return Err(Error::InvalidAttachment);
        }

        let shared = recipient
            .viewing_public_key
            .multiply_small(8)?
            .multiply_scalar(ephemeral_secret)?;
        let plaintext = pack_memo(memo);
        let fields = encrypt_fields(plaintext, shared, nonce)?;
        let hash = attachment_hash(fields);
        Ok(Self { fields, hash })
    }

    pub fn decrypt(
        bytes: [u8; PAYMENT_ATTACHMENT_BYTES],
        envelope: [FieldElement; 15],
        viewing_secret: [u8; 32],
        recipient: &PaymentCode,
        expected_hash: FieldElement,
    ) -> Result<String> {
        let fields = Self::fields_from_bytes(bytes)?;
        if attachment_hash(fields) != expected_hash {
            return Err(Error::InvalidAttachment);
        }
        let derived = BabyJubPoint::from_secret_le(viewing_secret)?;
        if derived != recipient.viewing_public_key {
            return Err(Error::RecipientMismatch);
        }
        if envelope[0] != FieldElement::from_u64(1) || envelope[3].is_zero() {
            return Err(Error::InvalidEnvelope);
        }
        let ephemeral =
            BabyJubPoint::from_le_bytes(envelope[1].to_le_bytes(), envelope[2].to_le_bytes())?;
        let shared = ephemeral
            .multiply_scalar(viewing_secret)?
            .multiply_small(8)?;
        unpack_memo(decrypt_fields(fields, shared, envelope[3])?)
    }

    pub fn to_bytes(&self) -> [u8; PAYMENT_ATTACHMENT_BYTES] {
        let mut bytes = [0_u8; PAYMENT_ATTACHMENT_BYTES];
        for (index, field) in self.fields.iter().enumerate() {
            bytes[index * 32..(index + 1) * 32].copy_from_slice(&field.to_be_bytes());
        }
        bytes
    }

    pub fn fields_from_bytes(
        bytes: [u8; PAYMENT_ATTACHMENT_BYTES],
    ) -> Result<[FieldElement; ATTACHMENT_FIELD_COUNT]> {
        let mut fields = [FieldElement::from_u64(0); ATTACHMENT_FIELD_COUNT];
        for (index, chunk) in bytes.chunks_exact(32).enumerate() {
            fields[index] = FieldElement::from_be_bytes(
                chunk.try_into().map_err(|_| Error::InvalidAttachment)?,
            )
            .map_err(|_| Error::InvalidAttachment)?;
        }
        Ok(fields)
    }
}

fn pack_memo(memo: &[u8]) -> [u8; PACKED_BYTES] {
    let mut packed = [0_u8; PACKED_BYTES];
    packed[0] = ATTACHMENT_VERSION;
    packed[1] = memo.len() as u8;
    packed[2..2 + memo.len()].copy_from_slice(memo);
    packed
}

fn unpack_memo(packed: [u8; PACKED_BYTES]) -> Result<String> {
    if packed[0] != ATTACHMENT_VERSION {
        return Err(Error::InvalidAttachment);
    }
    let length = usize::from(packed[1]);
    if length > MAX_MEMO_BYTES || packed[2 + length..].iter().any(|byte| *byte != 0) {
        return Err(Error::InvalidAttachment);
    }
    String::from_utf8(packed[2..2 + length].to_vec()).map_err(|_| Error::InvalidAttachment)
}

fn encrypt_fields(
    plaintext: [u8; PACKED_BYTES],
    shared: BabyJubPoint,
    nonce: FieldElement,
) -> Result<[FieldElement; ATTACHMENT_FIELD_COUNT]> {
    let plain = packed_fields(plaintext)?;
    let (shared_x, shared_y) = point_fields(shared);
    Ok(core::array::from_fn(|index| {
        let pad = attachment_pad(shared_x, shared_y, nonce, index);
        FieldElement::from_field(plain[index].0 + pad.0)
    }))
}

fn decrypt_fields(
    ciphertext: [FieldElement; ATTACHMENT_FIELD_COUNT],
    shared: BabyJubPoint,
    nonce: FieldElement,
) -> Result<[u8; PACKED_BYTES]> {
    let (shared_x, shared_y) = point_fields(shared);
    let plaintext = core::array::from_fn(|index| {
        let pad = attachment_pad(shared_x, shared_y, nonce, index);
        FieldElement::from_field(ciphertext[index].0 - pad.0)
    });
    unpack_fields(plaintext)
}

fn packed_fields(bytes: [u8; PACKED_BYTES]) -> Result<[FieldElement; ATTACHMENT_FIELD_COUNT]> {
    let mut fields = [FieldElement::from_u64(0); ATTACHMENT_FIELD_COUNT];
    for (index, chunk) in bytes.chunks_exact(PACKED_FIELD_BYTES).enumerate() {
        let mut encoded = [0_u8; 32];
        encoded[..PACKED_FIELD_BYTES].copy_from_slice(chunk);
        fields[index] = FieldElement::from_le_bytes(encoded)?;
    }
    Ok(fields)
}

fn unpack_fields(fields: [FieldElement; ATTACHMENT_FIELD_COUNT]) -> Result<[u8; PACKED_BYTES]> {
    let mut bytes = [0_u8; PACKED_BYTES];
    for (index, field) in fields.iter().enumerate() {
        let encoded = field.to_le_bytes();
        if encoded[PACKED_FIELD_BYTES] != 0 {
            return Err(Error::InvalidAttachment);
        }
        bytes[index * PACKED_FIELD_BYTES..(index + 1) * PACKED_FIELD_BYTES]
            .copy_from_slice(&encoded[..PACKED_FIELD_BYTES]);
    }
    Ok(bytes)
}

fn attachment_pad(
    shared_x: FieldElement,
    shared_y: FieldElement,
    nonce: FieldElement,
    index: usize,
) -> FieldElement {
    hash_fields(&[
        FieldElement::from_u64(PAYMENT_ATTACHMENT_PAD_TAG),
        shared_x,
        shared_y,
        nonce,
        FieldElement::from_u64(index as u64),
    ])
}

fn attachment_hash(fields: [FieldElement; ATTACHMENT_FIELD_COUNT]) -> FieldElement {
    hash_fields(&[
        FieldElement::from_u64(PAYMENT_ATTACHMENT_TAG),
        fields[0],
        fields[1],
        fields[2],
        fields[3],
    ])
}

fn point_fields(point: BabyJubPoint) -> (FieldElement, FieldElement) {
    let (x, y) = point.to_le_bytes();
    (
        FieldElement::from_le_bytes(x).expect("validated BabyJub x"),
        FieldElement::from_le_bytes(y).expect("validated BabyJub y"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MasterEntropy, Network, PrivateNoteAmount, note::EncryptedOutput};

    fn fixture() -> (PaymentCode, [u8; 32], [u8; 32], FieldElement) {
        let identity = MasterEntropy::from_bytes([19; 32])
            .unwrap()
            .derive_child(Network::Testnet, [7; 32], 3)
            .unwrap();
        let code = identity.payment_code().unwrap();
        let viewing_secret = identity.viewing_secret_le();
        let mut ephemeral_secret = [0_u8; 32];
        ephemeral_secret[0] = 23;
        let nonce = FieldElement::from_u64(29);
        (code, viewing_secret, ephemeral_secret, nonce)
    }

    #[test]
    fn memo_round_trip_is_fixed_size_and_proof_bound() {
        let (code, viewing_secret, ephemeral_secret, nonce) = fixture();
        let attachment =
            EncryptedAttachment::create("Coffee order 42", &code, ephemeral_secret, nonce).unwrap();
        let output = EncryptedOutput::create(
            0,
            FieldElement::from_u64(31),
            1,
            PrivateNoteAmount::new(10_000_000).unwrap(),
            &code,
            FieldElement::from_u64(37),
            FieldElement::from_u64(41),
            [attachment.hash, FieldElement::from_u64(0)],
            FieldElement::from_u64(43),
            ephemeral_secret,
            nonce,
        )
        .unwrap();
        let encoded = attachment.to_bytes();
        assert_eq!(encoded.len(), PAYMENT_ATTACHMENT_BYTES);
        assert_eq!(
            EncryptedAttachment::decrypt(
                encoded,
                output.envelope,
                viewing_secret,
                &code,
                attachment.hash,
            )
            .unwrap(),
            "Coffee order 42"
        );
    }

    #[test]
    fn attachment_rejects_tampering_wrong_recipient_and_oversize() {
        let (code, viewing_secret, ephemeral_secret, nonce) = fixture();
        let attachment =
            EncryptedAttachment::create("memo", &code, ephemeral_secret, nonce).unwrap();
        let output = EncryptedOutput::create(
            0,
            FieldElement::from_u64(31),
            1,
            PrivateNoteAmount::new(1).unwrap(),
            &code,
            FieldElement::from_u64(37),
            FieldElement::from_u64(0),
            [attachment.hash, FieldElement::from_u64(0)],
            FieldElement::from_u64(43),
            ephemeral_secret,
            nonce,
        )
        .unwrap();
        let mut tampered = attachment.to_bytes();
        tampered[31] ^= 1;
        assert_eq!(
            EncryptedAttachment::decrypt(
                tampered,
                output.envelope,
                viewing_secret,
                &code,
                attachment.hash,
            ),
            Err(Error::InvalidAttachment)
        );
        assert_eq!(
            EncryptedAttachment::decrypt(
                attachment.to_bytes(),
                output.envelope,
                [1; 32],
                &code,
                attachment.hash,
            ),
            Err(Error::RecipientMismatch)
        );
        assert_eq!(
            EncryptedAttachment::create(
                &"x".repeat(MAX_MEMO_BYTES + 1),
                &code,
                ephemeral_secret,
                nonce,
            ),
            Err(Error::MemoTooLong)
        );
    }

    #[test]
    fn empty_and_multibyte_memos_round_trip() {
        let (code, viewing_secret, ephemeral_secret, nonce) = fixture();
        for memo in ["", "Paid for lunch 🍜"] {
            let attachment =
                EncryptedAttachment::create(memo, &code, ephemeral_secret, nonce).unwrap();
            let output = EncryptedOutput::create(
                0,
                FieldElement::from_u64(31),
                1,
                PrivateNoteAmount::new(1).unwrap(),
                &code,
                FieldElement::from_u64(37),
                FieldElement::from_u64(0),
                [attachment.hash, FieldElement::from_u64(0)],
                FieldElement::from_u64(43),
                ephemeral_secret,
                nonce,
            )
            .unwrap();
            assert_eq!(
                EncryptedAttachment::decrypt(
                    attachment.to_bytes(),
                    output.envelope,
                    viewing_secret,
                    &code,
                    attachment.hash,
                )
                .unwrap(),
                memo
            );
        }
    }
}
