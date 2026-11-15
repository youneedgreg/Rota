import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { capSats, checkConnection, checkNwcPayment, connectionRequest, NwcPolicyError, type ConnectionReport } from "./index";

// 500 KES ≈ 5,844 sats on 2026-11-14; cap = 5,844 × 1.25 = 7,305 sats.
const CONTRIBUTION = 5_844;
const CAP = 7_305;

const good: ConnectionReport = {
  methods: ["pay_invoice", "get_info", "get_budget"],
  budget: { total_budget: CAP * 1000, used_budget: 0, renewal_period: "monthly" },
};

function problem(report: ConnectionReport): string | undefined {
  try {
    checkConnection(report, CONTRIBUTION);
    return undefined;
  } catch (error) {
    if (error instanceof NwcPolicyError) return error.problem;
    throw error;
  }
}

describe("cap", () => {
  it("adds 25% headroom, rounded up", () => {
    expect(capSats(CONTRIBUTION)).toBe(CAP);
    expect(capSats(4)).toBe(5);
    expect(() => capSats(0)).toThrow(RangeError);
  });

  it("asks the wallet for pay-only, monthly, in msat, expiring", () => {
    const expiresAt = new Date("2027-03-02T06:00:00Z");
    expect(connectionRequest({ contributionSats: CONTRIBUTION, expiresAt })).toEqual({
      name: "Rota",
      requestMethods: ["pay_invoice", "get_info", "get_budget"],
      maxAmount: CAP * 1000,
      budgetRenewal: "monthly",
      expiresAt,
      isolated: false,
    });
  });
});

describe("checkConnection", () => {
  it("accepts a narrow, capped, monthly connection", () => {
    expect(problem(good)).toBeUndefined();
    expect(problem({ ...good, methods: ["pay_invoice"] })).toBeUndefined();
  });

  it.each<[string, ConnectionReport, string]>([
    ["extra methods", { ...good, methods: [...good.methods, "list_transactions"] }, "methods"],
    ["no pay method", { ...good, methods: ["get_info", "get_budget"] }, "no-pay"],
    ["no budget reported", { ...good, budget: {} }, "no-budget"],
    ["a zero budget", { ...good, budget: { ...good.budget, total_budget: 0 } }, "no-budget"],
    ["a weekly budget", { ...good, budget: { ...good.budget, renewal_period: "weekly" } }, "renewal"],
    ["a never-renewing budget", { ...good, budget: { ...good.budget, renewal_period: "never" } }, "renewal"],
    ["a budget above the cap", { ...good, budget: { ...good.budget, total_budget: CAP * 1000 + 1 } }, "too-large"],
    ["a budget below one contribution", { ...good, budget: { ...good.budget, total_budget: CONTRIBUTION * 1000 - 1 } }, "too-small"],
    // A wallet that wrongly reports sats looks 1000× too small: refused, never accepted.
    ["a budget reported in sats", { ...good, budget: { ...good.budget, total_budget: CAP } }, "too-small"],
  ])("refuses %s", (_label, report, expected) => {
    expect(problem(report)).toBe(expected);
  });

  it("names the extra powers in plain words", () => {
    expect(() => checkConnection({ ...good, methods: [...good.methods, "make_invoice"] }, CONTRIBUTION)).toThrow(
      /can also make_invoice/,
    );
  });
});

describe("checkNwcPayment", () => {
  const preimage = "33".repeat(32);
  const hash = bytesToHex(sha256(hexToBytes(preimage)));

  it("accepts a matching preimage", () => {
    expect(checkNwcPayment({ preimage: preimage.toUpperCase(), fees_paid: 2000 }, hash)).toBe(preimage);
  });

  it.each<[string, { preimage?: unknown }]>([
    ["no preimage", {}],
    ["a short preimage", { preimage: "33" }],
    ["a preimage for another invoice", { preimage: "44".repeat(32) }],
  ])("refuses %s", (_label, response) => {
    expect(() => checkNwcPayment(response, hash)).toThrow(expect.objectContaining({ problem: "proof" }));
  });
});
