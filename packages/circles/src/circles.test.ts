import { describe, expect, it } from "vitest";
import {
  CircleError,
  addMonthsUtc,
  currentRound,
  cycleEnd,
  getRound,
  normalizeAddress,
  potAmount,
  roundCount,
  roundStatus,
  validateCircle,
  type Circle,
  type CircleProblem,
} from "./index";

// Fictional members and addresses only.
function circle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: "c1",
    name: "  Chama ya Jumapili ",
    currency: "KES",
    contribution: 500,
    members: [
      { id: "awa", name: "Awa", payoutAddress: "Awa@Example.com" },
      { id: "baraka", name: "Baraka", payoutAddress: "0700000001@bitcoin.co.ke" },
      { id: "chiku", name: "Chiku", payoutAddress: "chiku@wallet.example.org" },
    ],
    payoutOrder: ["baraka", "awa", "chiku"],
    schedule: { kind: "monthly", startsAt: "2026-01-31T09:00:00+03:00", graceDays: 2 },
    ...overrides,
  };
}

function problem(input: Circle): CircleProblem | undefined {
  try {
    validateCircle(input);
    return undefined;
  } catch (error) {
    if (error instanceof CircleError) return error.problem;
    throw error;
  }
}

describe("normalizeAddress", () => {
  it("lower-cases and trims", () => {
    expect(normalizeAddress("  Awa@Example.COM ")).toBe("awa@example.com");
  });
  it.each(["awa", "@example.com", "awa@", "a b@example.com", "awa@example", "a@b@example.com", "awa@-x.com"])(
    "rejects %s",
    (value) => expect(normalizeAddress(value)).toBeNull(),
  );
});

