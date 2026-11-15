// A circle without a server: the organizer's signed definition, members' join
// events and the organizer's roster, all encrypted for the circle on its relay.
// The invite link carries the circle's secret and the id of the definition
// event, so nobody else holding the link can swap in a different definition.
import {
  CircleError,
  CURRENCIES,
  isMpesaAddress,
  MAX_MEMBERS,
  MIN_MEMBERS,
  MPESA_MAX_KES,
  MPESA_MIN_KES,
  normalizeAddress,
  validateCircle,
  type Circle,
  type Currency,
  type Schedule,
} from "@rota/circles";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { finalizeEvent, getPublicKey, type Event } from "nostr-tools/pure";
import { HEX_32, openForCircle, tagValue, verifiedCopy } from "./event";

/** The organizer's circle definition. Regular events: none can be replaced later. */
export const CIRCLE_KIND = 3571;
/** A member taking a seat. */
export const JOIN_KIND = 3572;
/** The organizer fixing who is in and in what order, once every seat is taken. */
export const ROSTER_KIND = 3573;

const VERSION = 1;
const NODE_KEY = /^0[23][0-9a-f]{64}$/;

/** What each member tells the circle about themselves. */
export interface MemberProfile {
  name: string;
  /** Where this member receives their payout: a Lightning address, normalized. */
  payoutAddress: string;
  /** Node keys the address's invoices were signed by when the member joined. */
  knownNodeKeys: string[];
}

export interface CircleDraft {
  name: string;
  currency: Currency;
  /** Each paying member's contribution per round, in whole KES or XOF. */
  contribution: number;
  /** How many members, the organizer included. */
  seats: number;
  schedule: Schedule;
  organizer: MemberProfile;
}

export interface CircleMember extends MemberProfile {
  pubkey: string;
}

export interface CircleView {
  circlePubkey: string;
  organizer: string;
  draft: CircleDraft;
  /** Seat order: the organizer first, then joiners. */
  members: CircleMember[];
  /** Every seat is taken. */
  full: boolean;
  /** The organizer published the roster, so the order can't change any more. */
  sealed: boolean;
  /** The validated circle, once every seat is taken. Member ids are their public keys. */
  circle: Circle | null;
}

export class CircleEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircleEventError";
  }
}

// ---------- the invite link ----------

/** The part of the invite link after "#": never sent to any server by the browser. */
export function encodeInvite(circleSecret: Uint8Array, circleEventId: string): string {
  return `${bytesToHex(circleSecret)}.${circleEventId}`;
}

