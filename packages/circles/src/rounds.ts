import type { Circle, Member, Schedule } from "./circle";

/**
 * Rounds: one per member, in payout order. In each round every member except
 * the recipient pays the recipient directly; the recipient doesn't pay
 * themselves. Times are computed in UTC from the circle's start instant.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface Round {
  /** 1-based. */
  number: number;
  recipient: Member;
  payers: Member[];
  opensAt: Date;
  /** A payment made after this instant counts as late. */
  lateAfter: Date;
}

/** Adds whole months in UTC, keeping the time of day; Jan 31 + 1 month = Feb 28/29. */
export function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

function opensAt(schedule: Schedule, index: number): Date {
  const start = new Date(schedule.startsAt);
  switch (schedule.kind) {
    case "weekly":
      return new Date(start.getTime() + index * 7 * DAY);
    case "monthly":
      // From the start each time, so a 31st start doesn't drift to the 28th.
      return addMonthsUtc(start, index);
    case "demo":
      return new Date(start.getTime() + index * schedule.roundMinutes * MINUTE);
  }
}

function graceMs(schedule: Schedule): number {
  return schedule.kind === "demo" ? schedule.graceMinutes * MINUTE : schedule.graceDays * DAY;
}

/** The number of rounds in one cycle: one payout per member. */
export function roundCount(circle: Circle): number {
  return circle.payoutOrder.length;
}

/** What one recipient receives when every payer pays, in the circle's currency. */
export function potAmount(circle: Circle): number {
  return circle.contribution * (circle.members.length - 1);
}

/** Round `number` (1-based) of a circle that has passed validateCircle. */
export function getRound(circle: Circle, number: number): Round {
  if (!Number.isInteger(number) || number < 1 || number > roundCount(circle)) {
    throw new RangeError(`Round must be 1 to ${roundCount(circle)}.`);
  }
  const recipientId = circle.payoutOrder[number - 1];
  const recipient = circle.members.find((m) => m.id === recipientId);
  if (!recipient) throw new RangeError("Payout order names an unknown member.");
  const open = opensAt(circle.schedule, number - 1);
  return {
    number,
    recipient,
    payers: circle.members.filter((m) => m.id !== recipientId),
    opensAt: open,
    lateAfter: new Date(open.getTime() + graceMs(circle.schedule)),
  };
}

/**
 * The round open at `now`: the last one whose opening time has passed.
 * Returns null before the first round opens. After the last round opens it
 * stays the current round; the cycle ends when that round is complete.
 */
export function currentRound(circle: Circle, now: Date): Round | null {
  let current: Round | null = null;
  for (let n = 1; n <= roundCount(circle); n++) {
    const round = getRound(circle, n);
    if (round.opensAt.getTime() > now.getTime()) break;
    current = round;
  }
  return current;
}

/** The instant the cycle's last payment becomes late; wallet connections can expire after it. */
export function cycleEnd(circle: Circle): Date {
  return getRound(circle, roundCount(circle)).lateAfter;
}
