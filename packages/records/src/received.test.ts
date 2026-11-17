import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "@rota/receipts/testing";
import { describe, expect, it } from "vitest";
import { createReceivedEvent, readSettlements, RECEIVED_KIND, ReceivedRecordError } from "./received";
import { createReceiptEvent, newCircleSecret, newMemberSecret, publicKeyOf, roundClaims, verifyReceiptEvent, type CircleContext } from "./records";

// Fictional members on a reserved example domain.
const circleSecret = newCircleSecret();
const [recipient, alice, bob, carol] = [newMemberSecret(), newMemberSecret(), newMemberSecret(), newMemberSecret()];
const HASH_A = "a".repeat(64);

const record = (settled: { paymentHash: string; member: string }[], createdAt = 1_763_200_100, round = 3, by = recipient) =>
  createReceivedEvent({ recipientSecret: by, circleSecret, round, settled, createdAt });
const read = (events: unknown[], round = 3) =>
  readSettlements(JSON.parse(JSON.stringify(events)) as unknown[], { circleSecret, round, recipient: publicKeyOf(recipient) });

describe("createReceivedEvent", () => {
  it("tags the circle and round and keeps the settlements encrypted", () => {
    const event = record([{ paymentHash: HASH_A, member: publicKeyOf(alice) }]);
    expect(event.kind).toBe(RECEIVED_KIND);
    expect(event.pubkey).toBe(publicKeyOf(recipient));
    expect(event.tags).toEqual([
      ["p", publicKeyOf(circleSecret)],
      ["round", "3"],
    ]);
    expect(event.content).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(event.content).not.toContain(publicKeyOf(alice));
  });

  it.each([
    ["a bad payment hash", [{ paymentHash: "xyz", member: "a".repeat(64) }], 3],
    ["a bad member key", [{ paymentHash: HASH_A, member: "Alice" }], 3],
    ["one payment settled twice", [{ paymentHash: HASH_A, member: "c".repeat(64) }, { paymentHash: HASH_A, member: "d".repeat(64) }], 3],
    ["round 0", [], 0],
  ])("refuses %s", (_name, settled, round) => {
    expect(() => record(settled, undefined, round)).toThrow(ReceivedRecordError);
  });
});

describe("readSettlements", () => {
  it("reads back what the recipient signed", () => {
    const settled = read([record([{ paymentHash: HASH_A, member: publicKeyOf(alice) }])]);
    expect([...settled]).toEqual([[HASH_A, publicKeyOf(alice)]]);
  });

  it("takes the latest record, whatever order the relay sends them in", () => {
    const later = record([{ paymentHash: HASH_A, member: publicKeyOf(bob) }], 1_763_200_200);
    const earlier = record([{ paymentHash: HASH_A, member: publicKeyOf(alice) }], 1_763_200_100);
    expect(read([later, earlier]).get(HASH_A)).toBe(publicKeyOf(bob));
    expect(read([earlier, later]).get(HASH_A)).toBe(publicKeyOf(bob));
  });

  it("ignores records from anyone else, for another round, or that were changed", () => {
    const byAlice = record([{ paymentHash: HASH_A, member: publicKeyOf(alice) }], 1_763_200_300, 3, alice);
    const otherRound = record([{ paymentHash: HASH_A, member: publicKeyOf(alice) }], 1_763_200_300, 4);
    const changed = { ...record([{ paymentHash: HASH_A, member: publicKeyOf(alice) }], 1_763_200_300), created_at: 1_763_200_400 };
    expect(read([byAlice, otherRound, changed]).size).toBe(0);
  });

  it("ignores a record copied to another round's tag", () => {
    const event = record([{ paymentHash: HASH_A, member: publicKeyOf(alice) }]);
    // Changing the tag breaks the recipient's signature.
    const retagged = { ...event, tags: [event.tags[0], ["round", "4"]] };
    expect(read([retagged], 4).size).toBe(0);
  });

  it("ignores things that aren't events", () => {
    expect(read([null, 42, { kind: RECEIVED_KIND }]).size).toBe(0);
  });
});

describe("roundClaims with the recipient's settlements", () => {
  const node = testKey("received test node");
  const address = "dana@example.com";
  const metadata = lnurlMetadata(address);
  const context: CircleContext = {
    circleSecret,
    members: [alice, bob, carol].map(publicKeyOf),
    round: 3,
    recipient: { address, knownNodeKeys: [nodeKeyOf(node)] },
    amount: 178_000n,
  };
  const receipt = (member: Uint8Array, label: string) => {
    const [preimage, paymentHash] = testPreimage(label);
    const invoice = makeInvoice({ nodeSecret: node, paymentHash, amountMsat: 178_000n, descriptionHash: sha256Hex(metadata) });
    const event = createReceiptEvent({
      memberSecret: member,
      context: { ...context, expectedAmountMsat: 178_000n },
      payment: { address, metadata, invoice, preimage, amountMsat: 178_000n, local: null, paidAt: 1_763_200_000 },
      createdAt: 1_763_200_005,
    });
    return { result: verifyReceiptEvent(event, context), paymentHash };
  };
  const shared = receipt(alice, "shared");
  const copy = receipt(bob, "shared");
  const carolOwn = receipt(carol, "carol");
  const results = [shared.result, copy.result, carolOwn.result];

  it("keeps both claimants disputed until it's settled", () => {
    const claims = roundClaims(results);
    expect(claims.get(publicKeyOf(alice))).toBe("disputed");
    expect(claims.get(publicKeyOf(bob))).toBe("disputed");
    expect(claims.get(publicKeyOf(carol))).toBe("paid");
  });

  it("counts it for the member the recipient names and not for the other", () => {
    const claims = roundClaims(results, new Map([[shared.paymentHash, publicKeyOf(bob)]]));
    expect(claims.get(publicKeyOf(bob))).toBe("paid");
    expect(claims.get(publicKeyOf(alice))).toBe("not-counted");
  });

  it("stays disputed when the record names someone who doesn't claim the payment", () => {
    const claims = roundClaims(results, new Map([[shared.paymentHash, publicKeyOf(carol)]]));
    expect(claims.get(publicKeyOf(alice))).toBe("disputed");
    expect(claims.get(publicKeyOf(bob))).toBe("disputed");
  });

  it("can't overrule a payment only one member claims", () => {
    const claims = roundClaims(results, new Map([[carolOwn.paymentHash, publicKeyOf(alice)]]));
    expect(claims.get(publicKeyOf(carol))).toBe("paid");
    expect(claims.get(publicKeyOf(alice))).toBe("disputed");
  });

  it("counts a member who lost a dispute but also paid on their own", () => {
    const bobOwn = receipt(bob, "bob own");
    const claims = roundClaims([...results, bobOwn.result], new Map([[shared.paymentHash, publicKeyOf(alice)]]));
    expect(claims.get(publicKeyOf(bob))).toBe("paid");
  });
});
