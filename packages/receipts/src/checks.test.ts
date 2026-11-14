import { describe, expect, it } from "vitest";
import { metadataIdentifier, verifyReceipt, type ReceiptInput } from "./checks";
import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "./test-invoice";

// Fictional recipients on reserved example domains; no real person or phone number.
const ADDRESS = "alice@example.com";
const recipientNode = testKey("recipient node");
const [preimage, paymentHash] = testPreimage("round 1");
const metadata = lnurlMetadata(ADDRESS);
const AMOUNT = 178_000n;

/** A receipt that passes, built the way an LUD-06 service builds its invoice. */
function goodReceipt(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    invoice: makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: AMOUNT, descriptionHash: sha256Hex(metadata) }),
    preimage,
    address: ADDRESS,
    metadata,
    knownNodeKeys: [nodeKeyOf(recipientNode)],
    expectedAmountMsat: AMOUNT,
    ...overrides,
  };
}

function failed(input: ReceiptInput): string[] {
  return verifyReceipt(input).checks.filter((c) => !c.ok).map((c) => c.check);
}

describe("verifyReceipt", () => {
  it("passes a real-shaped receipt on all four checks", () => {
    const result = verifyReceipt(goodReceipt());
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.check)).toEqual(["paid", "address", "issuer", "amount"]);
    expect(result.checks.find((c) => c.check === "address")?.proof).toBe("description-hash");
  });

  it("passes a plain-description invoice, marked as the weaker proof", () => {
    const invoice = makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: AMOUNT, description: `Payment to ${ADDRESS}` });
    const result = verifyReceipt(goodReceipt({ invoice }));
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.check === "address")?.proof).toBe("description");
  });

  describe("tampered receipts fail the right check", () => {
    it("paid: a preimage from another payment", () => {
      expect(failed(goodReceipt({ preimage: testPreimage("round 2")[0] }))).toEqual(["paid"]);
    });

    it("paid: a preimage that is not hex", () => {
      expect(failed(goodReceipt({ preimage: "not a preimage" }))).toEqual(["paid"]);
    });

    it("address: the receipt claims a different recipient", () => {
      const other = "bob@example.org";
      expect(failed(goodReceipt({ address: other, metadata: lnurlMetadata(other) }))).toEqual(["address"]);
    });

    it("address: the metadata was swapped but still names the address", () => {
      expect(failed(goodReceipt({ metadata: lnurlMetadata(ADDRESS, "a different text") }))).toEqual(["address"]);
    });

    it("address: metadata that names nobody", () => {
      expect(failed(goodReceipt({ metadata: JSON.stringify([["text/plain", "hi"]]) }))).toEqual(["address"]);
    });

    it("address: a plain description that names someone else", () => {
      const invoice = makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: AMOUNT, description: "Payment to mallory@example.net" });
      expect(failed(goodReceipt({ invoice }))).toEqual(["address"]);
    });

    it("address: a description that only contains the address as part of a longer one", () => {
      const invoice = makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: AMOUNT, description: `Payment to x${ADDRESS}` });
      expect(failed(goodReceipt({ invoice }))).toEqual(["address"]);
    });

    it("issuer: an invoice signed by another node (someone paid themselves)", () => {
      const invoice = makeInvoice({ nodeSecret: testKey("attacker node"), paymentHash, amountMsat: AMOUNT, descriptionHash: sha256Hex(metadata) });
      expect(failed(goodReceipt({ invoice }))).toEqual(["issuer"]);
    });

    it("issuer: no node known for the address", () => {
      expect(failed(goodReceipt({ knownNodeKeys: [] }))).toEqual(["issuer"]);
    });

    it("amount: less than the round", () => {
      const invoice = makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: AMOUNT - 1_000n, descriptionHash: sha256Hex(metadata) });
      expect(failed(goodReceipt({ invoice }))).toEqual(["amount"]);
    });

    it("amount: an invoice with no amount", () => {
      const invoice = makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: null, descriptionHash: sha256Hex(metadata) });
      expect(failed(goodReceipt({ invoice }))).toEqual(["amount"]);
    });

    it("amount: a testnet invoice in a mainnet circle", () => {
      const invoice = makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: AMOUNT, network: "tb", descriptionHash: sha256Hex(metadata) });
      expect(failed(goodReceipt({ invoice }))).toEqual(["amount"]);
    });

    it("every check fails on text that is not an invoice", () => {
      expect(failed(goodReceipt({ invoice: "lnbc1notaninvoice" }))).toEqual(["paid", "address", "issuer", "amount"]);
    });
  });
});

describe("metadataIdentifier", () => {
  it("reads text/identifier, case-insensitively", () => {
    expect(metadataIdentifier(lnurlMetadata("Alice@Example.com"))).toBe("alice@example.com");
  });

  it("returns null for broken metadata", () => {
    expect(metadataIdentifier("{not json")).toBeNull();
    expect(metadataIdentifier(JSON.stringify({ a: 1 }))).toBeNull();
  });
});
