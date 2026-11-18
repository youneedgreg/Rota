// The local demo circle: five fictional members, a monthly KES circle in its
// third round, rounds 1 and 2 fully paid. Every receipt passes the four
// checks, but the invoices are signed with public demo keys and no money ever
// moved, so this is for the local regtest demo only, never a mainnet relay.
//
// All keys are derived from public labels, so anyone can recreate them. That
// is the point: the demo logins are printed for whoever runs the demo.
import { addMonthsUtc, localToMsat, type Quote } from "@rota/circles";
import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex } from "lightning-receipts/testing";
import {
  createCircleEvent,
  createJoinEvent,
  createReceiptEvent,
  createRosterEvent,
  encodeInvite,
  publicKeyOf,
  type CircleDraft,
  type MemberProfile,
} from "@rota/records";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

type Event = ReturnType<typeof createCircleEvent>;

/** A public demo key from a label. Never use one to hold money. */
export function demoKey(label: string): Uint8Array {
  return sha256(utf8ToBytes(`rota demo key: ${label}`));
}

function demoPreimage(label: string): [string, string] {
  const preimage = sha256(utf8ToBytes(`rota demo preimage: ${label}`));
  return [bytesToHex(preimage), bytesToHex(sha256(preimage))];
}

/** Seat order: Amina organizes, the others join in this order. */
export const DEMO_MEMBERS = [
  { label: "amina", name: "Amina" },
  { label: "baraka", name: "Baraka" },
  { label: "wanjiru", name: "Wanjiru" },
  { label: "otieno", name: "Otieno" },
  { label: "fatou", name: "Fatou" },
] as const;

export const DEMO_CIRCLE_NAME = "Mtaa Savings (demo)";
export const DEMO_CONTRIBUTION_KES = 1000;
export const DEMO_ROUND = 3;
const GRACE_DAYS = 7;

/** example.com is reserved (RFC 2606), so these addresses can't belong to anyone. */
function addressOf(label: string): string {
  return `${label}@example.com`;
}

/** Who paid in which round, and how many days after the round opened. */
const PAYMENTS: Record<number, Record<string, number>> = {
  // Round 1 (Amina receives): Fatou pays two days after the grace period.
  1: { baraka: 0.2, wanjiru: 1.5, otieno: 3, fatou: GRACE_DAYS + 2 },
  // Round 2 (Baraka receives): everyone on time.
  2: { amina: 0.1, wanjiru: 2, otieno: 4, fatou: 6 },
  // Round 3 (Wanjiru receives), open now: Baraka and Fatou haven't paid yet.
  3: { amina: 0.3, otieno: 1 },
};

const DAY = 86_400;

export interface DemoLogin {
  name: string;
  /** The member's secret key, hex. Public: it's derived from a label. */
  secret: string;
  /** Whether they still owe the current round. */
  owesCurrentRound: boolean;
}

export interface Demo {
  /** The part of the invite link after "#". */
  invite: string;
  /** The circle's secret, hex. Public: it's derived from a label. */
  circleSecret: string;
  circlePubkey: string;
  organizerPubkey: string;
  definitionId: string;
  events: Event[];
  logins: DemoLogin[];
}

/** Round n's recipient: seats are paid out in order. */
function recipientOf(round: number): string {
  const seat = DEMO_MEMBERS[round - 1];
  if (!seat) throw new RangeError(`The demo circle has no round ${round}.`);
  return seat.label;
}

function addMonths(seconds: number, months: number): number {
  // The same month arithmetic the circle's schedule uses.
  return Math.floor(addMonthsUtc(new Date(seconds * 1000), months).getTime() / 1000);
}

/**
 * Builds every event of the demo circle. Round 3 opened two or three days
 * before `now`, so it is open and its unpaid members are still on time.
 * `network` is the BOLT11 prefix the app pays on ("bcrt" for regtest).
 */
