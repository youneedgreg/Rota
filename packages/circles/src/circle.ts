/**
 * A circle: who is in it, who is paid in which round, how much each member
 * contributes and when. Rota's server stores this; it never holds money.
 */

export const CURRENCIES = ["KES", "XOF"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Smallest and largest circle. Two members is the minimum that makes a round. */
export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 20;

/** Tando's limits for a payout to number@bitcoin.co.ke, checked 2026-11-14. */
export const MPESA_MIN_KES = 15;
export const MPESA_MAX_KES = 50_000;
export const MPESA_DOMAIN = "bitcoin.co.ke";

/** Upper bound on one contribution, so a typo can't ask for a fortune. */
export const MAX_CONTRIBUTION: Record<Currency, number> = {
  KES: 50_000,
  XOF: 250_000,
};

export interface Member {
  id: string;
  name: string;
  /** Where this member receives their payout: a Lightning address (LUD-16). */
  payoutAddress: string;
}

export type Schedule =
  | {
      kind: "weekly" | "monthly";
      /** First round opens at this instant (ISO 8601 with a time zone). */
      startsAt: string;
      /** A payment becomes late this many days after its round opens. */
      graceDays: number;
    }
  | {
      /** Short rounds for the demo video and the judge path. */
      kind: "demo";
      startsAt: string;
      roundMinutes: number;
      graceMinutes: number;
    };

export interface Circle {
  id: string;
  name: string;
  currency: Currency;
  /** What each paying member sends per round, in whole KES or XOF. */
  contribution: number;
  members: Member[];
  /** Member ids in payout order: round 1 pays payoutOrder[0], and so on. */
  payoutOrder: string[];
  schedule: Schedule;
}

export type CircleProblem =
  | "name"
  | "currency"
  | "contribution"
  | "member-count"
  | "member-id"
  | "member-name"
  | "duplicate-member"
  | "payout-address"
  | "duplicate-address"
  | "mpesa-currency"
  | "mpesa-range"
  | "payout-order"
  | "schedule";

/**
 * Thrown when a circle is malformed. `problem` is a stable code the app turns
 * into a translated message; `index` points at the member involved, if any.
 * Messages never repeat names, addresses or amounts, so they are safe to log.
 */
export class CircleError extends Error {
  constructor(
    readonly problem: CircleProblem,
    message: string,
    readonly index?: number,
  ) {
    super(message);
    this.name = "CircleError";
  }
}

// LUD-16: the username is a-z, 0-9, "-", "_", "." and "+".
const USERNAME = /^[a-z0-9\-_.+]+$/;
// A DNS name with at least one dot; labels of letters, digits and hyphens.
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// Kenyan mobile numbers: 07XXXXXXXX or 01XXXXXXXX, optionally written as 254… or +254….
const KENYAN_MOBILE = /^(?:\+?254|0)([17]\d{8})$/;

/**
 * Lower-cases and checks a Lightning address. Returns null if it isn't one.
 * M-Pesa numbers are rewritten to 2547XXXXXXXX@bitcoin.co.ke, the form the
 * service's own metadata names (seen 2026-11-14: asked for 07…, it answered
 * 2547…), so receipt check 2 compares like with like.
 */
export function normalizeAddress(address: string): string | null {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at !== trimmed.indexOf("@")) return null;
  let user = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (domain === MPESA_DOMAIN) {
    const mobile = KENYAN_MOBILE.exec(user);
    if (!mobile) return null;
    user = `254${mobile[1]}`;
  }
  if (user.length > 64 || !USERNAME.test(user) || !DOMAIN.test(domain)) return null;
  return `${user}@${domain}`;
}

/** True when the address pays out to M-Pesa through Tando. */
export function isMpesaAddress(address: string): boolean {
  return address.endsWith(`@${MPESA_DOMAIN}`);
}

