// One Nostr event per payment: signed by the paying member, encrypted with
// NIP-44 for the circle, checked on every member's device. Rota's server never
// builds, signs or reads these; it only runs the relay that stores ciphertext.
import { decodeInvoice, verifyReceipt, type CheckResult } from "@rota/receipts";
import { getConversationKey, decrypt, encrypt } from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event } from "nostr-tools/pure";
import { HEX_32, isEventShape, MAX_CONTENT_LENGTH, plainEvent, tagValue } from "./event";

/**
 * Rota's payment record: a regular (not replaceable) event, so a receipt can't
 * be overwritten later. 3570 isn't in the NIPs registry (checked 15 Nov 2026).
 */
export const RECEIPT_KIND = 3570;

/** Version of the encrypted content's shape. */
const CONTENT_VERSION = 1;

/**
 * A circle's key pair. The secret travels in the invite link, so every member
 * can decrypt every receipt; a leaked link exposes the circle's history.
 */
export function newCircleSecret(): Uint8Array {
  return generateSecretKey();
}

/** A member's own signing key. It stays on the member's device. */
export function newMemberSecret(): Uint8Array {
  return generateSecretKey();
}

export function publicKeyOf(secret: Uint8Array): string {
  return getPublicKey(secret);
}

/** What the payer's device knows right after a payment. */
export interface PaymentRecord {
  /** The recipient's Lightning address, as the payer's device fetched it. */
  address: string;
  /** The exact LNURL-pay metadata string the address served. */
  metadata: string;
  /** The BOLT11 invoice that was paid. */
  invoice: string;
  /** The preimage the wallet returned, hex. */
  preimage: string;
  /** The round's amount, in millisatoshis. */
  amountMsat: bigint;
  /** The same amount in local money, for display only. */
  local: { currency: string; amount: number } | null;
  /** When the wallet reported the payment, Unix seconds. */
  paidAt: number;
}

/** The encrypted part of a receipt event, as it appears after decrypting. */
export interface ReceiptContent extends PaymentRecord {
  v: number;
  circle: string;
  round: number;
}

/** What a member's device needs to check a receipt. None of it comes from the event itself. */
export interface CircleContext {
  /** The circle's secret from the invite link. */
  circleSecret: Uint8Array;
  /** Public keys of the circle's members. */
  members: readonly string[];
  /** The round being checked. */
  round: number;
  /** The round's recipient, as recorded when the circle was set up. */
  recipient: { address: string; knownNodeKeys: readonly string[] };
  /**
   * The amount to compare against: the exact millisatoshis (the payer, right
   * after paying), or a band around today's price (any member, later).
   */
  amount: bigint | AmountBand;
  /** BOLT11 network prefix; "bc" (mainnet) unless set. */
  network?: string;
}

/**
 * How a member's device judges a receipt's amount when it didn't make the
 * payment. Sats are worked out on each payer's phone at pay time, so members'
 * sats for one round differ a little. The receipt must say it paid exactly the
 * circle's contribution in local money, its invoice must be for exactly the
 * sats it records, and those sats must be within `tolerance` of what the
 * contribution costs at today's price. A large underpayment fails; a small one
 * within the band doesn't. A monthly circle's old receipt can fall outside
 * the band after a big price move (see DECISIONS.md).
 */
export interface AmountBand {
  currency: string;
  /** The circle's contribution, in whole units of `currency`. */
  contribution: number;
  /** What the contribution costs at today's price, in millisatoshis. */
  marketMsat: bigint;
  /** Allowed difference from `marketMsat`, as a fraction; 0.2 = ±20%. */
  tolerance: number;
}

/** Rota's band: ±20% of today's price (Gregory, 15 Nov 2026). */
export const AMOUNT_TOLERANCE = 0.2;

/** Why a receipt's recorded amount falls outside the band, or null if it fits. */
export function amountOutsideBand(content: Pick<ReceiptContent, "amountMsat" | "local">, band: AmountBand): string | null {
  if (!content.local || content.local.currency !== band.currency || content.local.amount !== band.contribution) {
    return "receipt doesn't claim the circle's contribution";
  }
  if (band.marketMsat <= 0n || !(band.tolerance >= 0 && band.tolerance < 1)) return "no price to compare the amount with";
  // Fractions in parts per million, so the comparison stays in whole msat.
  const ppm = BigInt(Math.round(band.tolerance * 1_000_000));
  const low = (band.marketMsat * (1_000_000n - ppm)) / 1_000_000n;
  const high = (band.marketMsat * (1_000_000n + ppm) + 999_999n) / 1_000_000n;
  if (content.amountMsat < low) return "paid too few sats for the contribution at today's price";
  if (content.amountMsat > high) return "paid far more sats than the contribution at today's price";
  return null;
}

