/**
 * The four checks a Rota receipt must pass. Each runs on the member's own
 * device with no trust in Rota's server.
 *
 * - paid:    SHA-256 of the preimage equals the invoice's payment hash.
 * - address: the invoice's description hash equals SHA-256 of the metadata
 *            the recipient's Lightning address serves (LUD-16), which names
 *            that address. For services that sign a plain description
 *            instead, the description must name the address (weaker).
 * - issuer:  the invoice's signature recovers a node the address is known
 *            to use.
 * - amount:  the invoice is on the circle's network and for exactly the
 *            round's amount.
 *
 * That the receipt was published by the paying member's key is checked
 * where the signed receipt event is read, not here.
 */
export const RECEIPT_CHECKS = ["paid", "address", "issuer", "amount"] as const;

export type ReceiptCheck = (typeof RECEIPT_CHECKS)[number];

export { decodeInvoice, InvoiceError, type Invoice } from "./bolt11";
export {
  checkAddress,
  checkAmount,
  checkIssuer,
  checkPaid,
  metadataIdentifier,
  verifyReceipt,
  type AddressProof,
  type CheckResult,
  type ReceiptInput,
  type ReceiptResult,
} from "./checks";