export function buildDemo(options: { quote: Quote; now: Date; network: string }): Demo {
  const { network } = options;
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  // Round 3 opened at the last 09:00 Nairobi (06:00 UTC) at least two days ago,
  // so two or three days before now; round 1 two months before that.
  const SIX_AM = 6 * 3600;
  const round3Opens = Math.floor((nowSeconds - 2 * DAY - SIX_AM) / DAY) * DAY + SIX_AM;
  const startsAt = addMonths(round3Opens, -(DEMO_ROUND - 1));
  const opens = (round: number) => addMonths(startsAt, round - 1);

  const circleSecret = demoKey("circle");
  const circlePubkey = publicKeyOf(circleSecret);
  const memberKey = (label: string) => demoKey(`member: ${label}`);
  const nodeKey = (label: string) => demoKey(`node: ${label}`);
  const profile = (label: string, name: string): MemberProfile => ({
    name,
    payoutAddress: addressOf(label),
    knownNodeKeys: [nodeKeyOf(nodeKey(label))],
  });

  const [organizer, ...joiners] = DEMO_MEMBERS;
  const draft: CircleDraft = {
    name: DEMO_CIRCLE_NAME,
    currency: "KES",
    contribution: DEMO_CONTRIBUTION_KES,
    seats: DEMO_MEMBERS.length,
    schedule: { kind: "monthly", startsAt: new Date(startsAt * 1000).toISOString(), graceDays: GRACE_DAYS },
    organizer: profile(organizer.label, organizer.name),
  };

  const created = startsAt - 7 * DAY;
  const definition = createCircleEvent({
    organizerSecret: memberKey(organizer.label),
    circleSecret,
    draft,
    createdAt: created,
  });
  const events: Event[] = [definition];
  joiners.forEach((m, i) => {
    events.push(
      createJoinEvent({
        memberSecret: memberKey(m.label),
        circleSecret,
        circleEventId: definition.id,
        profile: profile(m.label, m.name),
        createdAt: created + (i + 1) * 3600,
      }),
    );
  });
  events.push(
    createRosterEvent({
      organizerSecret: memberKey(organizer.label),
      circleSecret,
      circleEventId: definition.id,
      members: DEMO_MEMBERS.map((m) => publicKeyOf(memberKey(m.label))),
      createdAt: created + 6 * 3600,
    }),
  );

  const amountMsat = localToMsat(DEMO_CONTRIBUTION_KES, "KES", options.quote);
  for (const [roundText, payers] of Object.entries(PAYMENTS)) {
    const round = Number(roundText);
    const recipient = recipientOf(round);
    const address = addressOf(recipient);
    const metadata = lnurlMetadata(address);
    const nodeSecret = nodeKey(recipient);
    for (const [payer, days] of Object.entries(payers)) {
      const paidAt = opens(round) + Math.round(days * DAY);
      const [preimage, paymentHash] = demoPreimage(`round ${round}: ${payer}`);
      const invoice = makeInvoice({
        nodeSecret,
        paymentHash,
        amountMsat,
        network,
        descriptionHash: sha256Hex(metadata),
        expirySeconds: 600,
        timestamp: paidAt - 30,
      });
      events.push(
        createReceiptEvent({
          memberSecret: memberKey(payer),
          context: {
            circleSecret,
            round,
            recipient: { address, knownNodeKeys: [nodeKeyOf(nodeSecret)] },
            expectedAmountMsat: amountMsat,
            network,
          },
          payment: {
            address,
            metadata,
            invoice,
            preimage,
            amountMsat,
            local: { currency: "KES", amount: DEMO_CONTRIBUTION_KES },
            paidAt,
          },
          createdAt: paidAt,
        }),
      );
    }
  }

  const current = PAYMENTS[DEMO_ROUND] ?? {};
  const currentRecipient = recipientOf(DEMO_ROUND);
  return {
    invite: encodeInvite(circleSecret, definition.id),
    circleSecret: bytesToHex(circleSecret),
    circlePubkey,
    organizerPubkey: definition.pubkey,
    definitionId: definition.id,
    events,
    logins: DEMO_MEMBERS.map((m) => ({
      name: m.name,
      secret: bytesToHex(memberKey(m.label)),
      owesCurrentRound: m.label !== currentRecipient && current[m.label] === undefined,
    })),
  };
}

/** The part of a demo login link after "#": the member's secret, then the circle's invite. */
export function demoLoginFragment(secret: string, invite: string): string {
  return `${secret}.${invite}`;
}
