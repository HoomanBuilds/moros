/* tslint:disable */
/* eslint-disable */

export class ActivityViewingCapability {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    decrypt_page(encoded: Uint8Array): Uint8Array;
    readonly locator: Uint8Array;
    readonly maximum_epoch: bigint;
}

export class DecryptedPaymentNote {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly amount_atomic: string;
    readonly blinding: Uint8Array;
    readonly commitment: Uint8Array;
    readonly note_id: Uint8Array;
    readonly payload_hash: Uint8Array;
    readonly private_data: Uint8Array;
    readonly purpose: bigint;
    readonly spend_public_key: Uint8Array;
    readonly viewing_public_key: Uint8Array;
}

export class EncryptedPaymentAttachment {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bytes: Uint8Array;
    readonly hash: Uint8Array;
}

export class EncryptedPaymentOutput {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly amount_atomic: string;
    readonly commitment: Uint8Array;
    readonly envelope: Uint8Array;
    readonly envelope_hash: Uint8Array;
}

export class IncomingViewingCapability {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    decrypt_output(index: number, envelope: Uint8Array, note_domain: Uint8Array, expected_commitment?: Uint8Array | null): DecryptedPaymentNote;
    payment_code(index: number): string;
    viewing_secret(index: number): Uint8Array;
    readonly identity_count: number;
    readonly maximum_child_index: bigint;
}

export class PaymentArchiveIdentity {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    activity_viewing_export(maximum_epoch: bigint): string;
    decrypt_page(encoded: Uint8Array): Uint8Array;
    encrypt_page(epoch: bigint, generation: bigint, page: number, previous_hash: Uint8Array, nonce: Uint8Array, content: Uint8Array): Uint8Array;
    sign_challenge(challenge: Uint8Array, expires_at: bigint): Uint8Array;
    readonly locator: Uint8Array;
    readonly signing_public_key: Uint8Array;
}

export class PaymentIdentity {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    create_payment_link(asset: Uint8Array, amount: string | null | undefined, request_id: Uint8Array, created_at: bigint, expires_at: bigint, merchant_label?: string | null, encrypted_context?: Uint8Array | null): string;
    request_signing_public_key(): Uint8Array;
    spend_secret(): Uint8Array;
    viewing_secret(): Uint8Array;
    readonly payment_code: string;
    readonly recipient_fingerprint: string;
}

export class VerifiedPaymentReceipt {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    verify_note(note: DecryptedPaymentNote): void;
    readonly amount_atomic: string;
    readonly confirmed_at: bigint;
    readonly ledger: number;
    readonly output_commitment: Uint8Array;
    readonly recipient_fingerprint: string;
    readonly transaction_hash: Uint8Array;
}

export class VerifiedPaymentRequest {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    create_receipt(transaction_hash: Uint8Array, ledger: number, output_commitment: Uint8Array, amount_atomic: string, confirmed_at: bigint): string;
    readonly amount: string | undefined;
    readonly created_at: bigint;
    readonly encrypted_context: Uint8Array | undefined;
    readonly expires_at: bigint;
    readonly merchant_label: string | undefined;
    readonly payload_hash: Uint8Array;
    readonly payment_code: string;
    readonly recipient_fingerprint: string;
    readonly request_id: Uint8Array;
}

export function create_payment_attachment(memo: string, recipient_code: string, ephemeral_secret: Uint8Array, nonce: Uint8Array): EncryptedPaymentAttachment;

export function create_payment_output(recipient_code: string, output_index: number, note_domain: Uint8Array, amount_atomic: string, note_id: Uint8Array, payload_hash: Uint8Array, private_data: Uint8Array, blinding: Uint8Array, ephemeral_secret: Uint8Array, nonce: Uint8Array): EncryptedPaymentOutput;

export function decode_activity_viewing_export(encoded: string): ActivityViewingCapability;

export function decode_incoming_viewing_export(encoded: string): IncomingViewingCapability;

export function decode_payment_receipt(encoded: string): VerifiedPaymentReceipt;

