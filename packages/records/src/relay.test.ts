// Runs only against a local relay: ROTA_TEST_RELAY=ws://127.0.0.1:7777 pnpm --filter @rota/records test
// (start it with `docker compose up relay`). Skipped in CI.
import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "lightning-receipts/testing";
import { describe, expect, it } from "vitest";
import { assembleCircle, createCircleEvent, createJoinEvent, createRosterEvent, decodeInvite, encodeInvite } from "./circle-events";
import { createReceiptEvent, newCircleSecret, newMemberSecret, publicKeyOf, roundClaims, verifyReceiptEvent } from "./records";
import { createReceivedEvent, readSettlements } from "./received";
import { fetchCircle, fetchReceipts, fetchRound, publishEvent, publishReceipt } from "./relay";

const RELAY = process.env.ROTA_TEST_RELAY;

describe.skipIf(!RELAY)("receipts on a real relay", () => {
  it("publishes a receipt, reads it back by circle and round, and verifies it", async () => {
    const url = RELAY as string;
    const address = "alice@example.com";
    const metadata = lnurlMetadata(address);
    const node = testKey("relay test node");
    const [preimage, paymentHash] = testPreimage(`relay test ${Date.now()}`);
    const circleSecret = newCircleSecret();
    const member = newMemberSecret();
    const ctx = {
      circleSecret,
      members: [publicKeyOf(member)],
      round: 1,
      recipient: { address, knownNodeKeys: [nodeKeyOf(node)] },
      amount: 178_000n,
    };

    const event = createReceiptEvent({
      memberSecret: member,
      context: { ...ctx, expectedAmountMsat: 178_000n },
      payment: {
        address,
        metadata,
        invoice: makeInvoice({ nodeSecret: node, paymentHash, amountMsat: 178_000n, descriptionHash: sha256Hex(metadata) }),
        preimage,
        amountMsat: 178_000n,
        local: { currency: "KES", amount: 15 },
        paidAt: Math.floor(Date.now() / 1000),
      },
    });
    await publishReceipt(url, event);

    const circle = publicKeyOf(circleSecret);
    expect(await fetchReceipts(url, circle, { round: 2 })).toEqual([]);

    const events = await fetchReceipts(url, circle, { round: 1 });
    expect(events.map((e) => e.id)).toEqual([event.id]);
    const result = verifyReceiptEvent(events[0], ctx);
    expect(result.ok).toBe(true);
    expect(roundClaims([result]).get(publicKeyOf(member))).toBe("paid");
  });

  it("reads one round's receipts and the recipient's record together", async () => {
    const url = RELAY as string;
    const circleSecret = newCircleSecret();
    const recipient = newMemberSecret();
    const settled = [{ paymentHash: "a".repeat(64), member: publicKeyOf(newMemberSecret()) }];
    const forRound = (round: number) => createReceivedEvent({ recipientSecret: recipient, circleSecret, round, settled });
    const [one, two] = [forRound(1), forRound(2)];
    await publishEvent(url, one);
    await publishEvent(url, two);

    const events = await fetchRound(url, publicKeyOf(circleSecret), 2);
    expect(events.map((e) => e.id)).toEqual([two.id]);
    const read = readSettlements(events, { circleSecret, round: 2, recipient: publicKeyOf(recipient) });
    expect(read.get("a".repeat(64))).toBe(settled[0]?.member);
  });

  it("creates a circle, fills its seats, seals it and reads it back", async () => {
    const url = RELAY as string;
    const node = nodeKeyOf(testKey("relay test node"));
    const circleSecret = newCircleSecret();
    const [organizer, bob, carol] = [newMemberSecret(), newMemberSecret(), newMemberSecret()];
    const profile = (name: string, payoutAddress: string) => ({ name, payoutAddress, knownNodeKeys: [node] });
    const t = Math.floor(Date.now() / 1000);

    const definition = createCircleEvent({
      organizerSecret: organizer,
      circleSecret,
      createdAt: t,
      draft: {
        name: "Relay test circle",
        currency: "KES",
        contribution: 15,
        seats: 3,
        schedule: { kind: "demo", startsAt: new Date().toISOString(), roundMinutes: 10, graceMinutes: 5 },
        organizer: profile("Amina", "amina@example.com"),
      },
    });
    const invite = decodeInvite(encodeInvite(circleSecret, definition.id));
    if (!invite) throw new Error("invite didn't decode");
    await publishEvent(url, definition);
    for (const [secret, who, at] of [
      [bob, profile("Bakari", "bakari@example.org"), t + 1],
      [carol, profile("Chiku", "0712345678@bitcoin.co.ke"), t + 2],
    ] as const) {
      await publishEvent(url, createJoinEvent({ memberSecret: secret, ...invite, profile: who, createdAt: at }));
    }

    const circle = publicKeyOf(circleSecret);
    const before = assembleCircle({ ...invite, events: await fetchCircle(url, circle) });
    expect(before?.full).toBe(true);
    expect(before?.sealed).toBe(false);

    const members = before?.members.map((m) => m.pubkey) ?? [];
    await publishEvent(url, createRosterEvent({ organizerSecret: organizer, ...invite, members, createdAt: t + 3 }));
    const after = assembleCircle({ ...invite, events: await fetchCircle(url, circle) });
    expect(after?.sealed).toBe(true);
    expect(after?.members.map((m) => m.name)).toEqual(["Amina", "Bakari", "Chiku"]);
  });
});

it("refuses an insecure relay address that isn't on this computer", async () => {
  await expect(fetchReceipts("ws://relay.example.com", "00".repeat(32))).rejects.toThrow(/wss/);
});
