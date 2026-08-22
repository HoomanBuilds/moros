use core::str::FromStr;

use moros_payments_core::{
    AtomicUsdc, ChildIdentity, MasterEntropy, Network, PaymentCode, PaymentRequest,
    PaymentRequestPolicy, SignedPaymentRequest,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PaymentIdentity {
    child: ChildIdentity,
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

fn array<const LENGTH: usize>(bytes: &[u8], label: &str) -> Result<[u8; LENGTH], JsError> {
    bytes
        .try_into()
        .map_err(|_| JsError::new(&format!("invalid {label} length")))
}

fn js_error(error: moros_payments_core::Error) -> JsError {
    JsError::new(&error.to_string())
}
