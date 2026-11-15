import type { Circle, Member } from "./circle";
import { getRound } from "./rounds";

/**
 * Where a round stands. The caller passes only payments whose receipts
 * passed verifyReceipt; this module decides paid, pending or late, it doesn't
 * decide whether a payment happened.
 */

export interface Payment {
  round: number;
  memberId: string;
  paidAt: Date;
}

export type PayerState = "paid" | "pending" | "late";

export interface PayerStatus {
  member: Member;
  state: PayerState;
  /** Set when state is "paid". */
  paidAt?: Date;
  /** Set when state is "paid": whether it arrived by the round's lateAfter. */
  onTime?: boolean;
}

export type RoundState = "upcoming" | "open" | "complete";

export interface RoundStatus {
  number: number;
  state: RoundState;
  recipient: Member;
  payers: PayerStatus[];
  paidCount: number;
  /** Payments that don't fit this round: from the recipient or a non-member. Shown, not counted. */
  ignored: Payment[];
}

export function roundStatus(circle: Circle, number: number, payments: readonly Payment[], now: Date): RoundStatus {
  const round = getRound(circle, number);
  const payerIds = new Set(round.payers.map((m) => m.id));

  // First valid payment per member wins; a second one is a member paying twice.
  const firstPaid = new Map<string, Date>();
  const ignored: Payment[] = [];
  for (const payment of payments) {
    if (payment.round !== number) continue;
    if (!payerIds.has(payment.memberId)) {
      ignored.push(payment);
      continue;
    }
    const seen = firstPaid.get(payment.memberId);
    if (!seen || payment.paidAt.getTime() < seen.getTime()) firstPaid.set(payment.memberId, payment.paidAt);
  }

  const late = now.getTime() > round.lateAfter.getTime();
  const payers = round.payers.map((member): PayerStatus => {
    const paidAt = firstPaid.get(member.id);
    if (paidAt) return { member, state: "paid", paidAt, onTime: paidAt.getTime() <= round.lateAfter.getTime() };
    return { member, state: late ? "late" : "pending" };
  });

  const paidCount = payers.filter((p) => p.state === "paid").length;
  const state: RoundState =
    paidCount === payers.length ? "complete" : now.getTime() < round.opensAt.getTime() ? "upcoming" : "open";

  return { number, state, recipient: round.recipient, payers, paidCount, ignored };
}
