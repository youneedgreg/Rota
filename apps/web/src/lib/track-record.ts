// This device's member's track record: every receipt that counted as their
// payment, in every circle on this device, signed into one file. Client-only.
import { currentRound, getRound } from "@rota/circles";
import {
  createTrackRecord,
  decodeInvite,
  fetchRounds,
  roundView,
  type StatedRecipient,
  type TrackRecordCircle,
} from "@rota/records";
import { loadCircle, memberPubkey, memberSecret, relayUrl, savedCircles } from "./circles";
import { invoiceNetwork, marketMsatFor, unsentReceipts } from "./rounds";

/** A signed Nostr event, as @rota/records makes it. */
type Event = ReturnType<typeof createTrackRecord>;

export interface MyTrackRecord {
  file: Event;
  circles: number;
  receipts: number;
}

const roundOf = (e: Event) => e.tags.find((t) => t[0] === "round")?.[1];

/**
 * Reads every circle on this device from the relay, works out each round the
 * way the round screen does (receipts checked here, disputes settled by the
 * recipient), and keeps this member's receipts that counted.
 */
export async function buildMyTrackRecord(): Promise<MyTrackRecord> {
  const me = memberPubkey();
  const now = new Date();
  const network = invoiceNetwork();
  const circles: TrackRecordCircle[] = [];

  for (const saved of savedCircles()) {
    const decoded = decodeInvite(saved.invite);
    const view = await loadCircle(saved.invite).catch(() => null);
    if (!decoded || !view?.circle || !view.members.some((m) => m.pubkey === me)) continue;
    const open = currentRound(view.circle, now);
    if (!open) continue;

    const mine = unsentReceipts().filter((e) => e.tags.some((t) => t[0] === "p" && t[1] === view.circlePubkey));
    const events = [...(await fetchRounds(relayUrl(), view.circlePubkey)), ...mine];
    const marketMsat = await marketMsatFor(view);

    const receipts: Event[] = [];
    const recipients = new Map<string, StatedRecipient>();
    const lateAfter: Record<string, string> = {};
    for (let n = 1; n <= open.number; n++) {
      const inRound = events.filter((e) => roundOf(e) === String(n));
      const round = roundView({ view, circleSecret: decoded.circleSecret, round: n, events: inRound, marketMsat, now, network });
      const counted = round.receipts.filter((r) => r.member.pubkey === me && round.counted.has(r.eventId));
      if (counted.length === 0) continue;
      for (const r of counted) {
        const original = inRound.find((e) => e.id === r.eventId);
        if (original && !receipts.some((e) => e.id === original.id)) receipts.push(original);
      }
      recipients.set(round.recipient.payoutAddress, {
        address: round.recipient.payoutAddress,
        knownNodeKeys: [...round.recipient.knownNodeKeys],
      });
      lateAfter[String(n)] = getRound(view.circle, n).lateAfter.toISOString();
    }
    if (receipts.length === 0) continue;
    circles.push({
      circle: view.circlePubkey,
      name: view.draft.name,
      currency: view.draft.currency,
      contribution: view.draft.contribution,
      recipients: [...recipients.values()],
      lateAfter,
      receipts,
    });
  }

  const file = createTrackRecord({ memberSecret: memberSecret(), circles });
  return { file, circles: circles.length, receipts: circles.reduce((n, c) => n + c.receipts.length, 0) };
}

/** Hands the file to the browser as a download. */
export function downloadTrackRecord(file: Event): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const day = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  a.download = `rota-track-record-${day}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
