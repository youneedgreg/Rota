// A member's track record: the receipts they paid, in a file anyone they
// choose can check without Rota, a relay or the circle's secret.
//
// The file is one Nostr event signed by the member (kind 3575). It holds the
// member's original receipt events, exactly as they published them, and for
// each circle the NIP-44 conversation key between the member and the circle.
// That key opens this member's own messages to the circle and nobody else's:
// every member has a different one. So a reader can check the member's
// signature from the day they paid, decrypt each receipt and run the four
// checks on it.
//
// What the receipts prove on their own: that each invoice was paid (preimage),
// that it was for the address named in the receipt, how many sats, when the
// recipient's service issued it, and that this member published it. What the
// member only states: the circle's name and contribution, the node each
// recipient's invoices come from (used for the issuer check), and each round's
// deadline. The reader is shown which is which.
import { decodeInvoice, verifyReceipt, type CheckResult } from "@rota/receipts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import { finalizeEvent, getPublicKey, type Event } from "nostr-tools/pure";
import { HEX_32, isEventShape, tagValue, verifiedCopy } from "./event";
import { parseReceiptContent, RECEIPT_KIND } from "./records";

export const TRACK_RECORD_KIND = 3575;

const VERSION = 1;

/** Largest track-record file Rota will read. 20 circles × 20 rounds of receipts fit easily. */
export const MAX_TRACK_RECORD_BYTES = 2_000_000;

/** Most circles, and receipts per circle, a file may hold: 20 seats means at most 20 rounds. */
const MAX_CIRCLES = 50;
const MAX_RECEIPTS_PER_CIRCLE = 100;

/** What the member states about one recipient: their address and the node their invoices come from. */
export interface StatedRecipient {
  address: string;
  knownNodeKeys: string[];
}

/** One circle in a track record, as the member exports it. */
export interface TrackRecordCircle {
  /** The circle's public key, as tagged on its receipts. */
  circle: string;
  name: string;
  currency: string;
  contribution: number;
  recipients: StatedRecipient[];
  /** When each round turned late, ISO 8601, by round number. */
  lateAfter: Record<string, string>;
  /** The member's original receipt events for this circle. */
  receipts: Event[];
}

interface TrackRecordBody {
  v: number;
  circles: (TrackRecordCircle & { conversationKey: string })[];
}

export class TrackRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackRecordError";
  }
}

/**
 * Signs a member's track record. Every receipt must be the member's own and
 * belong to the circle it's listed under. The file reveals the recipients'
 * addresses (M-Pesa numbers included) to whoever the member gives it to.
 */
export function createTrackRecord(options: {
  memberSecret: Uint8Array;
  circles: readonly TrackRecordCircle[];
  createdAt?: number;
}): Event {
  const member = getPublicKey(options.memberSecret);
  const circles = options.circles.map((c) => {
    if (!HEX_32.test(c.circle)) throw new TrackRecordError("A circle key isn't valid.");
    for (const r of c.receipts) {
      if (r.kind !== RECEIPT_KIND || r.pubkey !== member || tagValue(r, "p") !== c.circle) {
        throw new TrackRecordError("A track record can only hold the member's own receipts for each circle.");
      }
    }
    return { ...c, conversationKey: bytesToHex(getConversationKey(options.memberSecret, c.circle)) };
  });
  const body: TrackRecordBody = { v: VERSION, circles };
  return finalizeEvent(
    {
      kind: TRACK_RECORD_KIND,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(body),
    },
    options.memberSecret,
  );
}

/** One receipt in a checked track record. */
export interface TrackedReceipt {
  eventId: string;
  round: number | null;
  ok: boolean;
  /** The four receipt checks, plus "member": published by the member who exported the file. */
  checks: CheckResult[];
  member: { ok: boolean; detail: string };
  address?: string;
  sats?: bigint;
  local?: { currency: string; amount: number } | null;
  /** When the recipient's service issued the invoice: signed by that service. */
  invoiceIssuedAt?: Date;
  /** When the member published the receipt: signed by the member. */
  publishedAt: Date;
  /** Against the round's deadline the member states; undefined when there's none. */
  onTime?: boolean;
  /** The same payment listed twice in this file; counted once. */
  duplicate: boolean;
}

