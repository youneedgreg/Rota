import { nodeKeyOf, testKey } from "lightning-receipts/testing";
import type { Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  assembleCircle,
  checkDraft,
  createCircleEvent,
  createJoinEvent,
  createRosterEvent,
  decodeInvite,
  encodeInvite,
  type CircleDraft,
  type MemberProfile,
} from "./circle-events";
import { newCircleSecret, newMemberSecret, publicKeyOf } from "./records";

// Fictional people on reserved example domains, and a made-up Kenyan number.
const node = nodeKeyOf(testKey("payout node"));
const profile = (name: string, payoutAddress: string): MemberProfile => ({ name, payoutAddress, knownNodeKeys: [node] });

const T0 = 1_763_200_000;
const circleSecret = newCircleSecret();
const organizer = newMemberSecret();
const [bob, carol, dave] = [newMemberSecret(), newMemberSecret(), newMemberSecret()];

const draft: CircleDraft = {
  name: "Chama ya Wikendi",
  currency: "KES",
  contribution: 15,
  seats: 3,
  schedule: { kind: "demo", startsAt: "2026-11-16T09:00:00+03:00", roundMinutes: 10, graceMinutes: 5 },
  organizer: profile("Amina", "amina@example.com"),
};

const definition = createCircleEvent({ organizerSecret: organizer, circleSecret, draft, createdAt: T0 });

function join(member: Uint8Array, who: MemberProfile, createdAt: number, circleEventId = definition.id): Event {
  return createJoinEvent({ memberSecret: member, circleSecret, circleEventId, profile: who, createdAt });
}

/** A JSON round trip, as events arrive from a relay. */
function fromRelay(events: Event[]): unknown[] {
  return JSON.parse(JSON.stringify(events)) as unknown[];
}

function assemble(events: Event[], circleEventId = definition.id) {
  return assembleCircle({ circleSecret, circleEventId, events: fromRelay(events) });
}

const bobJoin = join(bob, profile("Bakari", "bakari@example.org"), T0 + 10);
const carolJoin = join(carol, profile("Chiku", "0712345678@bitcoin.co.ke"), T0 + 20);

describe("invite links", () => {
  it("round-trip the circle's secret and the definition's id", () => {
    const decoded = decodeInvite(`#${encodeInvite(circleSecret, definition.id)}`);
    if (!decoded) throw new Error("invite didn't decode");
    expect(decoded.circleEventId).toBe(definition.id);
    expect(publicKeyOf(decoded.circleSecret)).toBe(publicKeyOf(circleSecret));
  });

  it("reject anything else", () => {
    for (const junk of ["", "abc", `${"0".repeat(64)}.${definition.id}`, `${"f".repeat(64)}.${definition.id}`, `x.y.z`]) {
      expect(decodeInvite(junk)).toBeNull();
    }
  });
});

describe("checkDraft", () => {
  it("normalizes the organizer's M-Pesa number", () => {
    expect(checkDraft({ ...draft, organizer: profile("Amina", "+254712000111@bitcoin.co.ke") }).organizer.payoutAddress).toBe(
      "254712000111@bitcoin.co.ke",
    );
  });

  it("refuses one seat, an M-Pesa payout in XOF, and an M-Pesa amount below 15 KES", () => {
    expect(() => checkDraft({ ...draft, seats: 1 })).toThrow();
    const mpesa = profile("Amina", "0712000111@bitcoin.co.ke");
    expect(() => checkDraft({ ...draft, currency: "XOF", contribution: 1000, organizer: mpesa })).toThrow();
    expect(() => checkDraft({ ...draft, contribution: 10, organizer: mpesa })).toThrow();
  });
});