export function decrypt_payment_attachment(attachment: Uint8Array, envelope: Uint8Array, viewing_secret: Uint8Array, recipient_code: string, expected_hash: Uint8Array): string;

export function decrypt_payment_output(envelope: Uint8Array, viewing_secret: Uint8Array, recipient_code: string, note_domain: Uint8Array, expected_commitment?: Uint8Array | null): DecryptedPaymentNote;

export function format_usdc_amount(atomic: string): string;

export function incoming_viewing_export_from_entropy(entropy: Uint8Array, network: number, vault: Uint8Array, maximum_child_index: bigint): string;

export function incoming_viewing_export_from_phrase(recovery_phrase: string, network: number, vault: Uint8Array, maximum_child_index: bigint): string;

export function parse_usdc_amount(display: string): string;

export function payment_archive_from_entropy(entropy: Uint8Array, network: number, vault: Uint8Array): PaymentArchiveIdentity;

export function payment_archive_from_phrase(recovery_phrase: string, network: number, vault: Uint8Array): PaymentArchiveIdentity;

export function payment_code_fingerprint(encoded: string): string;

export function payment_identity_from_entropy(entropy: Uint8Array, network: number, vault: Uint8Array, child_index: bigint): PaymentIdentity;

export function payment_identity_from_phrase(recovery_phrase: string, network: number, vault: Uint8Array, child_index: bigint): PaymentIdentity;

export function recovery_phrase_from_entropy(entropy: Uint8Array): string;

