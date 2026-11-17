// The round recipient's signed "received" record. Every member can decrypt
// every receipt, so one member can copy another's invoice and preimage into a
// receipt of their own, and both then claim the same payment. Only the
// recipient can settle that: their record says which member a disputed
// payment came from. It can't touch a payment nobody else claims, since a
// passing receipt already proves that invoice was paid.
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { finalizeEvent, getPublicKey, type Event } from "nostr-tools/pure";
import { HEX_32, openForCircle, tagValue, verifiedCopy } from "./event";

export const RECEIVED_KIND = 3574;

const VERSION = 1;

/** Most settlements one record may hold: far more than a 20-member round can dispute. */
const MAX_SETTLEMENTS = 50;

/** "The payment with this hash came from this member." */
export interface Settlement {
  paymentHash: string;
  member: string;
}

export class ReceivedRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceivedRecordError";
  }
}

function checkSettlements(settled: readonly Settlement[]): Settlement[] {
  if (settled.length > MAX_SETTLEMENTS) throw new ReceivedRecordError("Too many settlements in one record.");
  const seen = new Set<string>();
  return settled.map((s) => {
    if (!HEX_32.test(s.paymentHash) || !HEX_32.test(s.member)) throw new ReceivedRecordError("A settlement isn't a payment hash and a member key.");
    if (seen.has(s.paymentHash)) throw new ReceivedRecordError("A payment can be settled only once in a record.");
    seen.add(s.paymentHash);
    return { paymentHash: s.paymentHash, member: s.member };
  });
}

/**
 * Signs the recipient's record for one round. Publish the whole list each
 * time: the latest record from the recipient replaces earlier ones.
 */
export function createReceivedEvent(options: {
  recipientSecret: Uint8Array;
  circleSecret: Uint8Array;
  round: number;
  settled: readonly Settlement[];
  createdAt?: number;
}): Event {
  const { round } = options;
  if (!Number.isInteger(round) || round < 1) throw new ReceivedRecordError("The round must be a whole number from 1.");
  const settled = checkSettlements(options.settled);
  const circle = getPublicKey(options.circleSecret);
  const body = { v: VERSION, circle, round, settled };
  return finalizeEvent(
    {
      kind: RECEIVED_KIND,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
      tags: [
        ["p", circle],
        ["round", String(round)],
      ],
      content: encrypt(JSON.stringify(body), getConversationKey(options.recipientSecret, circle)),
    },
    options.recipientSecret,
  );
}

function readBody(raw: unknown, circle: string, round: number): Settlement[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (b.v !== VERSION || b.circle !== circle || b.round !== round || !Array.isArray(b.settled)) return null;
  try {
    return checkSettlements(
      b.settled.map((s: unknown) => {
        const e = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>;
        return { paymentHash: String(e.paymentHash), member: String(e.member) };
      }),
    );
  } catch {
    return null;
  }
}

/**
 * The settlements that count for one round: from the latest well-formed
 * record signed by the round's recipient (taken from the circle's own record,
 * never from an event). Anything else read from the relay is ignored.
 */
export function readSettlements(
  events: readonly unknown[],
  options: { circleSecret: Uint8Array; round: number; recipient: string },
): Map<string, string> {
  const circle = getPublicKey(options.circleSecret);
  let latest: { event: Event; settled: Settlement[] } | null = null;
  for (const input of events) {
    const event = verifiedCopy(input);
    if (!event || event.kind !== RECEIVED_KIND || event.pubkey !== options.recipient) continue;
    if (tagValue(event, "round") !== String(options.round)) continue;
    const settled = readBody(openForCircle(event, options.circleSecret), circle, options.round);
    if (!settled) continue;
    const newer =
      !latest ||
      event.created_at > latest.event.created_at ||
      (event.created_at === latest.event.created_at && event.id > latest.event.id);
    if (newer) latest = { event, settled };
  }
  return new Map((latest?.settled ?? []).map((s) => [s.paymentHash, s.member]));
}
