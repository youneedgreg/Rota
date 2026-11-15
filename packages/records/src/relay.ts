// Talking to the circle's relay. The relay only ever sees signed ciphertext.
import { Relay } from "nostr-tools/relay";
import type { Event } from "nostr-tools/pure";
import { RECEIPT_KIND } from "./records";

const DEFAULT_TIMEOUT_MS = 8_000;

/** Most receipts read in one go; a circle has at most 20 members and one receipt each per round. */
const MAX_RECEIPTS = 500;

function checkRelayUrl(url: string): string {
  const parsed = new URL(url);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "wss:" && !(parsed.protocol === "ws:" && local)) {
    throw new Error("The circle's relay must use wss:// (ws:// only on this computer).");
  }
  return parsed.toString();
}

/** Publishes one receipt event and waits for the relay to accept it. */
export async function publishReceipt(relayUrl: string, event: Event, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const relay = await Relay.connect(checkRelayUrl(relayUrl), { timeout: timeoutMs });
  relay.publishTimeout = timeoutMs;
  try {
    await relay.publish(event);
  } finally {
    relay.close();
  }
}

/**
 * Reads a circle's receipts from its relay, optionally for one round. The
 * events still need `verifyReceiptEvent`: the relay is not trusted.
 */
export async function fetchReceipts(
  relayUrl: string,
  circle: string,
  options: { round?: number; timeoutMs?: number } = {},
): Promise<Event[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const relay = await Relay.connect(checkRelayUrl(relayUrl), { timeout: timeoutMs });
  try {
    return await new Promise<Event[]>((resolve) => {
      const events: Event[] = [];
      const sub = relay.subscribe([{ kinds: [RECEIPT_KIND], "#p": [circle], limit: MAX_RECEIPTS }], {
        eoseTimeout: timeoutMs,
        onevent(event) {
          if (events.length >= MAX_RECEIPTS) return;
          if (options.round !== undefined && !event.tags.some((t) => t[0] === "round" && t[1] === String(options.round))) return;
          events.push(event);
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
