import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "@rota/receipts/testing";
import { finalizeEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  AMOUNT_TOLERANCE,
  amountOutsideBand,
  createReceiptEvent,
  newCircleSecret,
  newMemberSecret,
  publicKeyOf,
  RECEIPT_KIND,
  ReceiptRefused,
  roundClaims,
  verifyReceiptEvent,
  type AmountBand,
  type CircleContext,
  type PaymentRecord,
} from "./records";

// Fictional recipient on a reserved example domain; no real person or phone number.
const ADDRESS = "alice@example.com";
const metadata = lnurlMetadata(ADDRESS);
const recipientNode = testKey("recipient node");
const AMOUNT = 178_000n;

const circleSecret = newCircleSecret();
const alice = newMemberSecret();
const bob = newMemberSecret();
const outsider = newMemberSecret();

function context(overrides: Partial<CircleContext> = {}): CircleContext {
  return {
    circleSecret,
    members: [publicKeyOf(alice), publicKeyOf(bob)],
    round: 3,
    recipient: { address: ADDRESS, knownNodeKeys: [nodeKeyOf(recipientNode)] },
    amount: AMOUNT,
    ...overrides,
  };
}

function payment(label = "round 3 alice", overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  const [preimage, paymentHash] = testPreimage(label);
  return {
    address: ADDRESS,
    metadata,
    invoice: makeInvoice({ nodeSecret: recipientNode, paymentHash, amountMsat: AMOUNT, descriptionHash: sha256Hex(metadata) }),
    preimage,
    amountMsat: AMOUNT,
    local: { currency: "KES", amount: 15 },
    paidAt: 1_763_200_000,
    ...overrides,
  };
}

function receipt(memberSecret = alice, pay = payment(), ctx = context()) {
  return createReceiptEvent({
    memberSecret,
    context: { ...ctx, expectedAmountMsat: ctx.amount as bigint },
    payment: pay,
    createdAt: 1_763_200_005,
  });
}

/** A JSON round trip, as the event would arrive from a relay. */
function fromRelay<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("createReceiptEvent", () => {
  it("signs with the member's key and tags the circle and round", () => {
    const event = receipt();
    expect(event.kind).toBe(RECEIPT_KIND);
    expect(event.pubkey).toBe(publicKeyOf(alice));
    expect(event.tags).toEqual([
      ["p", publicKeyOf(circleSecret)],
      ["round", "3"],
    ]);
  });

  it("puts nothing readable in the content: no address, invoice, preimage or amount", () => {
    const pay = payment();
    const event = receipt(alice, pay);
    // NIP-44 output is plain base64, so no readable JSON fits in it.
    expect(event.content).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // Short values are matched as they'd appear in the JSON, quotes included:
    // a bare "KES" turns up in random base64 now and then (~1,100 chars here, so about 1 run in 240).
    for (const secret of [ADDRESS, pay.invoice, pay.preimage, '"178000"', '"KES"']) {
      expect(event.content).not.toContain(secret);
    }
  });

  it("refuses a payment that fails the receipt checks, and says which", () => {
    const bad = payment("round 3 alice", { preimage: testPreimage("another payment")[0] });
    try {
      receipt(alice, bad);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ReceiptRefused);
      expect((error as ReceiptRefused).checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["paid"]);
    }
  });

  it("refuses a payment record that names another address than the round's recipient", () => {
    expect(() => receipt(alice, payment("round 3 alice", { address: "mallory@example.org" }))).toThrow(ReceiptRefused);
  });

  it("refuses a round that isn't a whole number from 1", () => {
    expect(() => receipt(alice, payment(), context({ round: 0 }))).toThrow(ReceiptRefused);
  });
});

