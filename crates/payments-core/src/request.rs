use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::Digest;

use crate::{
    AtomicUsdc, ChildIdentity, Error, FieldElement, Network, PaymentCode, PaymentCodeExpectation,
    Result,
    cbor::{Decoder, Encoder},
    poseidon::hash_fields,
};

pub const PAYMENT_LINK_PREFIX: &str = "https://pay.moros.fun/pay#";
const REQUEST_FORMAT_VERSION: u8 = 1;
const REQUEST_BODY_FIELDS: u64 = 9;
const REQUEST_ENVELOPE_FIELDS: u64 = 2;
const MAX_REQUEST_BYTES: usize = 2_048;
const MAX_PAYMENT_CODE_BYTES: usize = 256;
const MAX_MERCHANT_LABEL_BYTES: usize = 64;
const ENCRYPTED_CONTEXT_BYTES: usize = 128;
const MAX_REQUEST_LIFETIME_SECONDS: u64 = 30 * 24 * 60 * 60;
const REQUEST_SIGNATURE_DOMAIN: &[u8] = b"moros/payment-request/signature/v1";
const REQUEST_PAYLOAD_TAG: u64 = 1113;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentRequest {
    pub receiver: PaymentCode,
    pub asset: [u8; 32],
    pub amount: Option<AtomicUsdc>,
    pub request_id: [u8; 16],
    pub created_at: u64,
    pub expires_at: u64,
    pub merchant_label: Option<String>,
    pub encrypted_context: Option<[u8; ENCRYPTED_CONTEXT_BYTES]>,
}

