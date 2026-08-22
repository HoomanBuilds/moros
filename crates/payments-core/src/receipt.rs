use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

use crate::{
    AtomicUsdc, Error, FieldElement, PrivateNote, Result, SignedPaymentRequest,
    cbor::{Decoder, Encoder},
};

pub const PAYMENT_RECEIPT_PREFIX: &str = "moros_receipt_";
const RECEIPT_VERSION: u64 = 1;
const RECEIPT_FIELDS: u64 = 8;
const MAX_RECEIPT_BYTES: usize = 3_072;
const MAX_SIGNED_REQUEST_BYTES: usize = 2_048;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentReceipt {
    pub request: SignedPaymentRequest,
    pub transaction_hash: [u8; 32],
    pub ledger: u32,
    pub output_commitment: FieldElement,
    pub amount: AtomicUsdc,
    pub confirmed_at: u64,
}

impl PaymentReceipt {
    pub fn new(
        request: SignedPaymentRequest,
        transaction_hash: [u8; 32],
        ledger: u32,
        output_commitment: FieldElement,
        amount: AtomicUsdc,
        confirmed_at: u64,
    ) -> Result<Self> {
        let receipt = Self {
            request,
            transaction_hash,
            ledger,
            output_commitment,
            amount,
            confirmed_at,
        };
        receipt.validate()?;
        Ok(receipt)
    }

    pub fn verify_note(&self, note: &PrivateNote) -> Result<()> {
        self.validate()?;
        if note.commitment != self.output_commitment
            || note.amount.atomic() != self.amount.atomic()
            || note.payload_hash != self.request.payload_hash()?
        {
            return Err(Error::InvalidReceipt);
        }
        Ok(())
    }

    pub fn encode(&self) -> Result<String> {
        self.validate()?;
        let request = self.request.encode()?;
        let mut encoder = Encoder::new();
        encoder.map(RECEIPT_FIELDS);
        encoder.unsigned(0);
        encoder.unsigned(RECEIPT_VERSION);
        encoder.unsigned(1);
        encoder.bytes(&request);
        encoder.unsigned(2);
        encoder.bytes(&self.transaction_hash);
        encoder.unsigned(3);
        encoder.unsigned(u64::from(self.ledger));
        encoder.unsigned(4);
        encoder.bytes(&self.output_commitment.to_be_bytes());
        encoder.unsigned(5);
        encoder.bytes(&(self.amount.atomic() as u128).to_be_bytes());
        encoder.unsigned(6);
        encoder.unsigned(self.confirmed_at);
        encoder.unsigned(7);
        encoder.unsigned(1);
        let encoded = encoder.finish();
        if encoded.len() > MAX_RECEIPT_BYTES {
            return Err(Error::InvalidReceipt);
        }
        Ok(format!(
            "{PAYMENT_RECEIPT_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(encoded)
        ))
    }

    pub fn decode(encoded: &str) -> Result<Self> {
        let payload = encoded
            .strip_prefix(PAYMENT_RECEIPT_PREFIX)
            .ok_or(Error::InvalidReceipt)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| Error::InvalidReceipt)?;
        if URL_SAFE_NO_PAD.encode(&bytes) != payload || bytes.len() > MAX_RECEIPT_BYTES {
            return Err(Error::InvalidReceipt);
        }
        let mut decoder = Decoder::new(&bytes);
        if decoder.map().map_err(receipt_error)? != RECEIPT_FIELDS {
            return Err(Error::InvalidReceipt);
        }
        expected_key(&mut decoder, 0)?;
        if decoder.unsigned().map_err(receipt_error)? != RECEIPT_VERSION {
            return Err(Error::InvalidReceipt);
        }
        expected_key(&mut decoder, 1)?;
        let request = SignedPaymentRequest::decode(
            decoder
                .bytes(MAX_SIGNED_REQUEST_BYTES)
                .map_err(receipt_error)?,
        )?;
        expected_key(&mut decoder, 2)?;
        let transaction_hash = array(decoder.bytes(32).map_err(receipt_error)?)?;
        expected_key(&mut decoder, 3)?;
        let ledger = u32::try_from(decoder.unsigned().map_err(receipt_error)?)
            .map_err(|_| Error::InvalidReceipt)?;
        expected_key(&mut decoder, 4)?;
        let output_commitment =
            FieldElement::from_be_bytes(array(decoder.bytes(32).map_err(receipt_error)?)?)
                .map_err(|_| Error::InvalidReceipt)?;
        expected_key(&mut decoder, 5)?;
        let amount = AtomicUsdc::new(i128::from_be_bytes(array(
            decoder.bytes(16).map_err(receipt_error)?,
        )?))?;
        expected_key(&mut decoder, 6)?;
        let confirmed_at = decoder.unsigned().map_err(receipt_error)?;
        expected_key(&mut decoder, 7)?;
        if decoder.unsigned().map_err(receipt_error)? != 1 {
            return Err(Error::InvalidReceipt);
        }
        decoder.finish().map_err(receipt_error)?;
        let receipt = Self::new(
            request,
            transaction_hash,
            ledger,
            output_commitment,
            amount,
            confirmed_at,
        )?;
        if receipt.encode()? != encoded {
            return Err(Error::InvalidReceipt);
        }
        Ok(receipt)
    }

    fn validate(&self) -> Result<()> {
        if self.transaction_hash == [0; 32]
            || self.ledger == 0
            || self.output_commitment.is_zero()
            || self.confirmed_at == 0
            || self
                .request
                .request
                .amount
                .is_some_and(|required| required != self.amount)
        {
            return Err(Error::InvalidReceipt);
        }
        self.request.payload_hash()?;
        Ok(())
    }
}