describe("verifyReceiptEvent", () => {
  it("passes a member's receipt as it comes back from the relay", () => {
    const result = verifyReceiptEvent(fromRelay(receipt()), context());
    expect(result.ok).toBe(true);
    expect(result.member).toMatchObject({ ok: true, pubkey: publicKeyOf(alice) });
    expect(result.checks.map((c) => [c.check, c.ok])).toEqual([
      ["paid", true],
      ["address", true],
      ["issuer", true],
      ["amount", true],
    ]);
    expect(result.content?.amountMsat).toBe(AMOUNT);
    expect(result.content?.local).toEqual({ currency: "KES", amount: 15 });
    expect(result.paymentHash).toBe(testPreimage("round 3 alice")[1]);
  });

  it("fails the member check for a receipt signed by someone outside the circle", () => {
    const result = verifyReceiptEvent(fromRelay(receipt(outsider)), context());
    expect(result.ok).toBe(false);
    expect(result.member.ok).toBe(false);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it("rejects an event whose content was changed after signing", () => {
    const event = fromRelay(receipt());
    const flipped = event.content.endsWith("A") ? "B" : "A";
    const result = verifyReceiptEvent({ ...event, content: event.content.slice(0, -1) + flipped }, context());
    expect(result.ok).toBe(false);
    expect(result.member.detail).toMatch(/signature/);
  });

  it("rejects a changed event even when it's the same object nostr-tools already marked verified", () => {
    const event = receipt();
    event.tags = [["p", publicKeyOf(circleSecret)], ["round", "4"]];
    const result = verifyReceiptEvent(event, context({ round: 4 }));
    expect(result.ok).toBe(false);
    expect(result.member.detail).toMatch(/signature/);
  });

  it("rejects a receipt read for another round", () => {
    expect(verifyReceiptEvent(fromRelay(receipt()), context({ round: 4 })).member.detail).toMatch(/another round/);
  });

  it("rejects a receipt read with another circle's key", () => {
    expect(verifyReceiptEvent(fromRelay(receipt()), context({ circleSecret: newCircleSecret() })).member.detail).toMatch(
      /another circle/,
    );
  });

  it("takes the amount from the circle, not from the event", () => {
    // The receipt is honest about a 178 sat payment, but this round expects 200 sats.
    const result = verifyReceiptEvent(fromRelay(receipt()), context({ amount: 200_000n }));
    expect(result.ok).toBe(false);
    expect(result.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["amount"]);
  });

  it("takes the recipient from the circle, not from the event", () => {
    const result = verifyReceiptEvent(
      fromRelay(receipt()),
      context({ recipient: { address: "bob@example.org", knownNodeKeys: [nodeKeyOf(recipientNode)] } }),
    );
    expect(result.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["address"]);
  });

  it("fails the paid check when a member signs a receipt with a made-up preimage", () => {
    // Alice can encrypt anything for the circle; she skips createReceiptEvent's own checks.
    const pay = payment();
    const circle = publicKeyOf(circleSecret);
    const forged = { v: 1, circle, round: 3, ...pay, amountMsat: AMOUNT.toString(), preimage: testPreimage("never paid")[0] };
    return import("nostr-tools/nip44").then(({ encrypt, getConversationKey }) => {
      const event = finalizeEvent(
        {
          kind: RECEIPT_KIND,
          created_at: 1_763_200_005,
          tags: [
            ["p", circle],
            ["round", "3"],
          ],
          content: encrypt(JSON.stringify(forged), getConversationKey(alice, circle)),
        },
        alice,
      );
      const result = verifyReceiptEvent(fromRelay(event), context());
      expect(result.member.ok).toBe(true);
      expect(result.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["paid"]);
    });
  });

  it("rejects things that aren't events", () => {
    for (const junk of [null, "event", 42, { kind: RECEIPT_KIND }, { ...receipt(), tags: [[1, 2]] }]) {
      expect(verifyReceiptEvent(junk, context()).ok).toBe(false);
    }
  });
});

describe("roundClaims", () => {
  it("marks each member's own payment as paid", () => {
    const results = [
      verifyReceiptEvent(fromRelay(receipt(alice, payment("round 3 alice"))), context()),
      verifyReceiptEvent(fromRelay(receipt(bob, payment("round 3 bob"))), context()),
    ];
    const claims = roundClaims(results);
    expect(claims.get(publicKeyOf(alice))).toBe("paid");
    expect(claims.get(publicKeyOf(bob))).toBe("paid");
  });

  it("marks both members disputed when one copies the other's payment", () => {
    // Every member can decrypt every receipt, so Bob can reuse Alice's invoice and preimage.
    const alicePaid = payment("round 3 alice");
    const results = [
      verifyReceiptEvent(fromRelay(receipt(alice, alicePaid)), context()),
      verifyReceiptEvent(fromRelay(receipt(bob, alicePaid)), context()),
    ];
    expect(results.every((r) => r.ok)).toBe(true);
    const claims = roundClaims(results);
    expect(claims.get(publicKeyOf(alice))).toBe("disputed");
    expect(claims.get(publicKeyOf(bob))).toBe("disputed");
  });

  it("ignores receipts that failed verification", () => {
    const results = [verifyReceiptEvent(fromRelay(receipt(outsider)), context())];
    expect(roundClaims(results).size).toBe(0);
  });
});

describe("amount band", () => {
  // 15 KES cost 176,000 msat at "today's" price; the receipt paid 178,000.
  const band = (overrides: Partial<AmountBand> = {}): AmountBand => ({
    currency: "KES",
    contribution: 15,
    marketMsat: 176_000n,
    tolerance: AMOUNT_TOLERANCE,
    ...overrides,
  });

  it("passes a receipt whose sats are within ±20% of today's price", () => {
    const result = verifyReceiptEvent(fromRelay(receipt()), context({ amount: band() }));
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.check === "amount")?.detail).toMatch(/band/);
  });

  it("fails a receipt that paid far fewer sats than the contribution costs", () => {
    // At this price 15 KES would be 250,000 msat; 178,000 is 29% short.
    const result = verifyReceiptEvent(fromRelay(receipt()), context({ amount: band({ marketMsat: 250_000n }) }));
    expect(result.ok).toBe(false);
    expect(result.checks.filter((c) => !c.ok).map((c) => [c.check, c.detail])).toEqual([
      ["amount", "paid too few sats for the contribution at today's price"],
    ]);
  });

  it("fails a receipt that doesn't claim the circle's contribution", () => {
    const result = verifyReceiptEvent(fromRelay(receipt()), context({ amount: band({ contribution: 20 }) }));
    expect(result.checks.find((c) => c.check === "amount")?.detail).toMatch(/contribution/);
  });

  it("still needs the invoice to match the sats the receipt records", () => {
    // Alice says she paid 200 sats, but her invoice was for 178.
    const pay = payment("round 3 alice");
    const circle = publicKeyOf(circleSecret);
    const lie = { v: 1, circle, round: 3, ...pay, amountMsat: "200000" };
    return import("nostr-tools/nip44").then(({ encrypt, getConversationKey }) => {
      const event = finalizeEvent(
        {
          kind: RECEIPT_KIND,
          created_at: 1_763_200_005,
          tags: [
            ["p", circle],
            ["round", "3"],
          ],
          content: encrypt(JSON.stringify(lie), getConversationKey(alice, circle)),
        },
        alice,
      );
      const result = verifyReceiptEvent(fromRelay(event), context({ amount: band({ marketMsat: 200_000n }) }));
      expect(result.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["amount"]);
    });
  });

  it("fails every amount when there's no price to compare with", () => {
    expect(amountOutsideBand({ amountMsat: 178_000n, local: { currency: "KES", amount: 15 } }, band({ marketMsat: 0n }))).toMatch(
      /no price/,
    );
  });

  it("puts the edges of the band inside it", () => {
    const local = { currency: "KES", amount: 15 };
    expect(amountOutsideBand({ amountMsat: 80_000n, local }, band({ marketMsat: 100_000n }))).toBeNull();
    expect(amountOutsideBand({ amountMsat: 120_000n, local }, band({ marketMsat: 100_000n }))).toBeNull();
    expect(amountOutsideBand({ amountMsat: 79_999n, local }, band({ marketMsat: 100_000n }))).toMatch(/too few/);
    expect(amountOutsideBand({ amountMsat: 120_001n, local }, band({ marketMsat: 100_000n }))).toMatch(/far more/);
  });
});
