use core::str::FromStr;

use moros_payments_core::{
    ARCHIVE_PAGE_BYTES, ArchiveIdentity, AtomicUsdc, ChildIdentity, EncryptedArchivePage,
    EncryptedAttachment as CoreEncryptedAttachment, EncryptedOutput as CoreEncryptedOutput,
    FieldElement, MasterEntropy, Network, PaymentCode, PaymentRequest, PaymentRequestPolicy,
    PrivateNote, PrivateNoteAmount, SignedPaymentRequest,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PaymentIdentity {
    child: ChildIdentity,
}

#[wasm_bindgen]
pub struct PaymentArchiveIdentity {
    archive: ArchiveIdentity,
}

#[wasm_bindgen]
impl PaymentArchiveIdentity {
    #[wasm_bindgen(getter)]
    pub fn locator(&self) -> Vec<u8> {
        self.archive.locator().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn signing_public_key(&self) -> Vec<u8> {
        self.archive.signing_public_key().to_vec()
    }

    pub fn sign_challenge(&self, challenge: Vec<u8>, expires_at: u64) -> Result<Vec<u8>, JsError> {
        Ok(self
            .archive
            .sign_challenge(array(&challenge, "sync challenge")?, expires_at)
            .to_vec())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn encrypt_page(
        &self,
        epoch: u64,
        generation: u64,
        page: u32,
        previous_hash: Vec<u8>,
        nonce: Vec<u8>,
        content: Vec<u8>,
    ) -> Result<Vec<u8>, JsError> {
        self.archive
            .encrypt_page(
                epoch,
                generation,
                page,
                array(&previous_hash, "previous page hash")?,
                array(&nonce, "archive nonce")?,
                &content,
            )
            .map(|encrypted| encrypted.encode().to_vec())
            .map_err(js_error)
    }

    pub fn decrypt_page(&self, encoded: Vec<u8>) -> Result<Vec<u8>, JsError> {
        let encrypted = EncryptedArchivePage::decode(array::<ARCHIVE_PAGE_BYTES>(
            &encoded,
            "encrypted archive page",
        )?)
        .map_err(js_error)?;
        self.archive.decrypt_page(&encrypted).map_err(js_error)
    }
}

#[wasm_bindgen]
impl PaymentIdentity {
    #[wasm_bindgen(getter)]
    pub fn payment_code(&self) -> Result<String, JsError> {
        self.child
            .payment_code()
            .and_then(|code| code.encode())
            .map_err(js_error)
    }

    #[wasm_bindgen(getter)]
    pub fn recipient_fingerprint(&self) -> Result<String, JsError> {
        self.child
            .payment_code()
            .and_then(|code| code.fingerprint())
            .map_err(js_error)
    }

    pub fn spend_secret(&self) -> Vec<u8> {
        self.child.spend_secret_le().to_vec()
    }

    pub fn viewing_secret(&self) -> Vec<u8> {
        self.child.viewing_secret_le().to_vec()
    }

    pub fn request_signing_public_key(&self) -> Vec<u8> {
        self.child.request_signing_public_key().to_vec()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_payment_link(
        &self,
        asset: Vec<u8>,
        amount: Option<String>,
        request_id: Vec<u8>,
        created_at: u64,
        expires_at: u64,
        merchant_label: Option<String>,
        encrypted_context: Option<Vec<u8>>,
    ) -> Result<String, JsError> {
        let receiver = self.child.payment_code().map_err(js_error)?;
        let amount = amount
            .map(|value| AtomicUsdc::from_str(&value).map_err(js_error))
            .transpose()?;
        let encrypted_context = encrypted_context
            .map(|value| array::<128>(&value, "encrypted context"))
            .transpose()?;
        let request = PaymentRequest::new(
            receiver,
            array(&asset, "asset identifier")?,
            amount,
            array(&request_id, "request identifier")?,
            created_at,
            expires_at,
            merchant_label,
            encrypted_context,
        )
        .map_err(js_error)?;
        SignedPaymentRequest::sign(request, &self.child)
            .and_then(|signed| signed.payment_link())
            .map_err(js_error)
    }
}

#[wasm_bindgen]
pub struct VerifiedPaymentRequest {
    signed: SignedPaymentRequest,
}

#[wasm_bindgen]
pub struct EncryptedPaymentOutput {
    output: CoreEncryptedOutput,
}

#[wasm_bindgen]
impl EncryptedPaymentOutput {
    #[wasm_bindgen(getter)]
    pub fn commitment(&self) -> Vec<u8> {
        self.output.note.commitment.to_be_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn envelope_hash(&self) -> Vec<u8> {
        self.output.envelope_hash.to_be_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn envelope(&self) -> Vec<u8> {
        self.output.envelope_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn amount_atomic(&self) -> String {
        self.output.note.amount.atomic().to_string()
    }
}

#[wasm_bindgen]
pub struct DecryptedPaymentNote {
    note: PrivateNote,
}

#[wasm_bindgen]
impl DecryptedPaymentNote {
    #[wasm_bindgen(getter)]
    pub fn purpose(&self) -> u64 {
        self.note.purpose
    }

    #[wasm_bindgen(getter)]
    pub fn amount_atomic(&self) -> String {
        self.note.amount.atomic().to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn commitment(&self) -> Vec<u8> {
        self.note.commitment.to_be_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn spend_public_key(&self) -> Vec<u8> {
        self.note.spend_public_key.to_be_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn viewing_public_key(&self) -> Vec<u8> {
        point_bytes(self.note.viewing_public_key)
    }

    #[wasm_bindgen(getter)]
    pub fn note_id(&self) -> Vec<u8> {
        self.note.note_id.to_be_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn payload_hash(&self) -> Vec<u8> {
        self.note.payload_hash.to_be_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn private_data(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(64);
        bytes.extend_from_slice(&self.note.private_data[0].to_be_bytes());
        bytes.extend_from_slice(&self.note.private_data[1].to_be_bytes());
        bytes
    }

    #[wasm_bindgen(getter)]
    pub fn blinding(&self) -> Vec<u8> {
        self.note.blinding.to_be_bytes().to_vec()
    }
}

#[wasm_bindgen]
pub struct EncryptedPaymentAttachment {
    attachment: CoreEncryptedAttachment,
}

#[wasm_bindgen]
impl EncryptedPaymentAttachment {
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.attachment.to_bytes().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn hash(&self) -> Vec<u8> {
        self.attachment.hash.to_be_bytes().to_vec()
    }
}

#[wasm_bindgen]
impl VerifiedPaymentRequest {
    #[wasm_bindgen(getter)]
    pub fn payment_code(&self) -> Result<String, JsError> {
        self.signed.request.receiver.encode().map_err(js_error)
    }

    #[wasm_bindgen(getter)]
    pub fn recipient_fingerprint(&self) -> Result<String, JsError> {
        self.signed.request.receiver.fingerprint().map_err(js_error)
    }

    #[wasm_bindgen(getter)]
    pub fn amount(&self) -> Option<String> {
        self.signed.request.amount.map(|amount| amount.to_string())
    }

    #[wasm_bindgen(getter)]
    pub fn request_id(&self) -> Vec<u8> {
        self.signed.request.request_id.to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn created_at(&self) -> u64 {
        self.signed.request.created_at
    }

    #[wasm_bindgen(getter)]
    pub fn expires_at(&self) -> u64 {
        self.signed.request.expires_at
    }

    #[wasm_bindgen(getter)]
    pub fn merchant_label(&self) -> Option<String> {
        self.signed.request.merchant_label.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn encrypted_context(&self) -> Option<Vec<u8>> {
        self.signed
            .request
            .encrypted_context
            .map(|context| context.to_vec())
    }
}

#[wasm_bindgen]
pub fn recovery_phrase_from_entropy(entropy: Vec<u8>) -> Result<String, JsError> {
    MasterEntropy::from_bytes(array(&entropy, "master entropy")?)
        .map_err(js_error)?
        .recovery_phrase()
        .map_err(js_error)
}

#[wasm_bindgen]
pub fn payment_identity_from_entropy(
    entropy: Vec<u8>,
    network: u8,
    vault: Vec<u8>,
    child_index: u64,
) -> Result<PaymentIdentity, JsError> {
    derive_identity(
        MasterEntropy::from_bytes(array(&entropy, "master entropy")?).map_err(js_error)?,
        network,
        vault,
        child_index,
    )
}

#[wasm_bindgen]
pub fn payment_identity_from_phrase(
    recovery_phrase: &str,
    network: u8,
    vault: Vec<u8>,
    child_index: u64,
) -> Result<PaymentIdentity, JsError> {
    derive_identity(
        MasterEntropy::from_recovery_phrase(recovery_phrase).map_err(js_error)?,
        network,
        vault,
        child_index,
    )
}

#[wasm_bindgen]
pub fn payment_archive_from_entropy(
    entropy: Vec<u8>,
    network: u8,
    vault: Vec<u8>,
) -> Result<PaymentArchiveIdentity, JsError> {
    derive_archive(
        MasterEntropy::from_bytes(array(&entropy, "master entropy")?).map_err(js_error)?,
        network,
        vault,
    )
}

#[wasm_bindgen]
pub fn payment_archive_from_phrase(
    recovery_phrase: &str,
    network: u8,
    vault: Vec<u8>,
) -> Result<PaymentArchiveIdentity, JsError> {
    derive_archive(
        MasterEntropy::from_recovery_phrase(recovery_phrase).map_err(js_error)?,
        network,
        vault,
    )
}

#[wasm_bindgen]
pub fn parse_usdc_amount(display: &str) -> Result<String, JsError> {
    AtomicUsdc::from_str(display)
        .map(|amount| amount.atomic().to_string())
        .map_err(js_error)
}

#[wasm_bindgen]
pub fn format_usdc_amount(atomic: &str) -> Result<String, JsError> {
    atomic
        .parse::<i128>()
        .map_err(|_| JsError::new("invalid atomic USDC amount"))
        .and_then(|value| AtomicUsdc::new(value).map_err(js_error))
        .map(|amount| amount.to_string())
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn verify_payment_link(
    link: &str,
    now: u64,
    maximum_clock_skew_seconds: u64,
    network: u8,
    vault: Vec<u8>,
    asset: Vec<u8>,
    maximum_amount: &str,
) -> Result<VerifiedPaymentRequest, JsError> {
    let signed = SignedPaymentRequest::from_payment_link(link).map_err(js_error)?;
    let policy = PaymentRequestPolicy {
        now,
        maximum_clock_skew_seconds,
        network: Network::try_from(network).map_err(js_error)?,
        vault: array(&vault, "vault identifier")?,
        asset: array(&asset, "asset identifier")?,
        maximum_amount: maximum_amount
            .parse::<i128>()
            .map_err(|_| JsError::new("invalid maximum atomic USDC amount"))?,
    };
    signed.validate(policy).map_err(js_error)?;
    Ok(VerifiedPaymentRequest { signed })
}

#[wasm_bindgen]
pub fn payment_code_fingerprint(encoded: &str) -> Result<String, JsError> {
    PaymentCode::decode(encoded)
        .and_then(|code| code.fingerprint())
        .map_err(js_error)
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn create_payment_output(
    recipient_code: &str,
    output_index: u8,
    note_domain: Vec<u8>,
    amount_atomic: &str,
    note_id: Vec<u8>,
    payload_hash: Vec<u8>,
    private_data: Vec<u8>,
    blinding: Vec<u8>,
    ephemeral_secret: Vec<u8>,
    nonce: Vec<u8>,
) -> Result<EncryptedPaymentOutput, JsError> {
    let recipient = PaymentCode::decode(recipient_code).map_err(js_error)?;
    let private_data: [u8; 64] = array(&private_data, "private data")?;
    let amount = amount_atomic
        .parse::<i128>()
        .map_err(|_| JsError::new("invalid atomic USDC amount"))
        .and_then(|value| PrivateNoteAmount::new(value).map_err(js_error))?;
    let output = CoreEncryptedOutput::create(
        output_index,
        field(&note_domain, "note domain")?,
        1,
        amount,
        &recipient,
        field(&note_id, "note identifier")?,
        field(&payload_hash, "payload hash")?,
        [
            FieldElement::from_be_bytes(private_data[..32].try_into().unwrap())
                .map_err(js_error)?,
            FieldElement::from_be_bytes(private_data[32..].try_into().unwrap())
                .map_err(js_error)?,
        ],
        field(&blinding, "blinding")?,
        array(&ephemeral_secret, "ephemeral secret")?,
        field(&nonce, "nonce")?,
    )
    .map_err(js_error)?;
    Ok(EncryptedPaymentOutput { output })
}

#[wasm_bindgen]
pub fn decrypt_payment_output(
    envelope: Vec<u8>,
    viewing_secret: Vec<u8>,
    recipient_code: &str,
    note_domain: Vec<u8>,
    expected_commitment: Option<Vec<u8>>,
) -> Result<DecryptedPaymentNote, JsError> {
    let recipient = PaymentCode::decode(recipient_code).map_err(js_error)?;
    let envelope = CoreEncryptedOutput::envelope_from_bytes(array(&envelope, "encrypted output")?)
        .map_err(js_error)?;
    let expected_commitment = expected_commitment
        .map(|value| field(&value, "expected commitment"))
        .transpose()?;
    let note = CoreEncryptedOutput::decrypt(
        envelope,
        array(&viewing_secret, "viewing secret")?,
        &recipient,
        field(&note_domain, "note domain")?,
        expected_commitment,
    )
    .map_err(js_error)?;
    Ok(DecryptedPaymentNote { note })
}

#[wasm_bindgen]
pub fn create_payment_attachment(
    memo: &str,
    recipient_code: &str,
    ephemeral_secret: Vec<u8>,
    nonce: Vec<u8>,
) -> Result<EncryptedPaymentAttachment, JsError> {
    let recipient = PaymentCode::decode(recipient_code).map_err(js_error)?;
    let attachment = CoreEncryptedAttachment::create(
        memo,
        &recipient,
        array(&ephemeral_secret, "ephemeral secret")?,
        field(&nonce, "nonce")?,
    )
    .map_err(js_error)?;
    Ok(EncryptedPaymentAttachment { attachment })
}

#[wasm_bindgen]
pub fn decrypt_payment_attachment(
    attachment: Vec<u8>,
    envelope: Vec<u8>,
    viewing_secret: Vec<u8>,
    recipient_code: &str,
    expected_hash: Vec<u8>,
) -> Result<String, JsError> {
    let recipient = PaymentCode::decode(recipient_code).map_err(js_error)?;
    CoreEncryptedAttachment::decrypt(
        array(&attachment, "encrypted attachment")?,
        CoreEncryptedOutput::envelope_from_bytes(array(&envelope, "encrypted output")?)
            .map_err(js_error)?,
        array(&viewing_secret, "viewing secret")?,
        &recipient,
        field(&expected_hash, "attachment hash")?,
    )
    .map_err(js_error)
}

fn derive_identity(
    master: MasterEntropy,
    network: u8,
    vault: Vec<u8>,
    child_index: u64,
) -> Result<PaymentIdentity, JsError> {
    let child = master
        .derive_child(
            Network::try_from(network).map_err(js_error)?,
            array(&vault, "vault identifier")?,
            child_index,
        )
        .map_err(js_error)?;
    Ok(PaymentIdentity { child })
}

fn derive_archive(
    master: MasterEntropy,
    network: u8,
    vault: Vec<u8>,
) -> Result<PaymentArchiveIdentity, JsError> {
    let archive = ArchiveIdentity::derive(
        &master,
        Network::try_from(network).map_err(js_error)?,
        array(&vault, "vault identifier")?,
    )
    .map_err(js_error)?;
    Ok(PaymentArchiveIdentity { archive })
}

fn array<const LENGTH: usize>(bytes: &[u8], label: &str) -> Result<[u8; LENGTH], JsError> {
    bytes
        .try_into()
        .map_err(|_| JsError::new(&format!("invalid {label} length")))
}

fn field(bytes: &[u8], label: &str) -> Result<FieldElement, JsError> {
    FieldElement::from_be_bytes(array(bytes, label)?).map_err(js_error)
}

fn point_bytes(point: moros_payments_core::BabyJubPoint) -> Vec<u8> {
    let (x, y) = point.to_le_bytes();
    let mut bytes = Vec::with_capacity(64);
    bytes.extend_from_slice(
        &FieldElement::from_le_bytes(x)
            .expect("validated BabyJub x")
            .to_be_bytes(),
    );
    bytes.extend_from_slice(
        &FieldElement::from_le_bytes(y)
            .expect("validated BabyJub y")
            .to_be_bytes(),
    );
    bytes
}

fn js_error(error: moros_payments_core::Error) -> JsError {
    JsError::new(&error.to_string())
}