export class ReceiptRefused extends Error {
  readonly checks: CheckResult[];
  constructor(message: string, checks: CheckResult[] = []) {
    super(message);
    this.name = "ReceiptRefused";
    this.checks = checks;
  }
}

function assertRound(round: number): void {
  if (!Number.isSafeInteger(round) || round < 1) throw new ReceiptRefused("round must be a whole number from 1");
}

/**
 * Checks a payment with the four receipt checks, then signs it with the
 * member's key and encrypts it for the circle. A payment that fails any check
 * is refused, never published.
 */
export function createReceiptEvent(options: {
  memberSecret: Uint8Array;
  context: Omit<CircleContext, "members" | "amount"> & { expectedAmountMsat: bigint };
  payment: PaymentRecord;
  /** Unix seconds; defaults to now. */
  createdAt?: number;
}): Event {
  const { memberSecret, context, payment } = options;
  assertRound(context.round);

  const result = verifyReceipt({
    invoice: payment.invoice,
    preimage: payment.preimage,
    address: context.recipient.address,
    metadata: payment.metadata,
    knownNodeKeys: context.recipient.knownNodeKeys,
    expectedAmountMsat: context.expectedAmountMsat,
    network: context.network ?? "bc",
  });
  if (!result.ok) throw new ReceiptRefused("this payment doesn't pass the receipt checks", result.checks);
  if (payment.amountMsat !== context.expectedAmountMsat) throw new ReceiptRefused("payment amount differs from the round's amount");
  if (payment.address.trim().toLowerCase() !== context.recipient.address.trim().toLowerCase()) {
    throw new ReceiptRefused("payment was for a different address than the round's recipient");
  }

  const circle = getPublicKey(context.circleSecret);
  const content: ReceiptContent = { v: CONTENT_VERSION, circle, round: context.round, ...payment };
  const plaintext = JSON.stringify(content, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
  const ciphertext = encrypt(plaintext, getConversationKey(memberSecret, circle));

  return finalizeEvent(
    {
      kind: RECEIPT_KIND,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
      // Public on the relay: which circle and round. Amounts, names and the invoice stay encrypted.
      tags: [
        ["p", circle],
        ["round", String(context.round)],
      ],
      content: ciphertext,
    },
    memberSecret,
  );
}

/** How a receipt event fared. `member` is the "signed by this member" half of check 4. */
export interface ReceiptEventResult {
  ok: boolean;
  member: { ok: boolean; detail: string; pubkey: string };
  checks: CheckResult[];
  /** Set when the content could be decrypted and read. */
  content?: ReceiptContent;
  /** The invoice's payment hash, when it could be read; used to spot two members claiming one payment. */
  paymentHash?: string;
}

function parseContent(text: string): ReceiptContent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (c.v !== CONTENT_VERSION) return null;
  const strings = ["circle", "address", "metadata", "invoice", "preimage", "amountMsat"] as const;
  if (!strings.every((k) => typeof c[k] === "string")) return null;
  if (typeof c.round !== "number" || typeof c.paidAt !== "number") return null;
  if (!/^[0-9]{1,20}$/.test(c.amountMsat as string)) return null;
  let local: ReceiptContent["local"] = null;
  if (c.local !== null && c.local !== undefined) {
    const l = c.local as Record<string, unknown>;
    if (typeof l.currency !== "string" || typeof l.amount !== "number") return null;
    local = { currency: l.currency, amount: l.amount };
  }
  return {
    v: CONTENT_VERSION,
    circle: c.circle as string,
    round: c.round,
    address: c.address as string,
    metadata: c.metadata as string,
    invoice: c.invoice as string,
    preimage: c.preimage as string,
    amountMsat: BigInt(c.amountMsat as string),
    local,
    paidAt: c.paidAt,
  };
}

const ALL_FAIL = (detail: string): CheckResult[] =>
  (["paid", "address", "issuer", "amount"] as const).map((check) => ({ check, ok: false, detail }));

/**
 * Checks one receipt event on a member's device: the member's signature, that
 * it belongs to this circle and round, then the four receipt checks. The
 * recipient, their nodes and the amount come from the circle's own record,
 * never from the event, so a member can't vouch for their own receipt.
 */