export function decodeInvite(fragment: string): { circleSecret: Uint8Array; circleEventId: string } | null {
  const [secret, id, ...rest] = fragment.replace(/^#/, "").trim().toLowerCase().split(".");
  if (rest.length > 0 || !secret || !id || !HEX_32.test(secret) || !HEX_32.test(id)) return null;
  try {
    const circleSecret = hexToBytes(secret);
    getPublicKey(circleSecret); // throws for a value that isn't a valid key
    return { circleSecret, circleEventId: id };
  } catch {
    return null;
  }
}

// ---------- checking what members typed ----------

/** Checks a profile and returns it normalized. Throws CircleEventError. */
export function checkProfile(profile: MemberProfile): MemberProfile {
  const name = profile.name.trim();
  if (name.length < 1 || name.length > 40) throw new CircleEventError("Your name must be 1 to 40 characters.");
  const payoutAddress = normalizeAddress(profile.payoutAddress);
  if (!payoutAddress) throw new CircleEventError("That isn't a Lightning address or a Kenyan mobile number.");
  const knownNodeKeys = profile.knownNodeKeys.map((k) => k.toLowerCase());
  if (knownNodeKeys.length < 1 || knownNodeKeys.length > 5 || !knownNodeKeys.every((k) => NODE_KEY.test(k))) {
    throw new CircleEventError("The payout address's node couldn't be recorded.");
  }
  return { name, payoutAddress, knownNodeKeys };
}

/** Whether a payout address fits this circle's currency and amount (M-Pesa is KES-only, 15 to 50,000 KES). */
export function payoutFits(address: string, draft: Pick<CircleDraft, "currency" | "contribution">): boolean {
  if (!isMpesaAddress(address)) return true;
  return draft.currency === "KES" && draft.contribution >= MPESA_MIN_KES && draft.contribution <= MPESA_MAX_KES;
}

function asCircle(draft: CircleDraft, circlePubkey: string, members: CircleMember[]): Circle {
  return {
    id: circlePubkey,
    name: draft.name,
    currency: draft.currency,
    contribution: draft.contribution,
    members: members.map((m) => ({ id: m.pubkey, name: m.name, payoutAddress: m.payoutAddress })),
    payoutOrder: members.map((m) => m.pubkey),
    schedule: draft.schedule,
  };
}

/** Checks a draft and returns it normalized. Throws CircleEventError or CircleError. */
export function checkDraft(draft: CircleDraft): CircleDraft {
  if (!Number.isInteger(draft.seats) || draft.seats < MIN_MEMBERS || draft.seats > MAX_MEMBERS) {
    throw new CircleEventError(`A circle has ${MIN_MEMBERS} to ${MAX_MEMBERS} members.`);
  }
  const organizer = checkProfile(draft.organizer);
  // Joiners aren't known yet: check the rest of the circle with placeholder seats.
  const placeholders: CircleMember[] = Array.from({ length: draft.seats - 1 }, (_, i) => ({
    pubkey: `seat-${i + 2}`,
    name: `Seat ${i + 2}`,
    payoutAddress: `seat-${i + 2}@example.com`,
    knownNodeKeys: [],
  }));
  const checked = validateCircle(asCircle({ ...draft, organizer }, "draft", [{ ...organizer, pubkey: "organizer" }, ...placeholders]));
  return {
    name: checked.name,
    currency: checked.currency,
    contribution: checked.contribution,
    seats: draft.seats,
    schedule: checked.schedule,
    organizer,
  };
}

// ---------- writing ----------

function sealFor(circleSecret: Uint8Array, author: Uint8Array, body: object): string {
  return encrypt(JSON.stringify({ v: VERSION, ...body }), getConversationKey(author, getPublicKey(circleSecret)));
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** The organizer's signed, encrypted circle definition. Its id goes into the invite link. */
export function createCircleEvent(options: {
  organizerSecret: Uint8Array;
  circleSecret: Uint8Array;
  draft: CircleDraft;
  createdAt?: number;
}): Event {
  const draft = checkDraft(options.draft);
  return finalizeEvent(
    {
      kind: CIRCLE_KIND,
      created_at: options.createdAt ?? now(),
      tags: [["p", getPublicKey(options.circleSecret)]],
      content: sealFor(options.circleSecret, options.organizerSecret, { draft }),
    },
    options.organizerSecret,
  );
}

/** A member taking a seat, signed with their own key. */
export function createJoinEvent(options: {
  memberSecret: Uint8Array;
  circleSecret: Uint8Array;
  circleEventId: string;
  profile: MemberProfile;
  createdAt?: number;
}): Event {
  const profile = checkProfile(options.profile);
  return finalizeEvent(
    {
      kind: JOIN_KIND,
      created_at: options.createdAt ?? now(),
      tags: [
        ["p", getPublicKey(options.circleSecret)],
        ["e", options.circleEventId],
      ],
      content: sealFor(options.circleSecret, options.memberSecret, { profile }),
    },
    options.memberSecret,
  );
}

/** The organizer fixing the seat order once the circle is full. */
export function createRosterEvent(options: {
  organizerSecret: Uint8Array;
  circleSecret: Uint8Array;
  circleEventId: string;
  members: readonly string[];
  createdAt?: number;
}): Event {
  return finalizeEvent(
    {
      kind: ROSTER_KIND,
      created_at: options.createdAt ?? now(),
      tags: [
        ["p", getPublicKey(options.circleSecret)],
        ["e", options.circleEventId],
      ],
      content: sealFor(options.circleSecret, options.organizerSecret, { members: [...options.members] }),
    },
    options.organizerSecret,
  );
}

// ---------- reading ----------

function readProfile(raw: unknown): MemberProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.name !== "string" || typeof p.payoutAddress !== "string" || !Array.isArray(p.knownNodeKeys)) return null;
  if (!p.knownNodeKeys.every((k) => typeof k === "string")) return null;
  try {
    return checkProfile({ name: p.name, payoutAddress: p.payoutAddress, knownNodeKeys: p.knownNodeKeys as string[] });
  } catch {
    return null;
  }
}

