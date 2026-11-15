// One round of a circle, as a member's device sees it: who receives, who has
// paid, and every receipt with the result of its checks. Everything here is
// worked out from the circle's own record and the receipts on the relay;
// nothing is taken on trust from a receipt itself.
import { getRound, roundStatus, type Payment, type RoundStatus } from "@rota/circles";
import type { Event } from "nostr-tools/pure";
import type { CircleMember, CircleView } from "./circle-events";
import { AMOUNT_TOLERANCE, roundClaims, verifyReceiptEvent, type CircleContext, type ReceiptEventResult } from "./records";

export interface CheckedReceipt extends ReceiptEventResult {
  eventId: string;
  /** The member who signed it, if they're in the circle. */
  member: ReceiptEventResult["member"] & { name?: string };
}

export interface RoundView {
  status: RoundStatus;
  recipient: CircleMember;
  /** Members whose payment another member also claims; not counted until it's settled. */
  disputed: Set<string>;
  /** Every receipt for this round, passing or not, newest first. */
  receipts: CheckedReceipt[];
}

/** The context a member's device checks this round's receipts against. */
export function roundContext(options: {
  view: CircleView;
  circleSecret: Uint8Array;
  round: number;
  /** What the contribution costs at today's price; null when no price could be had. */
  marketMsat: bigint | null;
  network?: string;
}): CircleContext {
  const { view, round } = options;
  if (!view.circle) throw new RangeError("The circle isn't full yet.");
  const recipientId = getRound(view.circle, round).recipient.id;
  const recipient = view.members.find((m) => m.pubkey === recipientId);
  if (!recipient) throw new RangeError("The round's recipient isn't in the circle.");
  return {
    circleSecret: options.circleSecret,
    members: view.members.map((m) => m.pubkey),
    round,
    recipient: { address: recipient.payoutAddress, knownNodeKeys: recipient.knownNodeKeys },
    amount: {
      currency: view.draft.currency,
      contribution: view.draft.contribution,
      // No price: every amount check fails with "no price to compare", so nothing counts as paid by mistake.
      marketMsat: options.marketMsat ?? 0n,
      tolerance: AMOUNT_TOLERANCE,
    },
    ...(options.network ? { network: options.network } : {}),
  };
}

/**
 * Checks every receipt for one round and works out who has paid. A member
 * counts as paid only with a receipt that passes all checks and a payment no
 * other member also claims; the time paid is the one in their receipt.
 */
export function roundView(options: {
  view: CircleView;
  circleSecret: Uint8Array;
  round: number;
  events: readonly Event[];
  marketMsat: bigint | null;
  now: Date;
  network?: string;
}): RoundView {
  const { view, round } = options;
  const context = roundContext(options);
  const circle = view.circle;
  if (!circle) throw new RangeError("The circle isn't full yet.");

  const names = new Map(view.members.map((m) => [m.pubkey, m.name]));
  const receipts: CheckedReceipt[] = [];
  const seen = new Set<string>();
  for (const event of options.events) {
    if (typeof event?.id !== "string" || seen.has(event.id)) continue;
    seen.add(event.id);
    const result = verifyReceiptEvent(event, context);
    const name = names.get(result.member.pubkey);
    receipts.push({ ...result, eventId: event.id, member: { ...result.member, ...(name ? { name } : {}) } });
  }
  receipts.sort((a, b) => (b.content?.paidAt ?? 0) - (a.content?.paidAt ?? 0));

  const claims = roundClaims(receipts);
  const disputed = new Set([...claims].filter(([, claim]) => claim === "disputed").map(([pubkey]) => pubkey));
  const payments: Payment[] = receipts
    .filter((r) => r.ok && r.content && claims.get(r.member.pubkey) === "paid")
    .map((r) => ({ round, memberId: r.member.pubkey, paidAt: new Date((r.content?.paidAt ?? 0) * 1000) }));

  const recipientId = getRound(circle, round).recipient.id;
  const recipient = view.members.find((m) => m.pubkey === recipientId) as CircleMember;
  return { status: roundStatus(circle, round, payments, options.now), recipient, disputed, receipts };
}
