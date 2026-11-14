import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { decodeInvoice, InvoiceError, type Invoice } from "./bolt11";
import type { ReceiptCheck } from "./index";

/** What a member's device needs to check one payment. Nothing here comes from Rota's server. */
export interface ReceiptInput {
  /** The BOLT11 invoice that was paid, as fetched on the payer's device. */
  invoice: string;
  /** The payment preimage the payer's wallet returned, hex. */
  preimage: string;
  /** The recipient's Lightning address, e.g. "alice@example.com" or "<number>@bitcoin.co.ke". */
  address: string;
  /** The exact `metadata` string the address's LNURL-pay endpoint served (LUD-06). */
  metadata: string;
  /** Node keys the address was seen to use when the circle was set up. */
  knownNodeKeys: readonly string[];
  /** The amount this round expects, in millisatoshis. */
  expectedAmountMsat: bigint;
  /** Network prefix the circle runs on; "bc" (mainnet) unless set. */
  network?: string;
}

/** How check 2 tied the invoice to the address. */
export type AddressProof =
  /** The invoice commits to SHA-256 of the address's metadata (LUD-06 `h` field). */
  | "description-hash"
  /** The invoice's signed plain-text description names the address. Weaker: see README. */
  | "description";

export interface CheckResult {
  check: ReceiptCheck;
  ok: boolean;
  detail: string;
  /** Set when the address check passes. */
  proof?: AddressProof;
}

export interface ReceiptResult {
  ok: boolean;
  checks: CheckResult[];
}

const HEX_32 = /^[0-9a-f]{64}$/;

function fail(check: ReceiptCheck, detail: string): CheckResult {
  return { check, ok: false, detail };
}

/** The identifier an LUD-06 metadata array names, or null. LUD-16 puts the address in `text/identifier`. */
export function metadataIdentifier(metadata: string): string | null {
  let entries: unknown;
  try {
    entries = JSON.parse(metadata);
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (Array.isArray(entry) && (entry[0] === "text/identifier" || entry[0] === "text/email") && typeof entry[1] === "string") {
      return entry[1].trim().toLowerCase();
    }
  }
  return null;
}

/** Check 1: SHA-256 of the preimage equals the invoice's payment hash. */
export function checkPaid(invoice: Invoice, preimage: string): CheckResult {
  const hex = preimage.trim().toLowerCase();
  if (!HEX_32.test(hex)) return fail("paid", "preimage is not 32 bytes of hex");
  if (bytesToHex(sha256(hexToBytes(hex))) !== invoice.paymentHash) {
    return fail("paid", "preimage does not match the payment hash");
  }
  return { check: "paid", ok: true, detail: "preimage matches the payment hash" };
}

/** Check 2: the invoice was issued for this address. */
export function checkAddress(invoice: Invoice, address: string, metadata: string): CheckResult {
  const wanted = address.trim().toLowerCase();
  const named = metadataIdentifier(metadata);
  if (named === null) return fail("address", "metadata names no address");
  if (named !== wanted) return fail("address", "metadata names a different address");

  if (invoice.descriptionHash !== null) {
    if (invoice.descriptionHash !== bytesToHex(sha256(utf8ToBytes(metadata)))) {
      return fail("address", "description hash does not match the address's metadata");
    }
    return { check: "address", ok: true, proof: "description-hash", detail: "invoice commits to the address's metadata" };
  }

  // Some services (bitcoin.co.ke on 2026-11-14) sign a plain description instead of the hash.
  const words = (invoice.description ?? "").toLowerCase().split(/\s+/);
  if (words.includes(wanted)) {
    return { check: "address", ok: true, proof: "description", detail: "invoice's signed description names the address" };
  }
  return fail("address", "invoice neither commits to the metadata nor names the address");
}

/** Check 3: the invoice was signed by a node the address is known to use. */
export function checkIssuer(invoice: Invoice, knownNodeKeys: readonly string[]): CheckResult {
  const known = knownNodeKeys.map((k) => k.trim().toLowerCase());
  if (known.length === 0) return fail("issuer", "no known node for this address");
  if (!known.includes(invoice.payeeNodeKey)) return fail("issuer", "invoice was signed by an unknown node");
  return { check: "issuer", ok: true, detail: "signed by the address's known node" };
}

/** Check 4: the invoice is on the circle's network and for exactly the round's amount. */
export function checkAmount(invoice: Invoice, expectedAmountMsat: bigint, network: string): CheckResult {
  if (expectedAmountMsat <= 0n) return fail("amount", "the round's amount is not positive");
  if (invoice.network !== network) return fail("amount", `invoice is for network "${invoice.network}", not "${network}"`);
  if (invoice.amountMsat === null) return fail("amount", "invoice has no amount");
  if (invoice.amountMsat !== expectedAmountMsat) return fail("amount", "invoice amount differs from the round's amount");
  return { check: "amount", ok: true, detail: "amount matches the round" };
}

/**
 * Runs the four checks on one payment. Every check runs even when an earlier
 * one fails, so the member sees the whole picture.
 */
export function verifyReceipt(input: ReceiptInput): ReceiptResult {
  let invoice: Invoice;
  try {
    invoice = decodeInvoice(input.invoice);
  } catch (error) {
    const detail = error instanceof InvoiceError ? error.message : "invoice could not be read";
    return {
      ok: false,
      checks: (["paid", "address", "issuer", "amount"] as const).map((check) => fail(check, detail)),
    };
  }

  const checks = [
    checkPaid(invoice, input.preimage),
    checkAddress(invoice, input.address, input.metadata),
    checkIssuer(invoice, input.knownNodeKeys),
    checkAmount(invoice, input.expectedAmountMsat, input.network ?? "bc"),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