export interface TrackedCircle {
  circle: string;
  name: string;
  currency: string;
  contribution: number;
  receipts: TrackedReceipt[];
}

export interface TrackRecordResult {
  ok: boolean;
  /** Why the file as a whole couldn't be read, when ok is false. */
  problem?: string;
  member?: string;
  exportedAt?: Date;
  circles: TrackedCircle[];
  totals: { proven: number; failed: number; onTime: number; late: number };
}

const EMPTY_TOTALS = { proven: 0, failed: 0, onTime: 0, late: 0 };

function failAll(detail: string): CheckResult[] {
  return (["paid", "address", "issuer", "amount"] as const).map((check) => ({ check, ok: false, detail }));
}

function asStrings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function readCircle(raw: unknown): (TrackRecordCircle & { conversationKey: string }) | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.circle !== "string" || !HEX_32.test(c.circle)) return null;
  if (typeof c.conversationKey !== "string" || !HEX_32.test(c.conversationKey)) return null;
  if (typeof c.name !== "string" || c.name.length > 80 || typeof c.currency !== "string" || c.currency.length > 8) return null;
  if (typeof c.contribution !== "number" || !Number.isFinite(c.contribution) || c.contribution <= 0) return null;
  if (!Array.isArray(c.recipients) || !Array.isArray(c.receipts)) return null;
  if (c.recipients.length > MAX_RECEIPTS_PER_CIRCLE || c.receipts.length > MAX_RECEIPTS_PER_CIRCLE) return null;
  const recipients: StatedRecipient[] = [];
  for (const r of c.recipients as unknown[]) {
    const e = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const keys = asStrings(e.knownNodeKeys);
    if (typeof e.address !== "string" || !keys) return null;
    recipients.push({ address: e.address, knownNodeKeys: keys });
  }
  const lateAfter: Record<string, string> = {};
  if (typeof c.lateAfter === "object" && c.lateAfter !== null) {
    for (const [k, v] of Object.entries(c.lateAfter as Record<string, unknown>)) if (typeof v === "string") lateAfter[k] = v;
  }
  return {
    circle: c.circle,
    conversationKey: c.conversationKey,
    name: c.name,
    currency: c.currency,
    contribution: c.contribution,
    recipients,
    lateAfter,
    receipts: (c.receipts as unknown[]).filter(isEventShape),
  };
}