export function verifyReceiptEvent(input: unknown, context: CircleContext): ReceiptEventResult {
  const pubkey = isEventShape(input) ? input.pubkey : "";
  const reject = (detail: string): ReceiptEventResult => ({
    ok: false,
    member: { ok: false, detail, pubkey },
    checks: ALL_FAIL(detail),
  });

  if (!isEventShape(input)) return reject("not a Nostr event");
  const event = plainEvent(input);
  if (event.kind !== RECEIPT_KIND) return reject("not a Rota receipt");
  if (!HEX_32.test(event.pubkey) || !verifyEvent(event)) return reject("signature doesn't match the event");

  const circle = getPublicKey(context.circleSecret);
  if (tagValue(event, "p") !== circle) return reject("receipt belongs to another circle");
  if (tagValue(event, "round") !== String(context.round)) return reject("receipt is for another round");
  if (event.content.length > MAX_CONTENT_LENGTH) return reject("receipt is too large");

  let content: ReceiptContent | null = null;
  try {
    content = parseContent(decrypt(event.content, getConversationKey(context.circleSecret, event.pubkey)));
  } catch {
    content = null;
  }
  if (content === null) return reject("receipt couldn't be decrypted or read");
  if (content.circle !== circle || content.round !== context.round) return reject("receipt's content names another circle or round");

  const isMember = context.members.includes(event.pubkey);
  const member = isMember
    ? { ok: true, detail: "signed by a member of this circle", pubkey: event.pubkey }
    : { ok: false, detail: "signed by someone outside this circle", pubkey: event.pubkey };

  // With a band, the invoice must match the sats the receipt records, and
  // those sats must fit the band; the exact figure is the payer's own.
  const band = typeof context.amount === "bigint" ? null : context.amount;
  const outside = band ? amountOutsideBand(content, band) : null;
  const result = verifyReceipt({
    invoice: content.invoice,
    preimage: content.preimage,
    address: context.recipient.address,
    metadata: content.metadata,
    knownNodeKeys: context.recipient.knownNodeKeys,
    expectedAmountMsat: band ? content.amountMsat : (context.amount as bigint),
    network: context.network ?? "bc",
  });
  if (outside) {
    result.checks = result.checks.map((c) => (c.check === "amount" ? { check: "amount", ok: false, detail: outside } : c));
    result.ok = false;
  } else if (band) {
    result.checks = result.checks.map((c) =>
      c.check === "amount" && c.ok ? { ...c, detail: "contribution paid; sats within the band of today's price" } : c,
    );
  }

  let paymentHash: string | undefined;
  try {
    paymentHash = decodeInvoice(content.invoice).paymentHash;
  } catch {
    paymentHash = undefined;
  }

  return { ok: member.ok && result.ok, member, checks: result.checks, content, paymentHash };
}

/**
 * "paid": a passing receipt for a payment nobody else claims, or one the
 * recipient settled in this member's favour. "disputed": another member claims
 * the same payment and the recipient hasn't settled it. "not-counted": the
 * recipient settled that payment for someone else.
 */
export type RoundClaim = "paid" | "disputed" | "not-counted";

/** Who claims each payment, from receipts that passed every check. */
export function claimantsByPayment(results: readonly ReceiptEventResult[]): Map<string, Set<string>> {
  const byHash = new Map<string, Set<string>>();
  for (const r of results) {
    if (!r.ok || !r.paymentHash) continue;
    const claimants = byHash.get(r.paymentHash) ?? new Set<string>();
    claimants.add(r.member.pubkey);
    byHash.set(r.paymentHash, claimants);
  }
  return byHash;
}

const CLAIM_WEIGHT: Record<RoundClaim, number> = { "not-counted": 0, paid: 1, disputed: 2 };

/**
 * Who paid a round, from receipts that already passed `verifyReceiptEvent`.
 * Every member can decrypt every receipt, so a member could copy someone
 * else's invoice and preimage into a receipt of their own. One payment can
 * only count once: when two members claim the same payment hash, both are
 * disputed until the recipient's "received" record (`settled`: payment hash →
 * member) names one of them. A settlement for a payment only one member
 * claims, or naming someone who doesn't claim it, changes nothing.
 */
export function roundClaims(
  results: readonly ReceiptEventResult[],
  settled: ReadonlyMap<string, string> = new Map(),
): Map<string, RoundClaim> {
  const claims = new Map<string, RoundClaim>();
  const raise = (pubkey: string, claim: RoundClaim) => {
    const before = claims.get(pubkey);
    if (before === undefined || CLAIM_WEIGHT[claim] > CLAIM_WEIGHT[before]) claims.set(pubkey, claim);
  };
  for (const [hash, claimants] of claimantsByPayment(results)) {
    const winner = settled.get(hash);
    for (const pubkey of claimants) {
      if (claimants.size === 1) raise(pubkey, "paid");
      else if (winner === undefined || !claimants.has(winner)) raise(pubkey, "disputed");
      else raise(pubkey, pubkey === winner ? "paid" : "not-counted");
    }
  }
  return claims;
}