function isValidInstant(value: string): boolean {
  // Require an explicit zone so the same circle opens at the same instant everywhere.
  return /(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

function checkSchedule(schedule: Schedule): void {
  const bad = (why: string) => new CircleError("schedule", `Schedule: ${why}.`);
  if (!isValidInstant(schedule.startsAt)) throw bad("start must be an ISO date with a time zone");
  if (schedule.kind === "weekly" || schedule.kind === "monthly") {
    const longest = schedule.kind === "weekly" ? 6 : 27;
    if (!Number.isInteger(schedule.graceDays) || schedule.graceDays < 0 || schedule.graceDays > longest) {
      throw bad(`grace must be 0 to ${longest} whole days`);
    }
    return;
  }
  if (schedule.kind === "demo") {
    if (!Number.isInteger(schedule.roundMinutes) || schedule.roundMinutes < 1 || schedule.roundMinutes > 1440) {
      throw bad("demo rounds must last 1 to 1440 whole minutes");
    }
    if (
      !Number.isInteger(schedule.graceMinutes) ||
      schedule.graceMinutes < 0 ||
      schedule.graceMinutes >= schedule.roundMinutes
    ) {
      throw bad("demo grace must be whole minutes, shorter than the round");
    }
    return;
  }
  throw bad("unknown kind");
}

/**
 * Checks a circle and returns a copy with names trimmed and addresses
 * normalized. Throws CircleError on the first problem found.
 */
export function validateCircle(input: Circle): Circle {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) {
    throw new CircleError("name", "Circle name must be 1 to 60 characters.");
  }
  if (!CURRENCIES.includes(input.currency)) {
    throw new CircleError("currency", "Currency must be KES or XOF.");
  }
  const max = MAX_CONTRIBUTION[input.currency];
  if (!Number.isInteger(input.contribution) || input.contribution < 1 || input.contribution > max) {
    throw new CircleError("contribution", `Contribution must be a whole amount from 1 to ${max} ${input.currency}.`);
  }
  if (input.members.length < MIN_MEMBERS || input.members.length > MAX_MEMBERS) {
    throw new CircleError("member-count", `A circle has ${MIN_MEMBERS} to ${MAX_MEMBERS} members.`);
  }

  const ids = new Set<string>();
  const addresses = new Set<string>();
  const members = input.members.map((member, index): Member => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(member.id)) {
      throw new CircleError("member-id", "Member id must be 1 to 64 letters, digits, '-' or '_'.", index);
    }
    if (ids.has(member.id)) throw new CircleError("duplicate-member", "Each member appears once.", index);
    ids.add(member.id);

    const memberName = member.name.trim();
    if (memberName.length < 1 || memberName.length > 40) {
      throw new CircleError("member-name", "Member name must be 1 to 40 characters.", index);
    }

    const address = normalizeAddress(member.payoutAddress);
    if (!address) throw new CircleError("payout-address", "Payout address must be a Lightning address.", index);
    if (addresses.has(address)) {
      throw new CircleError("duplicate-address", "Each member needs their own payout address.", index);
    }
    addresses.add(address);

    if (isMpesaAddress(address)) {
      // Tando's limits are in shillings; an XOF circle would need a second
      // conversion before every payout, so M-Pesa payouts are KES-only for now.
      if (input.currency !== "KES") {
        throw new CircleError("mpesa-currency", "M-Pesa payouts need a circle in KES.", index);
      }
    }
    return { id: member.id, name: memberName, payoutAddress: address };
  });

  // Each member pays an M-Pesa recipient with their own invoice, so Tando's
  // range applies to one contribution, not to the pot.
  if (members.some((m) => isMpesaAddress(m.payoutAddress))) {
    if (input.contribution < MPESA_MIN_KES || input.contribution > MPESA_MAX_KES) {
      throw new CircleError(
        "mpesa-range",
        `Payments to M-Pesa must be ${MPESA_MIN_KES} to ${MPESA_MAX_KES} KES each.`,
      );
    }
  }

  const order = input.payoutOrder;
  if (order.length !== members.length || new Set(order).size !== order.length || !order.every((id) => ids.has(id))) {
    throw new CircleError("payout-order", "Payout order must list every member exactly once.");
  }

  checkSchedule(input.schedule);

  return {
    id: input.id,
    name,
    currency: input.currency,
    contribution: input.contribution,
    members,
    payoutOrder: [...order],
    schedule: { ...input.schedule },
  };
}
