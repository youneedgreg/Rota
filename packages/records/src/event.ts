// Shared handling for events read from a relay, which is never trusted.
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import { getPublicKey, verifyEvent, type Event } from "nostr-tools/pure";

/** Largest encrypted content Rota will try to decrypt (NIP-44 allows up to ~87 KB). */
export const MAX_CONTENT_LENGTH = 16_000;

export const HEX_32 = /^[0-9a-f]{64}$/;

export function isEventShape(value: unknown): value is Event {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.pubkey === "string" &&
    typeof e.sig === "string" &&
    typeof e.content === "string" &&
    typeof e.kind === "number" &&
    typeof e.created_at === "number" &&
    Array.isArray(e.tags) &&
    e.tags.every((t) => Array.isArray(t) && t.every((s) => typeof s === "string"))
  );
}

/** Copies only the signed fields, so no cached "verified" flag or extra field rides along. */
export function plainEvent(event: Event): Event {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  };
}

export function tagValue(event: Event, name: string): string | undefined {
  return event.tags.find((t) => Array.isArray(t) && t[0] === name)?.[1];
}

/** A fresh copy of the event if it's well formed and its signature verifies, else null. */
export function verifiedCopy(input: unknown): Event | null {
  if (!isEventShape(input)) return null;
  const event = plainEvent(input);
  if (!HEX_32.test(event.pubkey) || !verifyEvent(event)) return null;
  return event;
}

/**
 * Decrypts content a member encrypted for the circle, or null. Anyone holding
 * the circle's secret can read it; the relay can't.
 */
export function openForCircle(event: Event, circleSecret: Uint8Array): unknown {
  if (tagValue(event, "p") !== getPublicKey(circleSecret)) return null;
  if (event.content.length > MAX_CONTENT_LENGTH) return null;
  try {
    return JSON.parse(decrypt(event.content, getConversationKey(circleSecret, event.pubkey)));
  } catch {
    return null;
  }
}