describe("validateCircle", () => {
  it("accepts a good circle and normalizes it", () => {
    const valid = validateCircle(circle());
    expect(valid.name).toBe("Chama ya Jumapili");
    expect(valid.members[0]?.payoutAddress).toBe("awa@example.com");
  });

  it("does not change its input", () => {
    const input = circle();
    validateCircle(input);
    expect(input.members[0]?.payoutAddress).toBe("Awa@Example.com");
  });

  it.each<[string, Partial<Circle>, CircleProblem]>([
    ["empty name", { name: "  " }, "name"],
    ["unknown currency", { currency: "USD" as Circle["currency"] }, "currency"],
    ["fractional amount", { contribution: 10.5 }, "contribution"],
    ["zero amount", { contribution: 0 }, "contribution"],
    ["one member", { members: circle().members.slice(0, 1), payoutOrder: ["awa"] }, "member-count"],
    ["M-Pesa in an XOF circle", { currency: "XOF", contribution: 5000 }, "mpesa-currency"],
    ["M-Pesa below 15 KES", { contribution: 14 }, "mpesa-range"],
    ["order missing a member", { payoutOrder: ["awa", "baraka"] }, "payout-order"],
    ["order repeating a member", { payoutOrder: ["awa", "awa", "chiku"] }, "payout-order"],
    ["order naming a stranger", { payoutOrder: ["awa", "baraka", "zed"] }, "payout-order"],
    ["start without a zone", { schedule: { kind: "weekly", startsAt: "2026-01-01T09:00:00", graceDays: 1 } }, "schedule"],
    ["weekly grace of 7 days", { schedule: { kind: "weekly", startsAt: "2026-01-01T09:00:00Z", graceDays: 7 } }, "schedule"],
    [
      "demo grace as long as the round",
      { schedule: { kind: "demo", startsAt: "2026-01-01T09:00:00Z", roundMinutes: 5, graceMinutes: 5 } },
      "schedule",
    ],
  ])("rejects %s", (_label, overrides, expected) => {
    expect(problem(circle(overrides))).toBe(expected);
  });

  it("rejects an XOF amount above its cap", () => {
    const lightningOnly = circle().members.map((m) => ({ ...m, payoutAddress: `${m.id}@example.com` }));
    expect(problem(circle({ currency: "XOF", contribution: 250_001, members: lightningOnly }))).toBe("contribution");
    expect(problem(circle({ currency: "XOF", contribution: 250_000, members: lightningOnly }))).toBeUndefined();
  });

  it("allows M-Pesa at exactly 15 KES", () => {
    expect(problem(circle({ contribution: 15 }))).toBeUndefined();
  });

  it("points at the member with a bad address, without echoing it", () => {
    const members = circle().members.map((m, i) => (i === 2 ? { ...m, payoutAddress: "not an address" } : m));
    try {
      validateCircle(circle({ members }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CircleError);
      expect((error as CircleError).problem).toBe("payout-address");
      expect((error as CircleError).index).toBe(2);
      expect((error as CircleError).message).not.toContain("not an address");
    }
  });

  it("rejects two members sharing an address, case-insensitively", () => {
    const members = circle().members.map((m, i) => (i === 2 ? { ...m, payoutAddress: "AWA@example.com" } : m));
    expect(problem(circle({ members }))).toBe("duplicate-address");
  });

  it("rejects duplicate member ids", () => {
    const members = circle().members.map((m, i) => (i === 2 ? { ...m, id: "awa" } : m));
    expect(problem(circle({ members }))).toBe("duplicate-member");
  });
});

describe("rounds", () => {
  const valid = validateCircle(circle());

  it("has one round per member and a pot of the other members' contributions", () => {
    expect(roundCount(valid)).toBe(3);
    expect(potAmount(valid)).toBe(1000);
  });

  it("pays recipients in order; the recipient doesn't pay", () => {
    const round1 = getRound(valid, 1);
    expect(round1.recipient.id).toBe("baraka");
    expect(round1.payers.map((m) => m.id)).toEqual(["awa", "chiku"]);
    expect(getRound(valid, 3).recipient.id).toBe("chiku");
  });

  it("rejects round numbers outside the cycle", () => {
    expect(() => getRound(valid, 0)).toThrow(RangeError);
    expect(() => getRound(valid, 4)).toThrow(RangeError);
    expect(() => getRound(valid, 1.5)).toThrow(RangeError);
  });

  it("monthly rounds clamp to the month's last day without drifting", () => {
    // Start: 31 Jan 09:00 Nairobi = 06:00 UTC.
    expect(getRound(valid, 2).opensAt.toISOString()).toBe("2026-02-28T06:00:00.000Z");
    expect(getRound(valid, 3).opensAt.toISOString()).toBe("2026-03-31T06:00:00.000Z");
    expect(getRound(valid, 1).lateAfter.toISOString()).toBe("2026-02-02T06:00:00.000Z");
  });

  it("handles leap years and year ends", () => {
    expect(addMonthsUtc(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-12-15T12:00:00Z"), 1).toISOString()).toBe("2027-01-15T12:00:00.000Z");
  });

  it("weekly and demo rounds step by fixed lengths", () => {
    const weekly = validateCircle(
      circle({ schedule: { kind: "weekly", startsAt: "2026-11-16T07:00:00Z", graceDays: 1 } }),
    );
    expect(getRound(weekly, 2).opensAt.toISOString()).toBe("2026-11-23T07:00:00.000Z");
    expect(getRound(weekly, 2).lateAfter.toISOString()).toBe("2026-11-24T07:00:00.000Z");

    const demo = validateCircle(
      circle({ schedule: { kind: "demo", startsAt: "2026-11-16T07:00:00Z", roundMinutes: 10, graceMinutes: 3 } }),
    );
    expect(getRound(demo, 3).opensAt.toISOString()).toBe("2026-11-16T07:20:00.000Z");
    expect(cycleEnd(demo).toISOString()).toBe("2026-11-16T07:23:00.000Z");
  });

  it("finds the current round", () => {
    expect(currentRound(valid, new Date("2026-01-30T00:00:00Z"))).toBeNull();
    expect(currentRound(valid, new Date("2026-01-31T06:00:00Z"))?.number).toBe(1);
    expect(currentRound(valid, new Date("2026-03-01T00:00:00Z"))?.number).toBe(2);
    expect(currentRound(valid, new Date("2027-01-01T00:00:00Z"))?.number).toBe(3);
  });
});

describe("roundStatus", () => {
  const valid = validateCircle(circle());
  // Round 1 opens 2026-01-31T06:00Z; payments are late after 2026-02-02T06:00Z.
  const opens = new Date("2026-01-31T06:00:00Z");
  const beforeLate = new Date("2026-02-01T12:00:00Z");
  const afterLate = new Date("2026-02-03T00:00:00Z");

  it("is upcoming before it opens", () => {
    const status = roundStatus(valid, 1, [], new Date("2026-01-01T00:00:00Z"));
    expect(status.state).toBe("upcoming");
    expect(status.payers.map((p) => p.state)).toEqual(["pending", "pending"]);
  });

  it("marks pending, then late, payers who haven't paid", () => {
    const payments = [{ round: 1, memberId: "awa", paidAt: opens }];
    const early = roundStatus(valid, 1, payments, beforeLate);
    expect(early.state).toBe("open");
    expect(early.payers.map((p) => [p.member.id, p.state])).toEqual([
      ["awa", "paid"],
      ["chiku", "pending"],
    ]);
    expect(roundStatus(valid, 1, payments, afterLate).payers[1]?.state).toBe("late");
  });

  it("completes when every payer has paid, and records who was on time", () => {
    const status = roundStatus(
      valid,
      1,
      [
        { round: 1, memberId: "awa", paidAt: opens },
        { round: 1, memberId: "chiku", paidAt: afterLate },
      ],
      afterLate,
    );
    expect(status.state).toBe("complete");
    expect(status.paidCount).toBe(2);
    expect(status.payers.map((p) => p.onTime)).toEqual([true, false]);
  });

  it("counts a member once and keeps their first payment", () => {
    const status = roundStatus(
      valid,
      1,
      [
        { round: 1, memberId: "awa", paidAt: afterLate },
        { round: 1, memberId: "awa", paidAt: opens },
      ],
      afterLate,
    );
    expect(status.paidCount).toBe(1);
    expect(status.payers[0]?.paidAt).toEqual(opens);
  });

  it("ignores payments from the recipient, strangers and other rounds", () => {
    const status = roundStatus(
      valid,
      1,
      [
        { round: 1, memberId: "baraka", paidAt: opens },
        { round: 1, memberId: "zed", paidAt: opens },
        { round: 2, memberId: "awa", paidAt: opens },
      ],
      beforeLate,
    );
    expect(status.paidCount).toBe(0);
    expect(status.ignored.map((p) => p.memberId)).toEqual(["baraka", "zed"]);
  });
});
