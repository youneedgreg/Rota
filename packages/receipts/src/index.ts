/**
 * The four checks a Rota receipt must pass. Each runs on the member's own
 * device with no trust in Rota's server.
 *
 * - paid:    SHA-256 of the preimage equals the invoice's payment hash.
 * - address: the invoice's description hash equals SHA-256 of the metadata
 *            the recipient's Lightning address serves (LUD-16), which names
 *            that address.
 * - issuer:  the invoice's signature recovers the node behind the address.
 * - amount:  the amount matches the round, and the receipt is signed by the
 *            paying member's key.
 *
 * The checks themselves land in the receipt-core work; this skeleton only
 * fixes their names and order.
 */
export const RECEIPT_CHECKS = ["paid", "address", "issuer", "amount"] as const;

export type ReceiptCheck = (typeof RECEIPT_CHECKS)[number];