describe("assembleCircle", () => {
  it("shows the organizer alone in a new circle", () => {
    const view = assemble([definition]);
    expect(view?.members.map((m) => m.name)).toEqual(["Amina"]);
    expect(view?.full).toBe(false);
    expect(view?.circle).toBeNull();
  });

  it("fills seats in join order and builds the circle once full", () => {
    const view = assemble([carolJoin, definition, bobJoin]);
    expect(view?.members.map((m) => m.name)).toEqual(["Amina", "Bakari", "Chiku"]);
    expect(view?.members[2]?.payoutAddress).toBe("254712345678@bitcoin.co.ke");
    expect(view?.full).toBe(true);
    expect(view?.sealed).toBe(false);
    expect(view?.circle?.payoutOrder).toEqual([publicKeyOf(organizer), publicKeyOf(bob), publicKeyOf(carol)]);
  });

  it("leaves joiners beyond the last seat out", () => {
    const view = assemble([definition, bobJoin, carolJoin, join(dave, profile("Dalila", "dalila@example.net"), T0 + 30)]);
    expect(view?.members.map((m) => m.name)).toEqual(["Amina", "Bakari", "Chiku"]);
  });

  it("returns null when the invite names a definition the relay doesn't have", () => {
    expect(assemble([definition, bobJoin], "ab".repeat(32))).toBeNull();
  });

  it("ignores a rival definition published by someone else holding the link", () => {
    const rival = createCircleEvent({
      organizerSecret: dave,
      circleSecret,
      draft: { ...draft, organizer: profile("Dalila", "dalila@example.net") },
      createdAt: T0 - 100,
    });
    expect(assemble([rival, definition, bobJoin])?.members.map((m) => m.name)).toEqual(["Amina", "Bakari"]);
  });

  it("ignores joins for another circle, from before the circle existed, or tampered with", () => {
    const tampered = { ...bobJoin, content: bobJoin.content.slice(0, -2) + "AA" };
    const otherCircle = join(dave, profile("Dalila", "dalila@example.net"), T0 + 5, "cd".repeat(32));
    const tooEarly = join(carol, profile("Chiku", "chiku@example.org"), T0 - 1);
    expect(assemble([definition, tampered, otherCircle, tooEarly])?.members).toHaveLength(1);
  });

  it("uses a member's first join and skips a payout address already taken", () => {
    const again = join(bob, profile("Bakari B.", "bakari2@example.org"), T0 + 40);
    const sameAddress = join(dave, profile("Dalila", "bakari@example.org"), T0 + 15);
    const view = assemble([definition, bobJoin, again, sameAddress, carolJoin]);
    expect(view?.members.map((m) => m.name)).toEqual(["Amina", "Bakari", "Chiku"]);
  });

  it("skips an M-Pesa joiner in a circle that isn't in KES", () => {
    const xofDraft: CircleDraft = { ...draft, currency: "XOF", contribution: 1000 };
    const xof = createCircleEvent({ organizerSecret: organizer, circleSecret, draft: xofDraft, createdAt: T0 });
    const mpesa = join(carol, profile("Chiku", "0712345678@bitcoin.co.ke"), T0 + 20, xof.id);
    expect(assemble([xof, mpesa], xof.id)?.members).toHaveLength(1);
  });

  describe("the roster", () => {
    const roster = createRosterEvent({
      organizerSecret: organizer,
      circleSecret,
      circleEventId: definition.id,
      members: [publicKeyOf(organizer), publicKeyOf(bob), publicKeyOf(carol)],
      createdAt: T0 + 60,
    });
    // Dave joins late but backdates his event to take a seat already filled.
    const backdated = join(dave, profile("Dalila", "dalila@example.net"), T0 + 5);

    it("without one, a backdated join can push a member out of a full circle", () => {
      expect(assemble([definition, bobJoin, carolJoin, backdated])?.members.map((m) => m.name)).toEqual([
        "Amina",
        "Dalila",
        "Bakari",
      ]);
    });

    it("with one, the seats can't change any more", () => {
      const view = assemble([definition, bobJoin, carolJoin, backdated, roster]);
      expect(view?.sealed).toBe(true);
      expect(view?.members.map((m) => m.name)).toEqual(["Amina", "Bakari", "Chiku"]);
    });

    it("counts only if the organizer signed it", () => {
      const forged = createRosterEvent({
        organizerSecret: dave,
        circleSecret,
        circleEventId: definition.id,
        members: [publicKeyOf(organizer), publicKeyOf(dave), publicKeyOf(bob)],
        createdAt: T0 + 61,
      });
      expect(assemble([definition, bobJoin, carolJoin, forged])?.sealed).toBe(false);
    });

    it("counts only if every member on it has joined", () => {
      const ghost = createRosterEvent({
        organizerSecret: organizer,
        circleSecret,
        circleEventId: definition.id,
        members: [publicKeyOf(organizer), publicKeyOf(bob), publicKeyOf(newMemberSecret())],
        createdAt: T0 + 62,
      });
      expect(assemble([definition, bobJoin, carolJoin, ghost])?.sealed).toBe(false);
    });
  });
});
