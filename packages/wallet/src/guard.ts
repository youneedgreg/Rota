import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * Checks around one payment from the built-in wallet. The wallet's own
 * "prepare" step quotes the invoice and fee; nothing is sent unless that quote
 * matches what Rota's invoice check already approved. After sending, the
 * payment counts only if it returned a preimage that matches the invoice,
 * because receipt check 1 needs it.
 *
 * The shapes below are the parts of the Breez SDK's types these checks read,
 * so this package doesn't load the SDK.
 */

export interface PreparedQuote {
  paymentMethod:
    | {
        type: "bolt11Invoice";
        invoiceDetails: { amountMsat?: number; paymentHash: string; invoice: { bolt11: string } };
        lightningFeeSats: number;
        sparkTransferFeeSats?: number;
      }
    | { type: string };
  amount: bigint;
}

export interface SentPayment {
  status: "completed" | "pending" | "failed";
  fees: bigint;
  details?: { type: string; htlcDetails?: { paymentHash: string; preimage?: string } };
}

export class PaymentGuardError extends Error {
  constructor(
    readonly problem: "method" | "invoice" | "amount" | "fee" | "failed" | "pending" | "preimage",
    message: string,
  ) {
    super(message);
    this.name = "PaymentGuardError";
  }
}

/**
 * The most Rota lets the wallet pay in Lightning fees: 1% of the amount, but
 * at least 10 sats so small payments can route. Rota's own choice; the real
 * fees will be measured on the first mainnet payments.
 */
export function maxFeeSats(amountMsat: bigint): number {
  const sats = Number(amountMsat / 1000n);
  return Math.max(10, Math.ceil(sats / 100));
}

export interface ExpectedPayment {
  invoice: string;
  amountMsat: bigint;
  /** Defaults to maxFeeSats(amountMsat). */
  maxFeeSats?: number;
}

/**
 * Run between the wallet's prepare and send steps. Returns the fee in sats.
 * The wallet must be sent with preferSpark: false, so the payment goes over
 * Lightning and returns a preimage; a Spark transfer has none.
 */
export function checkQuote(quote: PreparedQuote, expected: ExpectedPayment): number {
  const method = quote.paymentMethod;
  if (method.type !== "bolt11Invoice" || !("invoiceDetails" in method)) {
    throw new PaymentGuardError("method", "The wallet didn't read this as a Lightning invoice.");
  }
  if (method.invoiceDetails.invoice.bolt11.toLowerCase() !== expected.invoice.toLowerCase()) {
    throw new PaymentGuardError("invoice", "The wallet quoted a different invoice.");
  }
  const amountMsat = method.invoiceDetails.amountMsat;
  if (amountMsat === undefined || BigInt(amountMsat) !== expected.amountMsat) {
    throw new PaymentGuardError("amount", "The invoice amount doesn't match the round.");
  }
  // The wallet quotes sats; the round's amount is whole sats (see @rota/circles).
  if (quote.amount * 1000n !== expected.amountMsat) {
    throw new PaymentGuardError("amount", "The wallet would send a different amount.");
  }
  const fee = method.lightningFeeSats;
  const cap = expected.maxFeeSats ?? maxFeeSats(expected.amountMsat);
  if (!Number.isInteger(fee) || fee < 0 || fee > cap) {
    throw new PaymentGuardError("fee", `The network fee (${fee} sats) is above Rota's limit of ${cap} sats.`);
  }
  return fee;
}

const HEX_32 = /^[0-9a-f]{64}$/;

/**
 * The preimage of a finished payment, checked against the invoice's payment
 * hash. Throws if the payment failed, is still pending, or has no valid
 * preimage (for example a Spark transfer), since no receipt can be made.
 */
export function preimageOf(payment: SentPayment, paymentHash: string): string {
  if (payment.status === "failed") throw new PaymentGuardError("failed", "The payment failed. No money left your wallet.");
  if (payment.status === "pending") {
    throw new PaymentGuardError("pending", "The payment is still on its way. Rota will check again shortly.");
  }
  const preimage = payment.details?.type === "lightning" ? payment.details.htlcDetails?.preimage?.toLowerCase() : undefined;
  if (!preimage || !HEX_32.test(preimage)) {
    throw new PaymentGuardError("preimage", "The payment finished without a proof of payment.");
  }
  if (bytesToHex(sha256(hexToBytes(preimage))) !== paymentHash.toLowerCase()) {
    throw new PaymentGuardError("preimage", "The proof of payment doesn't match the invoice.");
  }
  return preimage;
}
