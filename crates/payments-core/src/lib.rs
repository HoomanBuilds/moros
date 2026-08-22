mod amount;
mod archive;
mod attachment;
mod babyjub;
mod cbor;
mod field;
mod identity;
mod note;
mod payment_code;
mod poseidon;
mod request;
mod selection;
mod viewing;

pub use amount::{AtomicUsdc, MAX_ATOMIC_USDC};
pub use archive::{
    ACTIVITY_VIEW_PREFIX, ARCHIVE_PAGE_BYTES, ARCHIVE_PAGE_CONTENT_BYTES, ActivityViewingKey,
    ArchiveIdentity, EncryptedArchivePage, verify_sync_challenge,
};
pub use attachment::{EncryptedAttachment, MAX_MEMO_BYTES, PAYMENT_ATTACHMENT_BYTES};
pub use babyjub::BabyJubPoint;
pub use field::FieldElement;
pub use identity::{ChildIdentity, MasterEntropy};
pub use note::{EncryptedOutput, PrivateNote, PrivateNoteAmount};
pub use payment_code::{
    Network, PAYMENT_CODE_BYTES, PAYMENT_CODE_PREFIX, PaymentCode, PaymentCodeExpectation,
};
pub use poseidon::spend_public_key;
pub use request::{
    PAYMENT_LINK_PREFIX, PaymentRequest, PaymentRequestPolicy, SignedPaymentRequest,
};
pub use selection::{MAX_SELECTION_CANDIDATES, NoteSelection, SpendableNote, TransferBudget};
pub use viewing::{
    INCOMING_VIEW_PREFIX, IncomingViewingExport, MAX_VIEWING_IDENTITIES, ViewingIdentity,
};

pub const PROTOCOL_VERSION: u8 = 1;
pub const IDENTITY_VERSION: u8 = 1;
pub const USDC_DECIMALS: u32 = 7;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("invalid private payment recovery phrase")]
    InvalidRecoveryPhrase,
    #[error("invalid key derivation input")]
    InvalidDerivation,
    #[error("invalid BabyJub point")]
    InvalidPoint,
    #[error("low-order BabyJub point")]
    LowOrderPoint,
    #[error("invalid payment code prefix")]
    InvalidPaymentCodePrefix,
    #[error("invalid payment code encoding")]
    InvalidPaymentCodeEncoding,
    #[error("invalid payment code length")]
    InvalidPaymentCodeLength,
    #[error("invalid payment code checksum")]
    InvalidPaymentCodeChecksum,
    #[error("unsupported protocol version")]
    UnsupportedProtocolVersion,
    #[error("unsupported identity version")]
    UnsupportedIdentityVersion,
    #[error("unsupported network")]
    UnsupportedNetwork,
    #[error("payment code is for another network")]
    NetworkMismatch,
    #[error("payment code is for another vault")]
    VaultMismatch,
    #[error("invalid USDC amount")]
    InvalidAmount,
    #[error("USDC amount exceeds the supported limit")]
    AmountOverflow,
    #[error("payment request is too large")]
    RequestTooLarge,
    #[error("invalid payment request encoding")]
    InvalidRequestEncoding,
    #[error("invalid payment request signature")]
    InvalidRequestSignature,
    #[error("payment request has expired")]
    RequestExpired,
    #[error("payment request was created too far in the future")]
    RequestCreatedInFuture,
    #[error("payment request lifetime is invalid")]
    InvalidRequestLifetime,
    #[error("payment request merchant label is too long")]
    MerchantLabelTooLong,
    #[error("payment request is for another asset")]
    AssetMismatch,
    #[error("invalid BN254 field element")]
    InvalidFieldElement,
    #[error("invalid private note")]
    InvalidNote,
    #[error("invalid private note envelope")]
    InvalidEnvelope,
    #[error("invalid encrypted payment attachment")]
    InvalidAttachment,
    #[error("payment memo is too long")]
    MemoTooLong,
    #[error("invalid encrypted payment archive")]
    InvalidArchive,
    #[error("payment archive content is too large")]
    ArchiveTooLarge,
    #[error("payment archive authentication failed")]
    ArchiveAuthenticationFailed,
    #[error("invalid payment viewing export")]
    InvalidViewingExport,
    #[error("payment viewing export contains too many identities")]
    ViewingExportTooLarge,
    #[error("private note envelope authentication failed")]
    EnvelopeAuthenticationFailed,
    #[error("private note recipient does not match")]
    RecipientMismatch,
    #[error("private note commitment does not match")]
    CommitmentMismatch,
    #[error("invalid private note output index")]
    InvalidOutputIndex,
    #[error("private balance is insufficient")]
    InsufficientPrivateBalance,
    #[error("private balance requires consolidation")]
    TooManySpendableNotes,
    #[error("private payment value does not conserve")]
    ValueConservation,
}

pub type Result<T> = core::result::Result<T, Error>;
