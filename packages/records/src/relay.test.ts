// Runs only against a local relay: ROTA_TEST_RELAY=ws://127.0.0.1:7777 pnpm --filter @rota/records test
// (start it with `docker compose up relay`). Skipped in CI.
import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "@rota/receipts/testing";
import { describe, expect, it } from "vitest";
import { createReceiptEvent, newCircleSecret, newMemberSecret, publicKeyOf, roundClaims, verifyReceiptEvent } from "./records";
import { fetchReceipts, publishReceipt } from "./relay";

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
      expectedAmountMsat: 178_000n,
    };

    const event = createReceiptEvent({
      memberSecret: member,
      context: ctx,
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
});

it("refuses an insecure relay address that isn't on this computer", async () => {
  await expect(fetchReceipts("ws://relay.example.com", "00".repeat(32))).rejects.toThrow(/wss/);
});
