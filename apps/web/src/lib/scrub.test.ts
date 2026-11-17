import { describe, expect, it } from "vitest";
import { scrubReport, scrubText } from "./scrub";

// All values are fictional.
const SECRET = "ab".repeat(32);
const EVENT_ID = "cd".repeat(32);
const INVITE = `${SECRET}.${EVENT_ID}`;

describe("scrubText", () => {
  it.each([
    ["an invite link", `https://rota.example/circle#${INVITE}`, "https://rota.example/circle"],
    ["a query string", "https://rota.example/wallet?pin=123456", "https://rota.example/wallet"],
    ["a bare invite", `opening #${INVITE} failed`, "opening [invite] failed"],
    ["a Lightning address", "couldn't pay amina@example.com", "couldn't pay [address]"],
    ["an M-Pesa address", "couldn't pay 254700000001@bitcoin.co.ke", "couldn't pay [address]"],
    ["a phone number", "call 0712 345 678 now", "call [number] now"],
    ["an international number", "from +254700000001", "from [number]"],
    ["an invoice", "bad invoice lnbc1500n1pjexampleexampleexampleexample", "bad invoice [invoice]"],
    ["an NWC string", `nostr+walletconnect://${SECRET}?relay=wss://r&secret=${SECRET}`, "[nwc]"],
    ["an nsec", "key nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", "key [key]"],
    ["a payment hash", `hash ${SECRET}`, "hash [hex]"],
  ])("removes %s", (_name, input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("keeps ordinary error text", () => {
    expect(scrubText("TypeError: Cannot read properties of undefined (reading 'x')")).toBe(
      "TypeError: Cannot read properties of undefined (reading 'x')",
    );
    expect(scrubText("round 3 of 12, 15 KES")).toBe("round 3 of 12, 15 KES");
  });
});

describe("scrubReport", () => {
  const report = {
    message: `Couldn't open circle#${INVITE}`,
    request: { url: `https://rota.example/circle#${INVITE}`, headers: { Referer: "x" } },
    breadcrumbs: [{ message: "clicked Pay for amina@example.com" }],
    user: { ip_address: "10.0.0.1" },
    extra: { invite: INVITE },
    exception: {
      values: [
        {
          type: "Error",
          value: "invoice lnbc1500n1pjexampleexampleexampleexample for 254700000001@bitcoin.co.ke",
          stacktrace: { frames: [{ filename: `https://rota.example/_next/static/chunks/app.js?v=1#${INVITE}`, lineno: 1 }] },
        },
      ],
    },
    tags: { page: `/circle#${INVITE}` },
  };

  it("drops the request, breadcrumbs, user and extra data", () => {
    const out = scrubReport(report) as Record<string, unknown>;
    expect(out.request).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.extra).toBeUndefined();
  });

  it("leaves no invite secret, address, number or invoice anywhere", () => {
    const sent = JSON.stringify(scrubReport(report));
    for (const leak of [SECRET, EVENT_ID, "amina@example.com", "254700000001", "lnbc1500n1", "10.0.0.1"]) {
      expect(sent).not.toContain(leak);
    }
    expect(sent).toContain("https://rota.example/_next/static/chunks/app.js");
    expect(sent).toContain('"lineno":1');
  });
});
