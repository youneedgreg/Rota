// Talking to the circle's relay. The relay only ever sees signed ciphertext,
// and nothing read from it is trusted until it's checked.
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import { CIRCLE_KIND, JOIN_KIND, ROSTER_KIND } from "./circle-events";
import { RECEIPT_KIND } from "./records";
import { RECEIVED_KIND } from "./received";

const DEFAULT_TIMEOUT_MS = 8_000;

/** Most events read in one go; a circle has at most 20 members. */
const MAX_EVENTS = 500;

function checkRelayUrl(url: string): string {
  const parsed = new URL(url);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "wss:" && !(parsed.protocol === "ws:" && local)) {
    throw new Error("The circle's relay must use wss:// (ws:// only on this computer).");
  }
  return parsed.toString();
}

/** Publishes one event and waits for the relay to accept it. */
export async function publishEvent(relayUrl: string, event: Event, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const relay = await Relay.connect(checkRelayUrl(relayUrl), { timeout: timeoutMs });
  relay.publishTimeout = timeoutMs;
  try {
    await relay.publish(event);
  } finally {
    relay.close();
  }
}

/** Reads the events matching a filter, up to the relay's "end of stored events". */
export async function fetchEvents(relayUrl: string, filter: Filter, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Event[]> {
  const relay = await Relay.connect(checkRelayUrl(relayUrl), { timeout: timeoutMs });
  try {
    return await new Promise<Event[]>((resolve) => {
      const events: Event[] = [];
      const sub = relay.subscribe([{ ...filter, limit: Math.min(filter.limit ?? MAX_EVENTS, MAX_EVENTS) }], {
        eoseTimeout: timeoutMs,
        onevent(event) {
          if (events.length < MAX_EVENTS) events.push(event);
        },
        oneose() {
          sub.close();
          resolve(events);
        },
        onclose() {
          resolve(events);
        },
      });
    });
  } finally {
    relay.close();
  }
}

/** Publishes one receipt event and waits for the relay to accept it. */
export const publishReceipt = publishEvent;

/**
 * Reads a circle's receipts from its relay, optionally for one round. The
 * events still need `verifyReceiptEvent`: the relay is not trusted.
 */
export async function fetchReceipts(
  relayUrl: string,
  circle: string,
  options: { round?: number; timeoutMs?: number } = {},
): Promise<Event[]> {
  const events = await fetchEvents(relayUrl, { kinds: [RECEIPT_KIND], "#p": [circle] }, options.timeoutMs);
  if (options.round === undefined) return events;
  const round = String(options.round);
  return events.filter((event) => event.tags.some((t) => t[0] === "round" && t[1] === round));
}

/**
 * Reads one round's receipts and the recipient's "received" records. Pass
 * them to `roundView`, which checks every one: the relay is not trusted.
 */
export async function fetchRound(relayUrl: string, circle: string, round: number, timeoutMs?: number): Promise<Event[]> {
  // Relays index single-letter tags only, so the round is picked out here.
  const events = await fetchEvents(relayUrl, { kinds: [RECEIPT_KIND, RECEIVED_KIND], "#p": [circle] }, timeoutMs);
  return events.filter((event) => event.tags.some((t) => t[0] === "round" && t[1] === String(round)));
}

/** Reads every round's receipts and "received" records for a circle, for a track record. */
export async function fetchRounds(relayUrl: string, circle: string, timeoutMs?: number): Promise<Event[]> {
  return fetchEvents(relayUrl, { kinds: [RECEIPT_KIND, RECEIVED_KIND], "#p": [circle] }, timeoutMs);
}

/** Reads a circle's definition, joins and roster. Pass them to `assembleCircle`. */
export async function fetchCircle(relayUrl: string, circle: string, timeoutMs?: number): Promise<Event[]> {
  return fetchEvents(relayUrl, { kinds: [CIRCLE_KIND, JOIN_KIND, ROSTER_KIND], "#p": [circle] }, timeoutMs);
}