export function verify_payment_link(link: string, now: bigint, maximum_clock_skew_seconds: bigint, network: number, vault: Uint8Array, asset: Uint8Array, maximum_amount: string): VerifiedPaymentRequest;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_activityviewingcapability_free: (a: number, b: number) => void;
    readonly __wbg_decryptedpaymentnote_free: (a: number, b: number) => void;
    readonly __wbg_encryptedpaymentattachment_free: (a: number, b: number) => void;
    readonly __wbg_encryptedpaymentoutput_free: (a: number, b: number) => void;
    readonly __wbg_incomingviewingcapability_free: (a: number, b: number) => void;
    readonly __wbg_paymentarchiveidentity_free: (a: number, b: number) => void;
    readonly __wbg_paymentidentity_free: (a: number, b: number) => void;
    readonly __wbg_verifiedpaymentreceipt_free: (a: number, b: number) => void;
    readonly __wbg_verifiedpaymentrequest_free: (a: number, b: number) => void;
    readonly activityviewingcapability_decrypt_page: (a: number, b: number, c: number, d: number) => void;
    readonly activityviewingcapability_locator: (a: number, b: number) => void;
    readonly activityviewingcapability_maximum_epoch: (a: number) => bigint;
    readonly create_payment_attachment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly create_payment_output: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => void;
    readonly decode_activity_viewing_export: (a: number, b: number, c: number) => void;
    readonly decode_incoming_viewing_export: (a: number, b: number, c: number) => void;
    readonly decode_payment_receipt: (a: number, b: number, c: number) => void;
    readonly decrypt_payment_attachment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly decrypt_payment_output: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly decryptedpaymentnote_amount_atomic: (a: number, b: number) => void;
    readonly decryptedpaymentnote_blinding: (a: number, b: number) => void;
    readonly decryptedpaymentnote_commitment: (a: number, b: number) => void;
    readonly decryptedpaymentnote_note_id: (a: number, b: number) => void;
    readonly decryptedpaymentnote_payload_hash: (a: number, b: number) => void;
    readonly decryptedpaymentnote_private_data: (a: number, b: number) => void;
    readonly decryptedpaymentnote_purpose: (a: number) => bigint;
    readonly decryptedpaymentnote_spend_public_key: (a: number, b: number) => void;
    readonly decryptedpaymentnote_viewing_public_key: (a: number, b: number) => void;
    readonly encryptedpaymentattachment_bytes: (a: number, b: number) => void;
    readonly encryptedpaymentattachment_hash: (a: number, b: number) => void;
    readonly encryptedpaymentoutput_amount_atomic: (a: number, b: number) => void;
    readonly encryptedpaymentoutput_commitment: (a: number, b: number) => void;
    readonly encryptedpaymentoutput_envelope: (a: number, b: number) => void;
    readonly encryptedpaymentoutput_envelope_hash: (a: number, b: number) => void;
    readonly format_usdc_amount: (a: number, b: number, c: number) => void;
    readonly incoming_viewing_export_from_entropy: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
    readonly incoming_viewing_export_from_phrase: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
    readonly incomingviewingcapability_decrypt_output: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly incomingviewingcapability_identity_count: (a: number) => number;
    readonly incomingviewingcapability_maximum_child_index: (a: number) => bigint;
    readonly incomingviewingcapability_payment_code: (a: number, b: number, c: number) => void;
    readonly incomingviewingcapability_viewing_secret: (a: number, b: number, c: number) => void;
    readonly parse_usdc_amount: (a: number, b: number, c: number) => void;
    readonly payment_archive_from_entropy: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly payment_archive_from_phrase: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly payment_code_fingerprint: (a: number, b: number, c: number) => void;
    readonly payment_identity_from_entropy: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
    readonly payment_identity_from_phrase: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
    readonly paymentarchiveidentity_activity_viewing_export: (a: number, b: number, c: bigint) => void;
    readonly paymentarchiveidentity_decrypt_page: (a: number, b: number, c: number, d: number) => void;
    readonly paymentarchiveidentity_encrypt_page: (a: number, b: number, c: bigint, d: bigint, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly paymentarchiveidentity_locator: (a: number, b: number) => void;
    readonly paymentarchiveidentity_sign_challenge: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly paymentarchiveidentity_signing_public_key: (a: number, b: number) => void;
    readonly paymentidentity_create_payment_link: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint, j: bigint, k: number, l: number, m: number, n: number) => void;
    readonly paymentidentity_payment_code: (a: number, b: number) => void;
    readonly paymentidentity_recipient_fingerprint: (a: number, b: number) => void;
    readonly paymentidentity_request_signing_public_key: (a: number, b: number) => void;
    readonly paymentidentity_spend_secret: (a: number, b: number) => void;
    readonly paymentidentity_viewing_secret: (a: number, b: number) => void;
    readonly recovery_phrase_from_entropy: (a: number, b: number, c: number) => void;
    readonly verifiedpaymentreceipt_amount_atomic: (a: number, b: number) => void;
    readonly verifiedpaymentreceipt_confirmed_at: (a: number) => bigint;
    readonly verifiedpaymentreceipt_ledger: (a: number) => number;
    readonly verifiedpaymentreceipt_output_commitment: (a: number, b: number) => void;
    readonly verifiedpaymentreceipt_recipient_fingerprint: (a: number, b: number) => void;
    readonly verifiedpaymentreceipt_transaction_hash: (a: number, b: number) => void;
    readonly verifiedpaymentreceipt_verify_note: (a: number, b: number, c: number) => void;
    readonly verifiedpaymentrequest_amount: (a: number, b: number) => void;
    readonly verifiedpaymentrequest_create_receipt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint) => void;
    readonly verifiedpaymentrequest_created_at: (a: number) => bigint;
    readonly verifiedpaymentrequest_encrypted_context: (a: number, b: number) => void;
    readonly verifiedpaymentrequest_expires_at: (a: number) => bigint;
    readonly verifiedpaymentrequest_merchant_label: (a: number, b: number) => void;
    readonly verifiedpaymentrequest_payload_hash: (a: number, b: number) => void;
    readonly verifiedpaymentrequest_payment_code: (a: number, b: number) => void;
    readonly verifiedpaymentrequest_recipient_fingerprint: (a: number, b: number) => void;
    readonly verifiedpaymentrequest_request_id: (a: number, b: number) => void;
    readonly verify_payment_link: (a: number, b: number, c: number, d: bigint, e: bigint, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