impl PaymentRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        receiver: PaymentCode,
        asset: [u8; 32],
        amount: Option<AtomicUsdc>,
        request_id: [u8; 16],
        created_at: u64,
        expires_at: u64,
        merchant_label: Option<String>,
        encrypted_context: Option<[u8; ENCRYPTED_CONTEXT_BYTES]>,
    ) -> Result<Self> {
        let request = Self {
            receiver,
            asset,
            amount,
            request_id,
            created_at,
            expires_at,
            merchant_label,
            encrypted_context,
        };
        request.validate_shape()?;
        Ok(request)
    }

    fn validate_shape(&self) -> Result<()> {
        if self.asset == [0; 32] || self.request_id == [0; 16] || self.created_at == 0 {
            return Err(Error::InvalidRequestEncoding);
        }
        let lifetime = self
            .expires_at
            .checked_sub(self.created_at)
            .ok_or(Error::InvalidRequestLifetime)?;
        if lifetime == 0 || lifetime > MAX_REQUEST_LIFETIME_SECONDS {
            return Err(Error::InvalidRequestLifetime);
        }
        if self
            .merchant_label
            .as_ref()
            .is_some_and(|label| label.len() > MAX_MERCHANT_LABEL_BYTES)
        {
            return Err(Error::MerchantLabelTooLong);
        }
        Ok(())
    }

    fn canonical_body(&self) -> Result<Vec<u8>> {
        self.validate_shape()?;
        let mut encoder = Encoder::new();
        encoder.map(REQUEST_BODY_FIELDS);
        encoder.unsigned(0);
        encoder.unsigned(u64::from(REQUEST_FORMAT_VERSION));
        encoder.unsigned(1);
        encoder.bytes(&self.receiver.canonical_bytes()?);
        encoder.unsigned(2);
        encoder.bytes(&self.asset);
        encoder.unsigned(3);
        match self.amount {
            Some(amount) => encoder.bytes(&(amount.atomic() as u128).to_be_bytes()),
            None => encoder.null(),
        }
        encoder.unsigned(4);
        encoder.bytes(&self.request_id);
        encoder.unsigned(5);
        encoder.unsigned(self.created_at);
        encoder.unsigned(6);
        encoder.unsigned(self.expires_at);
        encoder.unsigned(7);
        match &self.merchant_label {
            Some(label) => encoder.text(label),
            None => encoder.null(),
        }
        encoder.unsigned(8);
        match self.encrypted_context {
            Some(context) => encoder.bytes(&context),
            None => encoder.null(),
        }
        Ok(encoder.finish())
    }

    fn from_canonical_body(bytes: &[u8]) -> Result<Self> {
        let mut decoder = Decoder::new(bytes);
        if decoder.map()? != REQUEST_BODY_FIELDS {
            return Err(Error::InvalidRequestEncoding);
        }
        expected_key(&mut decoder, 0)?;
        if decoder.unsigned()? != u64::from(REQUEST_FORMAT_VERSION) {
            return Err(Error::UnsupportedProtocolVersion);
        }
        expected_key(&mut decoder, 1)?;
        let receiver = PaymentCode::from_canonical_bytes(decoder.bytes(MAX_PAYMENT_CODE_BYTES)?)?;
        expected_key(&mut decoder, 2)?;
        let asset = array(decoder.bytes(32)?)?;
        expected_key(&mut decoder, 3)?;
        let amount = if decoder.is_null() {
            decoder.null()?;
            None
        } else {
            let atomic = i128::from_be_bytes(array(decoder.bytes(16)?)?);
            Some(AtomicUsdc::new(atomic)?)
        };
        expected_key(&mut decoder, 4)?;
        let request_id = array(decoder.bytes(16)?)?;
        expected_key(&mut decoder, 5)?;
        let created_at = decoder.unsigned()?;
        expected_key(&mut decoder, 6)?;
        let expires_at = decoder.unsigned()?;
        expected_key(&mut decoder, 7)?;
        let merchant_label = if decoder.is_null() {
            decoder.null()?;
            None
        } else {
            Some(decoder.text(MAX_MERCHANT_LABEL_BYTES)?.to_owned())
        };
        expected_key(&mut decoder, 8)?;
        let encrypted_context = if decoder.is_null() {
            decoder.null()?;
            None
        } else {
            Some(array(decoder.bytes(ENCRYPTED_CONTEXT_BYTES)?)?)
        };
        decoder.finish()?;

        let request = Self::new(
            receiver,
            asset,
            amount,
            request_id,
            created_at,
            expires_at,
            merchant_label,
            encrypted_context,
        )?;
        if request.canonical_body()? != bytes {
            return Err(Error::InvalidRequestEncoding);
        }
        Ok(request)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaymentRequestPolicy {
    pub now: u64,
    pub maximum_clock_skew_seconds: u64,
    pub network: Network,
    pub vault: [u8; 32],
    pub asset: [u8; 32],
    pub maximum_amount: i128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedPaymentRequest {
    pub request: PaymentRequest,
    signature: [u8; 64],
}

impl SignedPaymentRequest {
    pub fn sign(request: PaymentRequest, identity: &ChildIdentity) -> Result<Self> {
        if identity.request_signing_public_key() != request.receiver.request_signing_public_key {
            return Err(Error::InvalidRequestSignature);
        }
        let body = request.canonical_body()?;
        let signature = identity.sign(&signature_preimage(&body)).to_bytes();
        Ok(Self { request, signature })
    }

    pub fn encode(&self) -> Result<Vec<u8>> {
        let body = self.request.canonical_body()?;
        let mut encoder = Encoder::new();
        encoder.map(REQUEST_ENVELOPE_FIELDS);
        encoder.unsigned(0);
        encoder.bytes(&body);
        encoder.unsigned(1);
        encoder.bytes(&self.signature);
        let encoded = encoder.finish();
        if encoded.len() > MAX_REQUEST_BYTES {
            return Err(Error::RequestTooLarge);
        }
        Ok(encoded)
    }

    pub fn decode(encoded: &[u8]) -> Result<Self> {
        if encoded.len() > MAX_REQUEST_BYTES {
            return Err(Error::RequestTooLarge);
        }
        let mut decoder = Decoder::new(encoded);
        if decoder.map()? != REQUEST_ENVELOPE_FIELDS {
            return Err(Error::InvalidRequestEncoding);
        }
        expected_key(&mut decoder, 0)?;
        let body = decoder.bytes(MAX_REQUEST_BYTES)?.to_vec();
        expected_key(&mut decoder, 1)?;
        let signature = array(decoder.bytes(64)?)?;
        decoder.finish()?;

        let request = PaymentRequest::from_canonical_body(&body)?;
        let signed = Self { request, signature };
        signed.verify_signature()?;
        if signed.encode()? != encoded {
            return Err(Error::InvalidRequestEncoding);
        }
        Ok(signed)
    }

    pub fn payment_link(&self) -> Result<String> {
        Ok(format!(
            "{PAYMENT_LINK_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(self.encode()?)
        ))
    }

    pub fn payload_hash(&self) -> Result<FieldElement> {
        let digest = sha2::Sha256::digest(self.encode()?);
        Ok(hash_fields(&[
            FieldElement::from_u64(REQUEST_PAYLOAD_TAG),
            FieldElement::from_u64(u64::from_be_bytes(digest[..8].try_into().unwrap())),
            FieldElement::from_u64(u64::from_be_bytes(digest[8..16].try_into().unwrap())),
            FieldElement::from_u64(u64::from_be_bytes(digest[16..24].try_into().unwrap())),
            FieldElement::from_u64(u64::from_be_bytes(digest[24..].try_into().unwrap())),
        ]))
    }

    pub fn from_payment_link(link: &str) -> Result<Self> {
        let fragment = link
            .strip_prefix(PAYMENT_LINK_PREFIX)
            .ok_or(Error::InvalidRequestEncoding)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(fragment)
            .map_err(|_| Error::InvalidRequestEncoding)?;
        if URL_SAFE_NO_PAD.encode(&bytes) != fragment {
            return Err(Error::InvalidRequestEncoding);
        }
        Self::decode(&bytes)
    }

    pub fn validate(&self, policy: PaymentRequestPolicy) -> Result<()> {
        self.verify_signature()?;
        self.request.receiver.validate_for(PaymentCodeExpectation {
            network: policy.network,
            vault: policy.vault,
        })?;
        if self.request.asset != policy.asset {
            return Err(Error::AssetMismatch);
        }
        if policy.maximum_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if self
            .request
            .amount
            .is_some_and(|amount| amount.atomic() > policy.maximum_amount)
        {
            return Err(Error::AmountOverflow);
        }
        if self.request.expires_at <= policy.now {
            return Err(Error::RequestExpired);
        }
        if self.request.created_at > policy.now.saturating_add(policy.maximum_clock_skew_seconds) {
            return Err(Error::RequestCreatedInFuture);
        }
        self.request.validate_shape()
    }

    fn verify_signature(&self) -> Result<()> {
        let verifying_key =
            VerifyingKey::from_bytes(&self.request.receiver.request_signing_public_key)
                .map_err(|_| Error::InvalidRequestSignature)?;
        let signature = Signature::from_bytes(&self.signature);
        verifying_key
            .verify_strict(
                &signature_preimage(&self.request.canonical_body()?),
                &signature,
            )
            .map_err(|_| Error::InvalidRequestSignature)
    }
}

fn expected_key(decoder: &mut Decoder<'_>, key: u64) -> Result<()> {
    if decoder.unsigned()? != key {
        return Err(Error::InvalidRequestEncoding);
    }
    Ok(())
}

fn array<const LENGTH: usize>(bytes: &[u8]) -> Result<[u8; LENGTH]> {
    bytes.try_into().map_err(|_| Error::InvalidRequestEncoding)
}

fn signature_preimage(body: &[u8]) -> Vec<u8> {
    let mut preimage = Vec::with_capacity(REQUEST_SIGNATURE_DOMAIN.len() + body.len());
    preimage.extend_from_slice(REQUEST_SIGNATURE_DOMAIN);
    preimage.extend_from_slice(body);
    preimage
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MasterEntropy;

    fn fixture() -> (ChildIdentity, PaymentRequest) {
        let identity = MasterEntropy::from_bytes([5; 32])
            .unwrap()
            .derive_child(Network::Testnet, [7; 32], 8)
            .unwrap();
        let code = identity.payment_code().unwrap();
        let request = PaymentRequest::new(
            code,
            [6; 32],
            Some(AtomicUsdc::new(12_500_000).unwrap()),
            [4; 16],
            1_000,
            1_600,
            Some("Moros merchant".to_owned()),
            Some([3; ENCRYPTED_CONTEXT_BYTES]),
        )
        .unwrap();
        (identity, request)
    }

    fn policy() -> PaymentRequestPolicy {
        PaymentRequestPolicy {
            now: 1_200,
            maximum_clock_skew_seconds: 60,
            network: Network::Testnet,
            vault: [7; 32],
            asset: [6; 32],
            maximum_amount: 100_000_000,
        }
    }

    #[test]
    fn signed_request_and_link_round_trip() {
        let (identity, request) = fixture();
        let signed = SignedPaymentRequest::sign(request, &identity).unwrap();
        signed.validate(policy()).unwrap();
        let encoded = signed.encode().unwrap();
        assert_eq!(SignedPaymentRequest::decode(&encoded).unwrap(), signed);
        let link = signed.payment_link().unwrap();
        assert!(link.starts_with(PAYMENT_LINK_PREFIX));
        assert_eq!(
            SignedPaymentRequest::from_payment_link(&link).unwrap(),
            signed
        );
    }

    #[test]
    fn rejects_tampering_and_noncanonical_data() {
        let (identity, request) = fixture();
        let signed = SignedPaymentRequest::sign(request, &identity).unwrap();
        let mut encoded = signed.encode().unwrap();
        let last = encoded.len() - 1;
        encoded[last] ^= 1;
        assert_eq!(
            SignedPaymentRequest::decode(&encoded),
            Err(Error::InvalidRequestSignature)
        );

        let mut encoded = signed.encode().unwrap();
        encoded.push(0);
        assert_eq!(
            SignedPaymentRequest::decode(&encoded),
            Err(Error::InvalidRequestEncoding)
        );
    }

    #[test]
    fn enforces_environment_expiry_skew_and_amount() {
        let (identity, request) = fixture();
        let signed = SignedPaymentRequest::sign(request, &identity).unwrap();

        let mut wrong_network = policy();
        wrong_network.network = Network::Mainnet;
        assert_eq!(signed.validate(wrong_network), Err(Error::NetworkMismatch));

        let mut expired = policy();
        expired.now = 1_600;
        assert_eq!(signed.validate(expired), Err(Error::RequestExpired));

        let mut limited = policy();
        limited.maximum_amount = 12_499_999;
        assert_eq!(signed.validate(limited), Err(Error::AmountOverflow));

        let (identity, mut future_request) = fixture();
        future_request.created_at = 1_300;
        future_request.expires_at = 1_900;
        let future = SignedPaymentRequest::sign(future_request, &identity).unwrap();
        assert_eq!(
            future.validate(policy()),
            Err(Error::RequestCreatedInFuture)
        );
    }

    #[test]
    fn supports_open_amount_requests() {
        let (identity, mut request) = fixture();
        request.amount = None;
        let signed = SignedPaymentRequest::sign(request, &identity).unwrap();
        signed.validate(policy()).unwrap();
        assert_eq!(
            SignedPaymentRequest::decode(&signed.encode().unwrap())
                .unwrap()
                .request
                .amount,
            None
        );
    }

    #[test]
    fn rejects_long_labels_and_invalid_lifetimes() {
        let (_, request) = fixture();
        assert_eq!(
            PaymentRequest::new(
                request.receiver.clone(),
                request.asset,
                request.amount,
                request.request_id,
                1_000,
                1_000,
                None,
                None,
            ),
            Err(Error::InvalidRequestLifetime)
        );
        assert_eq!(
            PaymentRequest::new(
                request.receiver,
                request.asset,
                request.amount,
                request.request_id,
                1_000,
                1_600,
                Some("a".repeat(65)),
                None,
            ),
            Err(Error::MerchantLabelTooLong)
        );
    }
}
