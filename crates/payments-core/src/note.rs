use crate::{
    AtomicUsdc, BabyJubPoint, Error, FieldElement, PaymentCode, Result, poseidon::hash_fields,
    spend_public_key,
};

const NOTE_COMMITMENT_TAG: u64 = 1003;
const NOTE_NULLIFIER_TAG: u64 = 1004;
const OUTPUT_PAD_TAG: u64 = 1006;
const OUTPUT_AUTHENTICATION_TAG: u64 = 1007;
const OUTPUT_ENVELOPE_TAG: u64 = 1008;
const ENVELOPE_VERSION: u64 = 1;
const OUTPUT_COUNT: u8 = 4;
const ENVELOPE_LENGTH: usize = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PrivateNoteAmount(i128);

impl PrivateNoteAmount {
    pub fn new(atomic: i128) -> Result<Self> {
        if atomic < 0 {
            return Err(Error::InvalidAmount);
        }
        Ok(Self(atomic))
    }

    pub const fn atomic(self) -> i128 {
        self.0
    }

    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub fn spendable(self) -> Result<AtomicUsdc> {
        AtomicUsdc::new(self.0).map_err(|_| Error::InvalidNote)
    }
}

impl From<AtomicUsdc> for PrivateNoteAmount {
    fn from(amount: AtomicUsdc) -> Self {
        Self(amount.atomic())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrivateNote {
    pub note_domain: FieldElement,
    pub purpose: u64,
    pub amount: PrivateNoteAmount,
    pub spend_public_key: FieldElement,
    pub viewing_public_key: BabyJubPoint,
    pub note_id: FieldElement,
    pub payload_hash: FieldElement,
    pub private_data: [FieldElement; 2],
    pub blinding: FieldElement,
    pub commitment: FieldElement,
}

impl PrivateNote {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        note_domain: FieldElement,
        purpose: u64,
        amount: PrivateNoteAmount,
        spend_public_key: FieldElement,
        viewing_public_key: BabyJubPoint,
        note_id: FieldElement,
        payload_hash: FieldElement,
        private_data: [FieldElement; 2],
        blinding: FieldElement,
    ) -> Result<Self> {
        if note_domain.is_zero()
            || purpose == 0
            || spend_public_key.is_zero()
            || note_id.is_zero()
            || blinding.is_zero()
        {
            return Err(Error::InvalidNote);
        }
        let mut note = Self {
            note_domain,
            purpose,
            amount,
            spend_public_key,
            viewing_public_key,
            note_id,
            payload_hash,
            private_data,
            blinding,
            commitment: FieldElement::from_u64(0),
        };
        note.commitment = note.compute_commitment();
        Ok(note)
    }

    pub fn nullifier(&self, spend_secret: [u8; 32], nullifier_domain: u64) -> Result<FieldElement> {
        if nullifier_domain == 0 || self.amount.is_zero() {
            return Err(Error::InvalidNote);
        }
        if spend_public_key(spend_secret)? != self.spend_public_key.to_le_bytes() {
            return Err(Error::RecipientMismatch);
        }
        Ok(hash_fields(&[
            FieldElement::from_u64(NOTE_NULLIFIER_TAG),
            self.note_domain,
            FieldElement::from_u64(nullifier_domain),
            self.commitment,
            FieldElement::from_le_bytes(spend_secret)?,
            self.note_id,
        ]))
    }

    fn compute_commitment(&self) -> FieldElement {
        let (viewing_x, viewing_y) = point_fields(self.viewing_public_key);
        hash_fields(&[
            FieldElement::from_u64(NOTE_COMMITMENT_TAG),
            self.note_domain,
            FieldElement::from_u64(self.purpose),
            FieldElement::from_atomic(self.amount.atomic()).expect("positive note amount"),
            self.spend_public_key,
            viewing_x,
            viewing_y,
            self.note_id,
            self.payload_hash,
            self.private_data[0],
            self.private_data[1],
            self.blinding,
        ])
    }

    fn plaintext(&self) -> [FieldElement; 10] {
        let (viewing_x, viewing_y) = point_fields(self.viewing_public_key);
        [
            FieldElement::from_u64(self.purpose),
            FieldElement::from_atomic(self.amount.atomic()).expect("positive note amount"),
            self.spend_public_key,
            viewing_x,
            viewing_y,
            self.note_id,
            self.payload_hash,
            self.private_data[0],
            self.private_data[1],
            self.blinding,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedOutput {
    pub note: PrivateNote,
    pub envelope: [FieldElement; ENVELOPE_LENGTH],
    pub envelope_hash: FieldElement,
}

impl EncryptedOutput {
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        output_index: u8,
        note_domain: FieldElement,
        purpose: u64,
        amount: PrivateNoteAmount,
        recipient: &PaymentCode,
        note_id: FieldElement,
        payload_hash: FieldElement,
        private_data: [FieldElement; 2],
        blinding: FieldElement,
        ephemeral_secret: [u8; 32],
        nonce: FieldElement,
    ) -> Result<Self> {
        if output_index >= OUTPUT_COUNT {
            return Err(Error::InvalidOutputIndex);
        }
        if nonce.is_zero() || ephemeral_secret[31] != 0 {
            return Err(Error::InvalidEnvelope);
        }
        let note = PrivateNote::new(
            note_domain,
            purpose,
            amount,
            FieldElement::from_le_bytes(recipient.spend_public_key)?,
            recipient.viewing_public_key,
            note_id,
            payload_hash,
            private_data,
            blinding,
        )?;
        let ephemeral_public_key = BabyJubPoint::from_secret_le(ephemeral_secret)?;
        let shared_secret = recipient
            .viewing_public_key
            .multiply_small(8)?
            .multiply_scalar(ephemeral_secret)?;
        let plaintext = note.plaintext();
        let (shared_x, shared_y) = point_fields(shared_secret);

        let mut envelope = [FieldElement::from_u64(0); ENVELOPE_LENGTH];
        envelope[0] = FieldElement::from_u64(ENVELOPE_VERSION);
        let (ephemeral_x, ephemeral_y) = point_fields(ephemeral_public_key);
        envelope[1] = ephemeral_x;
        envelope[2] = ephemeral_y;
        envelope[3] = nonce;
        for (index, value) in plaintext.iter().enumerate() {
            let pad = hash_fields(&[
                FieldElement::from_u64(OUTPUT_PAD_TAG),
                shared_x,
                shared_y,
                nonce,
                FieldElement::from_u64(u64::from(output_index)),
                FieldElement::from_u64(index as u64),
            ]);
            envelope[index + 4] = FieldElement::from_field(value.0 + pad.0);
        }
        envelope[14] = authentication(shared_x, shared_y, nonce, output_index, &plaintext);
        let mut hash_preimage = Vec::with_capacity(ENVELOPE_LENGTH + 1);
        hash_preimage.push(FieldElement::from_u64(OUTPUT_ENVELOPE_TAG));
        hash_preimage.extend_from_slice(&envelope);
        let envelope_hash = hash_fields(&hash_preimage);

        Ok(Self {
            note,
            envelope,
            envelope_hash,
        })
    }

    pub fn decrypt(
        envelope: [FieldElement; ENVELOPE_LENGTH],
        viewing_secret: [u8; 32],
        recipient: &PaymentCode,
        note_domain: FieldElement,
        expected_commitment: Option<FieldElement>,
    ) -> Result<PrivateNote> {
        if envelope[0] != FieldElement::from_u64(ENVELOPE_VERSION) {
            return Err(Error::InvalidEnvelope);
        }
        let ephemeral_public_key =
            BabyJubPoint::from_le_bytes(envelope[1].to_le_bytes(), envelope[2].to_le_bytes())?;
        let derived_viewing_public_key = BabyJubPoint::from_secret_le(viewing_secret)?;
        if derived_viewing_public_key != recipient.viewing_public_key {
            return Err(Error::RecipientMismatch);
        }
        let shared_secret = ephemeral_public_key
            .multiply_scalar(viewing_secret)?
            .multiply_small(8)?;
        let (shared_x, shared_y) = point_fields(shared_secret);
        let nonce = envelope[3];

        for output_index in 0..OUTPUT_COUNT {
            let mut plaintext = [FieldElement::from_u64(0); 10];
            for (index, ciphertext) in envelope[4..14].iter().enumerate() {
                let pad = hash_fields(&[
                    FieldElement::from_u64(OUTPUT_PAD_TAG),
                    shared_x,
                    shared_y,
                    nonce,
                    FieldElement::from_u64(u64::from(output_index)),
                    FieldElement::from_u64(index as u64),
                ]);
                plaintext[index] = FieldElement::from_field(ciphertext.0 - pad.0);
            }
            if authentication(shared_x, shared_y, nonce, output_index, &plaintext) != envelope[14] {
                continue;
            }

            let viewing_public_key = BabyJubPoint::from_le_bytes(
                plaintext[3].to_le_bytes(),
                plaintext[4].to_le_bytes(),
            )?;
            if viewing_public_key != recipient.viewing_public_key
                || plaintext[2].to_le_bytes() != recipient.spend_public_key
            {
                return Err(Error::RecipientMismatch);
            }
            let note = PrivateNote::new(
                note_domain,
                field_to_u64(plaintext[0])?,
                PrivateNoteAmount::new(plaintext[1].to_nonnegative_i128()?)?,
                plaintext[2],
                viewing_public_key,
                plaintext[5],
                plaintext[6],
                [plaintext[7], plaintext[8]],
                plaintext[9],
            )?;
            if expected_commitment.is_some_and(|expected| expected != note.commitment) {
                return Err(Error::CommitmentMismatch);
            }
            return Ok(note);
        }
        Err(Error::EnvelopeAuthenticationFailed)
    }

    pub fn envelope_bytes(&self) -> [u8; ENVELOPE_LENGTH * 32] {
        let mut bytes = [0_u8; ENVELOPE_LENGTH * 32];
        for (index, field) in self.envelope.iter().enumerate() {
            bytes[index * 32..(index + 1) * 32].copy_from_slice(&field.to_le_bytes());
        }
        bytes
    }

    pub fn envelope_from_bytes(
        bytes: [u8; ENVELOPE_LENGTH * 32],
    ) -> Result<[FieldElement; ENVELOPE_LENGTH]> {
        let mut envelope = [FieldElement::from_u64(0); ENVELOPE_LENGTH];
        for (index, chunk) in bytes.chunks_exact(32).enumerate() {
            envelope[index] =
                FieldElement::from_le_bytes(chunk.try_into().map_err(|_| Error::InvalidEnvelope)?)?;
        }
        Ok(envelope)
    }
}

fn authentication(
    shared_x: FieldElement,
    shared_y: FieldElement,
    nonce: FieldElement,
    output_index: u8,
    plaintext: &[FieldElement; 10],
) -> FieldElement {
    let mut preimage = Vec::with_capacity(15);
    preimage.extend_from_slice(&[
        FieldElement::from_u64(OUTPUT_AUTHENTICATION_TAG),
        shared_x,
        shared_y,
        nonce,
        FieldElement::from_u64(u64::from(output_index)),
    ]);
    preimage.extend_from_slice(plaintext);
    hash_fields(&preimage)
}

fn point_fields(point: BabyJubPoint) -> (FieldElement, FieldElement) {
    let (x, y) = point.to_le_bytes();
    (
        FieldElement::from_le_bytes(x).expect("validated BabyJub x"),
        FieldElement::from_le_bytes(y).expect("validated BabyJub y"),
    )
}

fn field_to_u64(field: FieldElement) -> Result<u64> {
    let bytes = field.to_le_bytes();
    if bytes[8..].iter().any(|byte| *byte != 0) {
        return Err(Error::InvalidNote);
    }
    Ok(u64::from_le_bytes(
        bytes[..8].try_into().map_err(|_| Error::InvalidNote)?,
    ))
}

#[cfg(test)]
mod tests {
    use core::str::FromStr;

    use ark_bn254::Fr;

    use super::*;
    use crate::{MasterEntropy, Network};

    fn decimal(value: &str) -> FieldElement {
        FieldElement::from_field(Fr::from_str(value).unwrap())
    }

    fn fixture_code() -> PaymentCode {
        let mut spend_secret = [0_u8; 32];
        spend_secret[0] = 201;
        let mut viewing_secret = [0_u8; 32];
        viewing_secret[0] = 202;
        let identity = MasterEntropy::from_bytes([1; 32])
            .unwrap()
            .derive_child(Network::Testnet, [1; 32], 0)
            .unwrap();
        PaymentCode::new(
            Network::Testnet,
            [1; 32],
            [1; 16],
            spend_public_key(spend_secret).unwrap(),
            BabyJubPoint::from_secret_le(viewing_secret).unwrap(),
            identity.request_signing_public_key(),
        )
        .unwrap()
    }

    #[test]
    fn encrypted_note_matches_existing_moros_circuit_fixture() {
        let mut ephemeral_secret = [0_u8; 32];
        ephemeral_secret[0] = 205;
        let output = EncryptedOutput::create(
            0,
            decimal(
                "15061940054069586892146587113092043501919762788956280541383856745298274144520",
            ),
            1,
            AtomicUsdc::new(300_000_000).unwrap().into(),
            &fixture_code(),
            FieldElement::from_u64(203),
            FieldElement::from_u64(0),
            [FieldElement::from_u64(0), FieldElement::from_u64(0)],
            FieldElement::from_u64(204),
            ephemeral_secret,
            FieldElement::from_u64(206),
        )
        .unwrap();

        assert_eq!(
            output.note.commitment,
            decimal("7206290583406135007587868065171036977624342938608908698996190661433640687997")
        );
        assert_eq!(
            output.envelope_hash,
            decimal("8890659883892898811822226283120783690799828287826559326293653317630482511872")
        );
        assert_eq!(
            output.envelope[4],
            decimal(
                "11802602197489685934078347154802911655467589376120367904732476314936679959726"
            )
        );
        assert_eq!(
            output.envelope[14],
            decimal(
                "21039878659605072022148054136145012879146405704752988570489364006658382346313"
            )
        );
    }

    #[test]
    fn recipient_decrypts_and_tampering_fails() {
        let code = fixture_code();
        let mut ephemeral_secret = [0_u8; 32];
        ephemeral_secret[0] = 11;
        let output = EncryptedOutput::create(
            2,
            FieldElement::from_u64(12),
            1,
            AtomicUsdc::new(1_000_000).unwrap().into(),
            &code,
            FieldElement::from_u64(13),
            FieldElement::from_u64(14),
            [FieldElement::from_u64(15), FieldElement::from_u64(16)],
            FieldElement::from_u64(17),
            ephemeral_secret,
            FieldElement::from_u64(18),
        )
        .unwrap();
        let mut viewing_secret = [0_u8; 32];
        viewing_secret[0] = 202;
        let decrypted = EncryptedOutput::decrypt(
            output.envelope,
            viewing_secret,
            &code,
            output.note.note_domain,
            Some(output.note.commitment),
        )
        .unwrap();
        assert_eq!(decrypted, output.note);

        let mut tampered = output.envelope;
        tampered[4] = FieldElement::from_field(tampered[4].0 + Fr::from(1_u64));
        assert_eq!(
            EncryptedOutput::decrypt(
                tampered,
                viewing_secret,
                &code,
                output.note.note_domain,
                None,
            ),
            Err(Error::EnvelopeAuthenticationFailed)
        );
    }

    #[test]
    fn envelope_binary_encoding_is_fixed_and_canonical() {
        let code = fixture_code();
        let mut ephemeral_secret = [0_u8; 32];
        ephemeral_secret[0] = 11;
        let output = EncryptedOutput::create(
            0,
            FieldElement::from_u64(12),
            1,
            AtomicUsdc::new(1).unwrap().into(),
            &code,
            FieldElement::from_u64(13),
            FieldElement::from_u64(0),
            [FieldElement::from_u64(0), FieldElement::from_u64(0)],
            FieldElement::from_u64(14),
            ephemeral_secret,
            FieldElement::from_u64(15),
        )
        .unwrap();
        let bytes = output.envelope_bytes();
        assert_eq!(bytes.len(), 480);
        assert_eq!(
            EncryptedOutput::envelope_from_bytes(bytes).unwrap(),
            output.envelope
        );
    }

    #[test]
    fn zero_value_padding_decrypts_but_cannot_be_spent() {
        let code = fixture_code();
        let mut ephemeral_secret = [0_u8; 32];
        ephemeral_secret[0] = 11;
        let output = EncryptedOutput::create(
            3,
            FieldElement::from_u64(12),
            1,
            PrivateNoteAmount::new(0).unwrap(),
            &code,
            FieldElement::from_u64(13),
            FieldElement::from_u64(0),
            [FieldElement::from_u64(0), FieldElement::from_u64(0)],
            FieldElement::from_u64(14),
            ephemeral_secret,
            FieldElement::from_u64(15),
        )
        .unwrap();
        let mut viewing_secret = [0_u8; 32];
        viewing_secret[0] = 202;
        let note = EncryptedOutput::decrypt(
            output.envelope,
            viewing_secret,
            &code,
            output.note.note_domain,
            Some(output.note.commitment),
        )
        .unwrap();
        assert!(note.amount.is_zero());
        assert_eq!(note.amount.spendable(), Err(Error::InvalidNote));
        let mut spend_secret = [0_u8; 32];
        spend_secret[0] = 201;
        assert_eq!(note.nullifier(spend_secret, 1), Err(Error::InvalidNote));
    }
}
