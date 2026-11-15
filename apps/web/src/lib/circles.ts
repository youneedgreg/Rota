// Circles on the relay, from the member's browser. Client-only.
// Rota's server never sees a circle: the invite link's secret stays after "#",
// which browsers don't send to any server.
import { normalizeAddress, probeAddress } from "@rota/circles";
import {
  assembleCircle,
  createCircleEvent,
  createJoinEvent,
  createRosterEvent,
  decodeInvite,
  encodeInvite,
  fetchCircle,
  newCircleSecret,
  newMemberSecret,
  publicKeyOf,
  publishEvent,
  type CircleDraft,
  type CircleView,
  type MemberProfile,
} from "@rota/records";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const MEMBER_KEY = "rota.member.v1";
const CIRCLES_KEY = "rota.circles.v1";

/** The circle's relay. Local strfry unless NEXT_PUBLIC_RELAY_URL says otherwise. */
export function relayUrl(): string {
  return process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:7777";
}

/**
 * This device's Nostr key. It signs joins and receipts but can't move money,
 * so it's kept in plain browser storage (see DECISIONS.md).
 */
export function memberSecret(): Uint8Array {
  const saved = localStorage.getItem(MEMBER_KEY);
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return hexToBytes(saved);
  const secret = newMemberSecret();
  localStorage.setItem(MEMBER_KEY, bytesToHex(secret));
  return secret;
}

export function memberPubkey(): string {
  return publicKeyOf(memberSecret());
}

export interface SavedCircle {
  invite: string;
  name: string;
}

/** Circles this device created or joined. Their links stay on this device. */
export function savedCircles(): SavedCircle[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CIRCLES_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (c): c is SavedCircle => typeof c?.invite === "string" && typeof c?.name === "string" && decodeInvite(c.invite) !== null,
    );
  } catch {
    return [];
  }
}

export function rememberCircle(invite: string, name: string): void {
  const others = savedCircles().filter((c) => c.invite !== invite);
  localStorage.setItem(CIRCLES_KEY, JSON.stringify([{ invite, name }, ...others].slice(0, 50)));
}

export function inviteUrl(invite: string): string {
  return `${window.location.origin}/circle#${invite}`;
}

/** Lets people type just their M-Pesa number: 07…, 01…, 254… or +254…. */
export function payoutAddressFrom(text: string): string {
  const trimmed = text.trim().replace(/[\s-]/g, "");
  if (/^(?:\+?254|0)[17]\d{8}$/.test(trimmed)) return `${trimmed}@bitcoin.co.ke`;
  return text.trim();
}

/**
 * Checks a payout address the way a payer's phone will: fetch its pay
 * parameters and an unpaid invoice, and record which node signed it.
 * Nothing is paid.
 */
export async function profileFor(name: string, typedAddress: string): Promise<MemberProfile> {
  const address = normalizeAddress(payoutAddressFrom(typedAddress));
  if (!address) throw new Error("That isn't a Lightning address or a Kenyan mobile number.");
  let nodeKey: string;
  try {
    ({ nodeKey } = await probeAddress(address, { fetch: window.fetch.bind(window) }));
  } catch {
    throw new Error("Rota couldn't reach that payout address. Check it and try again.");
  }
  return { name, payoutAddress: address, knownNodeKeys: [nodeKey] };
}

/** Creates a circle, publishes it and returns its invite (the part after "#"). */
export async function createCircle(draft: CircleDraft): Promise<string> {
  const circleSecret = newCircleSecret();
  const event = createCircleEvent({ organizerSecret: memberSecret(), circleSecret, draft });
  await publishEvent(relayUrl(), event);
  const invite = encodeInvite(circleSecret, event.id);
  rememberCircle(invite, draft.name);
  return invite;
}

/** Reads and checks a circle from the relay. Null if the invite is wrong or the circle isn't there. */
export async function loadCircle(invite: string): Promise<CircleView | null> {
  const decoded = decodeInvite(invite);
  if (!decoded) return null;
  const events = await fetchCircle(relayUrl(), publicKeyOf(decoded.circleSecret));
  return assembleCircle({ ...decoded, events });
}

export async function joinCircle(invite: string, profile: MemberProfile): Promise<void> {
  const decoded = decodeInvite(invite);
  if (!decoded) throw new Error("This invite link is broken.");
  await publishEvent(relayUrl(), createJoinEvent({ memberSecret: memberSecret(), ...decoded, profile }));
}

/** The organizer's device fixes the seats once every seat is taken. */
export async function sealCircle(invite: string, view: CircleView): Promise<void> {
  const decoded = decodeInvite(invite);
  if (!decoded || !view.full || view.sealed || view.organizer !== memberPubkey()) return;
  await publishEvent(
    relayUrl(),
    createRosterEvent({ organizerSecret: memberSecret(), ...decoded, members: view.members.map((m) => m.pubkey) }),
  );
}