function checkOne(
  input: Event,
  options: { member: string; circle: TrackRecordCircle & { conversationKey: string }; network: string },
): TrackedReceipt & { paymentHash?: string } {
  const { member, circle } = options;
  const publishedAt = new Date(input.created_at * 1000);
  const base = { eventId: input.id, round: null, publishedAt, duplicate: false };
  const reject = (detail: string) => ({ ...base, ok: false, checks: failAll(detail), member: { ok: false, detail } });

  const event = verifiedCopy(input);
  if (!event) return reject("signature doesn't match the receipt");
  if (event.kind !== RECEIPT_KIND) return reject("not a Rota receipt");
  if (event.pubkey !== member) return reject("published by someone other than this member");
  if (tagValue(event, "p") !== circle.circle) return reject("receipt belongs to another circle");

  const content = (() => {
    try {
      return parseReceiptContent(decrypt(event.content, hexToBytes(circle.conversationKey)));
    } catch {
      return null;
    }
  })();
  if (!content) return reject("receipt couldn't be opened with this file's key");
  const round = Number(tagValue(event, "round"));
  if (content.circle !== circle.circle || content.round !== round) return reject("receipt's content names another circle or round");

  const stated = circle.recipients.find((r) => r.address === content.address);
  const result = verifyReceipt({
    invoice: content.invoice,
    preimage: content.preimage,
    address: content.address,
    metadata: content.metadata,
    knownNodeKeys: stated?.knownNodeKeys ?? [],
    expectedAmountMsat: content.amountMsat,
    network: options.network,
  });
  const checks = result.checks.map((c) =>
    c.check === "issuer" && c.ok ? { ...c, detail: "signed by the node the member's circle records for this address" } : c,
  );

  let invoiceIssuedAt: Date | undefined;
  let paymentHash: string | undefined;
  try {
    const decoded = decodeInvoice(content.invoice);
    invoiceIssuedAt = new Date(decoded.timestamp * 1000);
    paymentHash = decoded.paymentHash;
  } catch {
    // The checks above already failed for an invoice that doesn't decode.
  }
  const deadline = circle.lateAfter[String(round)];
  const lateAfter = deadline ? Date.parse(deadline) : NaN;
  const onTime = invoiceIssuedAt && !Number.isNaN(lateAfter) ? invoiceIssuedAt.getTime() <= lateAfter : undefined;

  return {
    ...base,
    round,
    ok: result.ok,
    checks,
    member: { ok: true, detail: "published by this member" },
    address: content.address,
    sats: content.amountMsat / 1000n,
    local: content.local,
    ...(invoiceIssuedAt ? { invoiceIssuedAt } : {}),
    ...(onTime === undefined ? {} : { onTime }),
    paymentHash,
  };
}

/**
 * Checks a track-record file entirely on this device: the member's signature
 * on the file, then every receipt in it. `network` is the BOLT11 prefix the
 * receipts must be on ("bc" for mainnet).
 */
export function verifyTrackRecord(input: unknown, options: { network?: string } = {}): TrackRecordResult {
  const network = options.network ?? "bc";
  const fail = (problem: string): TrackRecordResult => ({ ok: false, problem, circles: [], totals: { ...EMPTY_TOTALS } });

  const event = verifiedCopy(input);
  if (!event) return fail("This isn't a signed Rota track record, or it was changed after signing.");
  if (event.kind !== TRACK_RECORD_KIND) return fail("This file isn't a Rota track record.");
  if (event.content.length > MAX_TRACK_RECORD_BYTES) return fail("This file is too large.");

  let body: unknown;
  try {
    body = JSON.parse(event.content);
  } catch {
    return fail("This track record can't be read.");
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (b.v !== VERSION || !Array.isArray(b.circles)) return fail("This track record is from another version of Rota.");
  if (b.circles.length > MAX_CIRCLES) return fail("This file is too large.");

  const seen = new Set<string>();
  const totals = { ...EMPTY_TOTALS };
  const circles: TrackedCircle[] = [];
  for (const raw of b.circles as unknown[]) {
    const circle = readCircle(raw);
    if (!circle) return fail("A circle in this track record can't be read.");
    const receipts: TrackedReceipt[] = [];
    for (const r of circle.receipts) {
      const { paymentHash, ...checked } = checkOne(r, { member: event.pubkey, circle, network });
      if (paymentHash && seen.has(paymentHash)) checked.duplicate = true;
      if (paymentHash) seen.add(paymentHash);
      receipts.push(checked);
      if (checked.duplicate) continue;
      if (checked.ok) {
        totals.proven += 1;
        if (checked.onTime === true) totals.onTime += 1;
        if (checked.onTime === false) totals.late += 1;
      } else {
        totals.failed += 1;
      }
    }
    receipts.sort((x, y) => (x.round ?? 0) - (y.round ?? 0));
    circles.push({ circle: circle.circle, name: circle.name, currency: circle.currency, contribution: circle.contribution, receipts });
  }
  return { ok: true, member: event.pubkey, exportedAt: new Date(event.created_at * 1000), circles, totals };
}