fn expected_key(decoder: &mut Decoder<'_>, expected: u64) -> Result<()> {
    if decoder.unsigned().map_err(receipt_error)? != expected {
        return Err(Error::InvalidReceipt);
    }
    Ok(())
}

fn array<const LENGTH: usize>(bytes: &[u8]) -> Result<[u8; LENGTH]> {
    bytes.try_into().map_err(|_| Error::InvalidReceipt)
}

fn receipt_error(_: Error) -> Error {
    Error::InvalidReceipt
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MasterEntropy, Network, PaymentRequest, PrivateNoteAmount};

    fn fixture(open: bool) -> (PaymentReceipt, PrivateNote) {
        let identity = MasterEntropy::from_bytes([61; 32])
            .unwrap()
            .derive_child(Network::Testnet, [7; 32], 2)
            .unwrap();
        let amount = AtomicUsdc::new(15_000_000).unwrap();
        let request = PaymentRequest::new(
            identity.payment_code().unwrap(),
            [9; 32],
            if open { None } else { Some(amount) },
            [8; 16],
            1_000,
            1_600,
            Some("Moros merchant".to_owned()),
            None,
        )
        .unwrap();
        let request = SignedPaymentRequest::sign(request, &identity).unwrap();
        let note = PrivateNote::new(
            FieldElement::from_u64(71),
            1,
            PrivateNoteAmount::from(amount),
            FieldElement::from_le_bytes(identity.payment_code().unwrap().spend_public_key).unwrap(),
            identity.payment_code().unwrap().viewing_public_key,
            FieldElement::from_u64(73),
            request.payload_hash().unwrap(),
            [FieldElement::from_u64(0), FieldElement::from_u64(0)],
            FieldElement::from_u64(79),
        )
        .unwrap();
        let receipt =
            PaymentReceipt::new(request, [5; 32], 500, note.commitment, amount, 1_200).unwrap();
        (receipt, note)
    }

    #[test]
    fn receipt_round_trip_verifies_the_private_output() {
        for open in [false, true] {
            let (receipt, note) = fixture(open);
            receipt.verify_note(&note).unwrap();
            let encoded = receipt.encode().unwrap();
            let decoded = PaymentReceipt::decode(&encoded).unwrap();
            assert_eq!(decoded, receipt);
            decoded.verify_note(&note).unwrap();
        }
    }

    #[test]
    fn receipt_rejects_tampering_wrong_amount_and_wrong_note() {
        let (receipt, mut note) = fixture(false);
        let mut encoded = receipt.encode().unwrap().into_bytes();
        let index = encoded.len() - 2;
        encoded[index] = if encoded[index] == b'A' { b'B' } else { b'A' };
        assert!(PaymentReceipt::decode(core::str::from_utf8(&encoded).unwrap()).is_err());

        note.payload_hash = FieldElement::from_u64(1);
        assert_eq!(receipt.verify_note(&note), Err(Error::InvalidReceipt));

        let (receipt, _) = fixture(false);
        assert_eq!(
            PaymentReceipt::new(
                receipt.request,
                [5; 32],
                500,
                receipt.output_commitment,
                AtomicUsdc::new(14_999_999).unwrap(),
                1_200,
            ),
            Err(Error::InvalidReceipt)
        );
    }
}
