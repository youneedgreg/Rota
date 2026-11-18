import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "lightning-receipts/testing";
import type { Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { assembleCircle, createCircleEvent, createJoinEvent, type CircleView } from "./circle-events";
import { createReceivedEvent } from "./received";
import { createReceiptEvent, newCircleSecret, newMemberSecret, publicKeyOf } from "./records";
import { roundContext, roundView } from "./round";

// Fictional members on reserved example domains. Demo rounds: 10 minutes, late after 5.
const T0 = Date.parse("2026-11-16T06:00:00Z") / 1000;
const node = testKey("round test node");
const nodeKey = nodeKeyOf(node);
const circleSecret = newCircleSecret();
const [amina, bakari, chiku] = [newMemberSecret(), newMemberSecret(), newMemberSecret()];
const profile = (name: string, payoutAddress: string) => ({ name, payoutAddress, knownNodeKeys: [nodeKey] });

const definition = createCircleEvent({
  organizerSecret: amina,
  circleSecret,
  createdAt: T0 - 100,
  draft: {
    name: "Chama ya Wikendi",
    currency: "KES",
    contribution: 15,
    seats: 3,
    schedule: { kind: "demo", startsAt: new Date(T0 * 1000).toISOString(), roundMinutes: 10, graceMinutes: 5 },
    organizer: profile("Amina", "amina@example.com"),
  },
});
const joins = [
  createJoinEvent({ memberSecret: bakari, circleSecret, circleEventId: definition.id, profile: profile("Bakari", "bakari@example.org"), createdAt: T0 - 90 }),
  createJoinEvent({ memberSecret: chiku, circleSecret, circleEventId: definition.id, profile: profile("Chiku", "chiku@example.net"), createdAt: T0 - 80 }),
];
const view = assembleCircle({
  circleSecret,
  circleEventId: definition.id,
  events: JSON.parse(JSON.stringify([definition, ...joins])) as unknown[],
}) as CircleView;

const MARKET = 176_000n;

/** A receipt from `payer` for round 1, which pays Amina. */
function paid(payer: Uint8Array, label: string, paidAt: number, amountMsat = 178_000n): Event {
  const metadata = lnurlMetadata("amina@example.com");
  const [preimage, paymentHash] = testPreimage(label);
  const invoice = makeInvoice({ nodeSecret: node, paymentHash, amountMsat, descriptionHash: sha256Hex(metadata) });
  return createReceiptEvent({
    memberSecret: payer,
    context: { circleSecret, round: 1, recipient: { address: "amina@example.com", knownNodeKeys: [nodeKey] }, expectedAmountMsat: amountMsat },
    payment: { address: "amina@example.com", metadata, invoice, preimage, amountMsat, local: { currency: "KES", amount: 15 }, paidAt },
    createdAt: paidAt,
  });
}

function round1(events: Event[], minutesIn: number, marketMsat: bigint | null = MARKET) {
  return roundView({
    view,
    circleSecret,
    round: 1,
    events: JSON.parse(JSON.stringify(events)) as Event[],
    marketMsat,
    now: new Date((T0 + minutesIn * 60) * 1000),
  });
}

describe("roundView", () => {
  it("names round 1's recipient and lists the other two as pending", () => {
    const r = round1([], 1);
    expect(r.recipient.name).toBe("Amina");
    expect(r.status.state).toBe("open");
    expect(r.status.payers.map((p) => [p.member.name, p.state])).toEqual([
      ["Bakari", "pending"],
      ["Chiku", "pending"],
    ]);
  });

  it("counts a passing receipt as paid and the rest as late after the grace period", () => {
    const r = round1([paid(bakari, "r1 bakari", T0 + 60)], 6);
    expect(r.status.payers.map((p) => [p.member.name, p.state, p.onTime])).toEqual([
      ["Bakari", "paid", true],
      ["Chiku", "late", undefined],
    ]);
    expect(r.receipts).toHaveLength(1);
    expect(r.receipts[0]?.member.name).toBe("Bakari");
  });

  it("completes the round when every payer has paid", () => {
    const r = round1([paid(bakari, "r1 bakari", T0 + 60), paid(chiku, "r1 chiku", T0 + 120)], 3);
    expect(r.status.state).toBe("complete");
    expect(r.status.paidCount).toBe(2);
  });

  it("doesn't count a receipt that paid far too few sats", () => {
    const r = round1([paid(bakari, "r1 bakari short", T0 + 60, 100_000n)], 3);
    expect(r.status.payers[0]?.state).toBe("pending");
    expect(r.receipts[0]?.checks.find((c) => c.check === "amount")?.ok).toBe(false);
  });

  it("marks both members disputed when one copies the other's payment", () => {
    const original = JSON.parse(JSON.stringify(paid(bakari, "r1 shared", T0 + 60))) as Event;
    // Chiku decrypts Bakari's receipt and republishes the same invoice and preimage as her own.
    const copied = paid(chiku, "r1 shared", T0 + 70);
    const r = round1([original, copied], 3);
    expect([...r.disputed].sort()).toEqual([publicKeyOf(bakari), publicKeyOf(chiku)].sort());
    expect(r.status.paidCount).toBe(0);
  });

  describe("the recipient settling a copied payment", () => {
    const original = paid(bakari, "r1 shared", T0 + 60);
    const copied = paid(chiku, "r1 shared", T0 + 70);
    const hash = () => round1([original, copied], 3).disputes[0]?.paymentHash as string;
    const settle = (by: Uint8Array, member: Uint8Array, createdAt: number, round = 1) =>
      createReceivedEvent({ recipientSecret: by, circleSecret, round, settled: [{ paymentHash: hash(), member: publicKeyOf(member) }], createdAt });

    it("lists the dispute for the recipient, oldest claim first", () => {
      const r = round1([copied, original], 3);
      expect(r.disputes).toEqual([{ paymentHash: hash(), claimants: [publicKeyOf(bakari), publicKeyOf(chiku)] }]);
      expect(r.settledFor.size).toBe(0);
    });

    it("counts the payment for the member the recipient names, and not for the copier", () => {
      const r = round1([original, copied, settle(amina, bakari, T0 + 120)], 3);
      expect(r.disputed.size).toBe(0);
      expect([...r.settledFor]).toEqual([publicKeyOf(bakari)]);
      expect([...r.notCounted]).toEqual([publicKeyOf(chiku)]);
      expect(r.disputes[0]?.settledFor).toBe(publicKeyOf(bakari));
      expect(r.status.payers.map((p) => [p.member.name, p.state])).toEqual([
        ["Bakari", "paid"],
        ["Chiku", "pending"],
      ]);
      // The record isn't shown as a failed receipt.
      expect(r.receipts).toHaveLength(2);
      // Only Bakari's receipt counts, so only it goes into a track record.
      expect([...r.counted]).toEqual([original.id]);
    });

    it("ignores a record signed by anyone but the round's recipient", () => {
      const r = round1([original, copied, settle(chiku, chiku, T0 + 120)], 3);
      expect(r.disputed.size).toBe(2);
      expect(r.status.paidCount).toBe(0);
    });

    it("lets the recipient correct a pick: the latest record counts", () => {
      const r = round1([original, copied, settle(amina, chiku, T0 + 200), settle(amina, bakari, T0 + 120)], 3);
      expect([...r.settledFor]).toEqual([publicKeyOf(chiku)]);
      expect([...r.notCounted]).toEqual([publicKeyOf(bakari)]);
    });

    it("ignores a record for another round", () => {
      const r = round1([original, copied, settle(amina, bakari, T0 + 120, 2)], 3);
      expect(r.disputed.size).toBe(2);
    });

    it("lets the copier still pay for real", () => {
      const r = round1([original, copied, settle(amina, bakari, T0 + 120), paid(chiku, "r1 chiku own", T0 + 180)], 4);
      expect(r.status.state).toBe("complete");
      expect(r.notCounted.size).toBe(0);
    });
  });

  it("counts nothing as paid when there's no price to compare amounts with", () => {
    const r = round1([paid(bakari, "r1 bakari", T0 + 60)], 3, null);
    expect(r.status.paidCount).toBe(0);
    expect(r.receipts[0]?.checks.find((c) => c.check === "amount")?.detail).toMatch(/no price/);
  });

  it("reads each event once, even if the relay sends it twice", () => {
    const event = paid(bakari, "r1 bakari", T0 + 60);
    expect(round1([event, event], 3).receipts).toHaveLength(1);
  });

  it("takes the recipient and nodes from the circle for round 2", () => {
    const ctx = roundContext({ view, circleSecret, round: 2, marketMsat: MARKET });
    expect(ctx.recipient).toEqual({ address: "bakari@example.org", knownNodeKeys: [nodeKey] });
    expect(ctx.members).toEqual([publicKeyOf(amina), publicKeyOf(bakari), publicKeyOf(chiku)]);
  });
});
