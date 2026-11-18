import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "lightning-receipts/testing";
import { finalizeEvent, type Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { createReceiptEvent, newCircleSecret, newMemberSecret, publicKeyOf } from "./records";
import { createTrackRecord, TRACK_RECORD_KIND, TrackRecordError, verifyTrackRecord, type TrackRecordCircle } from "./track-record";

// Fictional members and recipients on reserved example domains.
const T0 = Date.parse("2026-11-16T06:00:00Z") / 1000;
const node = testKey("track record node");
const nodeKey = nodeKeyOf(node);
const circleSecret = newCircleSecret();
const circle = publicKeyOf(circleSecret);
const [alice, bob] = [newMemberSecret(), newMemberSecret()];
const AMOUNT = 178_000n;

function receipt(payer: Uint8Array, round: number, address: string, issuedAt: number, label = `${round} ${address}`): Event {
  const metadata = lnurlMetadata(address);
  const [preimage, paymentHash] = testPreimage(label);
  const invoice = makeInvoice({ nodeSecret: node, paymentHash, amountMsat: AMOUNT, descriptionHash: sha256Hex(metadata), timestamp: issuedAt });
  return createReceiptEvent({
    memberSecret: payer,
    context: { circleSecret, round, recipient: { address, knownNodeKeys: [nodeKey] }, expectedAmountMsat: AMOUNT },
    payment: { address, metadata, invoice, preimage, amountMsat: AMOUNT, local: { currency: "KES", amount: 15 }, paidAt: issuedAt + 5 },
    createdAt: issuedAt + 6,
  });
}

// Round 1 pays Dana (Alice on time), round 2 pays Eli (Alice late).
const r1 = receipt(alice, 1, "dana@example.com", T0 + 60);
const r2 = receipt(alice, 2, "eli@example.org", T0 + 4000);
const lateAfter = { "1": new Date((T0 + 300) * 1000).toISOString(), "2": new Date((T0 + 3900) * 1000).toISOString() };

function circleEntry(receipts: Event[], overrides: Partial<TrackRecordCircle> = {}): TrackRecordCircle {
  return {
    circle,
    name: "Chama ya Wikendi",
    currency: "KES",
    contribution: 15,
    recipients: [
      { address: "dana@example.com", knownNodeKeys: [nodeKey] },
      { address: "eli@example.org", knownNodeKeys: [nodeKey] },
    ],
    lateAfter,
    receipts,
    ...overrides,
  };
}

/** As the file would arrive: written to JSON and read back. */
const asFile = (event: Event): unknown => JSON.parse(JSON.stringify(event));

describe("track records", () => {
  it("checks every receipt in a member's file and counts on-time and late payments", () => {
    const file = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r2, r1])], createdAt: T0 + 9000 });
    const result = verifyTrackRecord(asFile(file));
    expect(result.ok).toBe(true);
    expect(result.member).toBe(publicKeyOf(alice));
    expect(result.totals).toEqual({ proven: 2, failed: 0, onTime: 1, late: 1 });
    const [first, second] = result.circles[0]?.receipts ?? [];
    expect(first?.round).toBe(1);
    expect(first?.checks.every((c) => c.ok)).toBe(true);
    expect(first?.member.ok).toBe(true);
    expect(first?.sats).toBe(178n);
    expect(first?.invoiceIssuedAt?.getTime()).toBe((T0 + 60) * 1000);
    expect(second?.onTime).toBe(false);
  });

  it("refuses a file changed after the member signed it", () => {
    const file = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1])] });
    const changed = { ...file, content: file.content.replace("Chama ya Wikendi", "Chama Kubwa") };
    expect(verifyTrackRecord(changed).ok).toBe(false);
  });

  it("refuses an event that isn't a track record", () => {
    expect(verifyTrackRecord(asFile(r1)).problem).toMatch(/isn't a Rota track record/);
    expect(verifyTrackRecord("not json at all").ok).toBe(false);
  });

  it("won't export another member's receipt", () => {
    const bobs = receipt(bob, 1, "dana@example.com", T0 + 70, "bob r1");
    expect(() => createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1, bobs])] })).toThrow(TrackRecordError);
  });

  it("fails a receipt someone else published, even when slipped into a signed file", () => {
    const bobs = receipt(bob, 1, "dana@example.com", T0 + 70, "bob r1");
    const honest = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1])] });
    const body = JSON.parse(honest.content) as { v: number; circles: (TrackRecordCircle & { conversationKey: string })[] };
    body.circles[0]?.receipts.push(bobs);
    const forged = finalizeEvent({ kind: TRACK_RECORD_KIND, created_at: T0, tags: [], content: JSON.stringify(body) }, alice);
    const result = verifyTrackRecord(asFile(forged));
    expect(result.totals).toEqual({ proven: 1, failed: 1, onTime: 1, late: 0 });
    expect(result.circles[0]?.receipts.find((r) => !r.ok)?.member.detail).toMatch(/someone other than this member/);
  });

  it("gives a key that opens only the member's own receipts", () => {
    const bobs = receipt(bob, 1, "dana@example.com", T0 + 70, "bob r1");
    const bobsFile = createTrackRecord({ memberSecret: bob, circles: [circleEntry([bobs])] });
    const alicesFile = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1])] });
    const bobKey = (JSON.parse(bobsFile.content) as { circles: { conversationKey: string }[] }).circles[0]?.conversationKey;
    const aliceKey = (JSON.parse(alicesFile.content) as { circles: { conversationKey: string }[] }).circles[0]?.conversationKey;
    expect(bobKey).not.toBe(aliceKey);
    // Alice's file signed with Bob's key in it: her receipts don't open.
    const body = JSON.parse(alicesFile.content) as { v: number; circles: { conversationKey: string }[] };
    if (body.circles[0] && bobKey) body.circles[0].conversationKey = bobKey;
    const swapped = finalizeEvent({ kind: TRACK_RECORD_KIND, created_at: T0, tags: [], content: JSON.stringify(body) }, alice);
    expect(verifyTrackRecord(asFile(swapped)).circles[0]?.receipts[0]?.member.detail).toMatch(/couldn't be opened/);
  });

  it("counts a payment listed twice only once", () => {
    const file = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1, r1])] });
    const result = verifyTrackRecord(asFile(file));
    expect(result.totals.proven).toBe(1);
    expect(result.circles[0]?.receipts.filter((r) => r.duplicate)).toHaveLength(1);
  });

  it("fails the issuer check when the file states no node for the address", () => {
    const file = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1], { recipients: [] })] });
    const checks = verifyTrackRecord(asFile(file)).circles[0]?.receipts[0]?.checks ?? [];
    expect(checks.find((c) => c.check === "issuer")?.ok).toBe(false);
    expect(checks.find((c) => c.check === "paid")?.ok).toBe(true);
  });

  it("refuses receipts from another network", () => {
    const file = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1])] });
    expect(verifyTrackRecord(asFile(file), { network: "bcrt" }).totals.failed).toBe(1);
  });

  it.each([
    ["a very long circle name", { name: "x".repeat(81) }],
    ["a contribution that isn't a positive number", { contribution: -15 }],
    ["too many receipts", { receipts: Array.from({ length: 101 }, () => r1) }],
  ])("refuses a file with %s", (_name, overrides) => {
    const honest = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1])] });
    const body = JSON.parse(honest.content) as { v: number; circles: Record<string, unknown>[] };
    body.circles[0] = { ...body.circles[0], ...overrides };
    const file = finalizeEvent({ kind: TRACK_RECORD_KIND, created_at: T0, tags: [], content: JSON.stringify(body) }, alice);
    expect(verifyTrackRecord(asFile(file)).problem).toMatch(/can't be read/);
  });

  it("leaves on-time unknown when the file gives no deadline", () => {
    const file = createTrackRecord({ memberSecret: alice, circles: [circleEntry([r1], { lateAfter: {} })] });
    const result = verifyTrackRecord(asFile(file));
    expect(result.circles[0]?.receipts[0]?.onTime).toBeUndefined();
    expect(result.totals).toEqual({ proven: 1, failed: 0, onTime: 0, late: 0 });
  });
});
