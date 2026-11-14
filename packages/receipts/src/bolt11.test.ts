import { bech32 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { decodeInvoice, InvoiceError } from "./bolt11";
import { invoiceParts, makeInvoice, nodeKeyOf, signInvoice, testKey, testPreimage } from "./test-invoice";

const node = testKey("node");
const [, paymentHash] = testPreimage("bolt11");

describe("decodeInvoice", () => {
  it("reads the fields and recovers the signing node", () => {
    const invoice = makeInvoice({
      nodeSecret: node,
      paymentHash,
      amountMsat: 178_000n,
      description: "Payment to alice@example.com",
      expirySeconds: 120,
      timestamp: 1_794_669_000,
    });
    expect(decodeInvoice(invoice)).toEqual({
      network: "bc",
      amountMsat: 178_000n,
      timestamp: 1_794_669_000,
      expirySeconds: 120,
      paymentHash,
      description: "Payment to alice@example.com",
      descriptionHash: null,
      payeeNodeKey: nodeKeyOf(node),
    });
  });

  it.each([
    ["2500u", 250_000_000n],
    ["20m", 2_000_000_000n],
    ["1780n", 178_000n],
    ["9678785340p", 967_878_534n],
    ["1", 100_000_000_000n],
  ])("reads the amount %s as %s msat", (amount, msat) => {
    const { dataWords } = invoiceParts({ nodeSecret: node, paymentHash, amountMsat: null });
    expect(decodeInvoice(signInvoice(`lnbc${amount}`, dataWords, node)).amountMsat).toBe(msat);
  });

  it("returns null for an invoice with no amount", () => {
    expect(decodeInvoice(makeInvoice({ nodeSecret: node, paymentHash, amountMsat: null })).amountMsat).toBeNull();
  });

  it("accepts upper case and a lightning: prefix", () => {
    const invoice = makeInvoice({ nodeSecret: node, paymentHash });
    expect(decodeInvoice(`lightning:${invoice.toUpperCase()}`).paymentHash).toBe(paymentHash);
  });

  it("rejects a pico amount that is not whole millisatoshis", () => {
    const { dataWords } = invoiceParts({ nodeSecret: node, paymentHash, amountMsat: null });
    expect(() => decodeInvoice(signInvoice("lnbc15p", dataWords, node))).toThrow(InvoiceError);
  });

  it("rejects text that is not an invoice", () => {
    expect(() => decodeInvoice("hello")).toThrow(InvoiceError);
    expect(() => decodeInvoice(bech32.encode("npub", bech32.toWords(new Uint8Array(32)), false))).toThrow(InvoiceError);
  });

  it("rejects a broken checksum", () => {
    const invoice = makeInvoice({ nodeSecret: node, paymentHash });
    const last = invoice.at(-1) === "q" ? "p" : "q";
    expect(() => decodeInvoice(invoice.slice(0, -1) + last)).toThrow(InvoiceError);
  });

  it("recovers a different node when signed data is changed after signing", () => {
    const { hrp, dataWords } = invoiceParts({ nodeSecret: node, paymentHash, amountMsat: 1_000n });
    expect(hrp).toBe("lnbc10n");
    const signed = bech32.decode(signInvoice(hrp, dataWords, node) as `${string}1${string}`, false).words;
    // Double the amount in the human-readable part but keep the old signature.
    const forged = bech32.encode("lnbc20n", signed, false);
    expect(decodeInvoice(forged).payeeNodeKey).not.toBe(nodeKeyOf(node));
  });

  it("rejects a stated payee that did not sign", () => {
    const invoice = makeInvoice({ nodeSecret: node, paymentHash, statedPayee: nodeKeyOf(testKey("someone else")) });
    expect(() => decodeInvoice(invoice)).toThrow("signature does not match the stated payee");
  });

  it("accepts a stated payee that did sign", () => {
    const invoice = makeInvoice({ nodeSecret: node, paymentHash, statedPayee: true });
    expect(decodeInvoice(invoice).payeeNodeKey).toBe(nodeKeyOf(node));
  });

  it("rejects an invoice with no payment hash", () => {
    const { hrp, dataWords } = invoiceParts({ nodeSecret: node, paymentHash });
    const withoutHash = [...dataWords.slice(0, 7), ...dataWords.slice(7 + 3 + 52)];
    expect(() => decodeInvoice(signInvoice(hrp, withoutHash, node))).toThrow("invoice has no payment hash");
  });
});
