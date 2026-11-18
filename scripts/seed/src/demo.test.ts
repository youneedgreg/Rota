import { localToMsat, type Quote } from "@rota/circles";
import { assembleCircle, decodeInvite, RECEIPT_KIND, roundView } from "@rota/records";
import { describe, expect, it } from "vitest";
import { buildDemo, DEMO_CONTRIBUTION_KES, DEMO_ROUND } from "./demo";

const quote: Quote = { source: "coingecko", at: new Date("2026-11-18T18:00:00Z"), perBtc: { EUR: 80_000, KES: 11_500_000 } };
const now = new Date("2026-11-18T18:00:00Z");

function seeded(at = now) {
  const demo = buildDemo({ quote, now: at, network: "bcrt" });
  const decoded = decodeInvite(demo.invite);
  if (!decoded) throw new Error("bad invite");
  const view = assembleCircle({ ...decoded, events: demo.events });
  if (!view) throw new Error("circle didn't assemble");
  const marketMsat = localToMsat(DEMO_CONTRIBUTION_KES, "KES", quote);
  const round = (n: number) =>
    roundView({
      view,
      circleSecret: decoded.circleSecret,
      round: n,
      events: demo.events.filter((e) => e.kind === RECEIPT_KIND && e.tags.some((t) => t[0] === "round" && t[1] === String(n))),
      marketMsat,
      now: at,
      network: "bcrt",
    });
  return { demo, view, round };
}

describe("the demo circle", () => {
  it("is full and sealed, in seat order", () => {
    const { view } = seeded();
    expect(view.full).toBe(true);
    expect(view.sealed).toBe(true);
    expect(view.members.map((m) => m.name)).toEqual(["Amina", "Baraka", "Wanjiru", "Otieno", "Fatou"]);
    expect(view.members.every((m) => m.payoutAddress.endsWith("@example.com"))).toBe(true);
  });

  it("has rounds 1 and 2 fully paid, every receipt passing its checks", () => {
    const { round } = seeded();
    for (const n of [1, 2]) {
      const r = round(n);
      expect(r.receipts).toHaveLength(4);
      expect(r.receipts.every((x) => x.ok)).toBe(true);
      expect(r.status.paidCount).toBe(4);
      expect(r.disputes).toEqual([]);
    }
    // Fatou paid round 1 after the grace period.
    const late = round(1).status.payers.filter((p) => p.onTime === false).map((p) => p.member.name);
    expect(late).toEqual(["Fatou"]);
  });

  it("is in round 3 now, with two members still to pay on time", () => {
    const { round } = seeded();
    const r = round(DEMO_ROUND);
    expect(r.status.state).toBe("open");
    expect(r.recipient.name).toBe("Wanjiru");
    expect(r.receipts.every((x) => x.ok)).toBe(true);
    const states = Object.fromEntries(r.status.payers.map((p) => [p.member.name, p.state]));
    expect(states).toEqual({ Amina: "paid", Baraka: "pending", Otieno: "paid", Fatou: "pending" });
  });

  it("is in round 3 whatever the date, month ends included", () => {
    const dates = ["2026-01-01T00:30:00Z", "2026-03-01T12:00:00Z", "2026-03-31T23:00:00Z", "2026-05-30T08:00:00Z", "2026-12-31T21:00:00Z", "2028-02-29T10:00:00Z"];
    for (const iso of dates) {
      const at = new Date(iso);
      expect(seeded(at).round(DEMO_ROUND).status.state, iso).toBe("open");
    }
  });

  it("names who still owes the current round", () => {
    const { demo } = seeded();
    expect(demo.logins.filter((l) => l.owesCurrentRound).map((l) => l.name)).toEqual(["Baraka", "Fatou"]);
  });

  it("uses the same keys every time, so an earlier seed is found again", () => {
    const [a, b] = [seeded().demo, seeded(new Date("2027-04-02T00:00:00Z")).demo];
    expect(a.circlePubkey).toBe(b.circlePubkey);
    expect(a.organizerPubkey).toBe(b.organizerPubkey);
    expect(a.logins.map((l) => l.secret)).toEqual(b.logins.map((l) => l.secret));
  });
});