function readDraft(raw: unknown): CircleDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = (raw as Record<string, unknown>).draft;
  if (typeof d !== "object" || d === null) return null;
  const x = d as Record<string, unknown>;
  if (typeof x.name !== "string" || typeof x.contribution !== "number" || typeof x.seats !== "number") return null;
  if (!CURRENCIES.includes(x.currency as Currency)) return null;
  if (typeof x.schedule !== "object" || x.schedule === null) return null;
  const organizer = readProfile(x.organizer);
  if (!organizer) return null;
  try {
    return checkDraft({
      name: x.name,
      currency: x.currency as Currency,
      contribution: x.contribution,
      seats: x.seats,
      schedule: x.schedule as Schedule,
      organizer,
    });
  } catch {
    return null;
  }
}

function inOrder(a: Event, b: Event): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function isVersioned(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).v === VERSION;
}

/**
 * Builds the circle from whatever the relay returned. Every event is checked:
 * the definition must be the one the invite link names; joins must be signed,
 * for this circle and fit its currency; a roster counts only if the organizer
 * signed it and every member on it has a join. Returns null when the
 * definition is missing or fails a check.
 */
export function assembleCircle(options: {
  circleSecret: Uint8Array;
  circleEventId: string;
  events: readonly unknown[];
}): CircleView | null {
  const { circleSecret, circleEventId } = options;
  const circlePubkey = getPublicKey(circleSecret);
  const events = options.events.map(verifiedCopy).filter((e): e is Event => e !== null);

  const definition = events.find((e) => e.id === circleEventId && e.kind === CIRCLE_KIND);
  if (!definition) return null;
  const raw = openForCircle(definition, circleSecret);
  const draft = isVersioned(raw) ? readDraft(raw) : null;
  if (!draft) return null;

  const organizer: CircleMember = { ...draft.organizer, pubkey: definition.pubkey };

  // Each member's earliest valid join for this circle.
  const profiles = new Map<string, { event: Event; profile: MemberProfile }>();
  for (const event of events.filter((e) => e.kind === JOIN_KIND).sort(inOrder)) {
    if (tagValue(event, "e") !== circleEventId || event.pubkey === organizer.pubkey) continue;
    if (event.created_at < definition.created_at || profiles.has(event.pubkey)) continue;
    const content = openForCircle(event, circleSecret);
    const profile = isVersioned(content) ? readProfile(content.profile) : null;
    if (!profile || !payoutFits(profile.payoutAddress, draft)) continue;
    profiles.set(event.pubkey, { event, profile });
  }

  const roster = events
    .filter((e) => e.kind === ROSTER_KIND && e.pubkey === organizer.pubkey && tagValue(e, "e") === circleEventId)
    .sort(inOrder)
    .map((e) => openForCircle(e, circleSecret))
    .map((c) => (isVersioned(c) && Array.isArray(c.members) ? (c.members as unknown[]) : null))
    .find(
      (list): list is string[] =>
        list !== null &&
        list.length === draft.seats &&
        list[0] === organizer.pubkey &&
        new Set(list).size === list.length &&
        list.slice(1).every((k) => typeof k === "string" && profiles.has(k)),
    );

  let members: CircleMember[];
  if (roster) {
    members = [organizer];
    for (const pubkey of roster.slice(1)) {
      const joined = profiles.get(pubkey);
      if (joined) members.push({ ...joined.profile, pubkey });
    }
  } else {
    // Provisional: seats in join order, skipping a payout address already taken.
    members = [organizer];
    const taken = new Set([organizer.payoutAddress]);
    for (const [pubkey, { profile }] of profiles) {
      if (members.length >= draft.seats) break;
      if (taken.has(profile.payoutAddress)) continue;
      taken.add(profile.payoutAddress);
      members.push({ ...profile, pubkey });
    }
  }

  const full = members.length === draft.seats;
  let circle: Circle | null = null;
  if (full) {
    try {
      circle = validateCircle(asCircle(draft, circlePubkey, members));
    } catch (error) {
      if (!(error instanceof CircleError)) throw error;
      circle = null;
    }
  }
  return { circlePubkey, organizer: organizer.pubkey, draft, members, full, sealed: roster !== undefined, circle };
}
