import assert from "node:assert/strict";
import { checkPaymentBalance, checkPaymentExpiry, confirmedDepositHash, FlowRevision, MAX_PAYMENT_AMOUNT, parsePaymentAmount, PaymentFailedError, paymentTransactionHash } from "./payment-review";

assert.equal(parsePaymentAmount(" 0.0000001 "), 1n);
assert.equal(parsePaymentAmount("25.01"), 250100000n);
assert.equal(parsePaymentAmount(".5"), 5000000n);
assert.equal(parsePaymentAmount("1."), 10000000n);
assert.equal(parsePaymentAmount(".0000001"), 1n);
assert.equal(parsePaymentAmount("1844674407370.9551615"), MAX_PAYMENT_AMOUNT);
assert.throws(() => parsePaymentAmount("1844674407370.9551616"), /positive/);
for (const value of ["", "0", "0.", ".0", "-1", "1e3", "NaN", ".", ".00000001", "1.00000001", "1,000.50", "1.2.3", "9".repeat(100)]) {
  assert.throws(() => parsePaymentAmount(value));
}
assert.throws(() => checkPaymentBalance(1n, null), /Refresh/);
assert.throws(() => checkPaymentBalance(10n, 10n, 1n), /fees/);
assert.throws(() => checkPaymentBalance(MAX_PAYMENT_AMOUNT, MAX_PAYMENT_AMOUNT, 1n), /invalid/);
checkPaymentBalance(9n, 10n, 1n);
assert.throws(() => checkPaymentExpiry(100, 100), /expired/);
checkPaymentExpiry(101, 100);
const flow = new FlowRevision();
const pendingReview = flow.next();
flow.next();
assert.equal(flow.current(pendingReview), false);
assert.equal(flow.begin(), true);
const hash = "ab".repeat(32);
assert.equal(confirmedDepositHash({ getTransactionResponse: { status: "SUCCESS" }, sendTransactionResponse: { hash } }), hash);
assert.throws(() => confirmedDepositHash({ getTransactionResponse: { status: "FAILED" }, hash }), PaymentFailedError);
assert.throws(() => confirmedDepositHash({ getTransactionResponse: { status: "NOT_FOUND" }, hash }), /unavailable/);
assert.throws(() => confirmedDepositHash({ hash }), /unavailable/);
assert.throws(() => paymentTransactionHash("abc"), /valid transaction/);
assert.equal(flow.begin(), false);
flow.finish();
assert.equal(flow.begin(), true);
console.log("Payment amount, fee, expiry and concurrency checks passed.");
