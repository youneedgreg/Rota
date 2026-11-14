import { lnurlMetadata, makeInvoice, nodeKeyOf, sha256Hex, testKey, testPreimage } from "@rota/receipts/testing";
import { describe, expect, it, vi } from "vitest";
import {
  LnurlError,
  amountFor,
  checkInvoiceResponse,
  fetchInvoice,
  invoiceRequestUrl,
  parsePayParams,
  payParamsUrl,
  probeAddress,
  type LnurlProblem,
  type PayParams,
} from "./lnurl";
import type { Quote } from "./prices";

// Generated keys and fictional addresses only; no real person's address or number.
const ALBY_LIKE = "awa@example.com";
const MPESA = "254700000001@bitcoin.co.ke";
const T0 = 1_794_600_000; // the test invoices' timestamp
const now = new Date((T0 + 10) * 1000);

const nodeSecret = testKey("recipient node");
const nodeKey = nodeKeyOf(nodeSecret);
const otherSecret = testKey("someone else's node");
const [, paymentHash] = testPreimage("lnurl");

const albyMetadata = lnurlMetadata(ALBY_LIKE);
// Same shape as bitcoin.co.ke's answer on 2026-11-14, with a fictional number.
const mpesaMetadata = JSON.stringify([
  ["text/plain", `Payment to Kenyan phone ${MPESA}`],
  ["text/identifier", MPESA],
]);

const albyResponse = {
  tag: "payRequest",
  callback: "https://example.com/lnurlp/awa/callback",
  minSendable: 1000,
  maxSendable: 10_000_000_000,
  metadata: albyMetadata,
  commentAllowed: 255,
};

const mpesaResponse = {
  callback: `https://bitcoin.co.ke/.well-known/lnurlp/${MPESA.split("@")[0]}`,
  maxSendable: 584_346_000,
  minSendable: 178_000,
  metadata: mpesaMetadata,
  currency: {
    code: "KES",
    name: "Kenyan Shillings",
    symbol: "KSh",
    decimals: 0,
    minSendable: 15,
    maxSendable: 50000,
    multiplier: 11687,
  },
  tag: "payRequest",
};

const alby = parsePayParams(albyResponse, ALBY_LIKE);
const mpesa = parsePayParams(mpesaResponse, MPESA);

// 1 BTC = 8,556,000 KES, close to Tando's 11,687 msat/KES (≈ 8,556,516 KES/BTC).
const quote: Quote = { source: "coingecko", at: now, perBtc: { EUR: 59_650, KES: 8_556_000 } };

function albyInvoice(amountMsat: bigint, overrides: Partial<Parameters<typeof makeInvoice>[0]> = {}) {
  return makeInvoice({ nodeSecret, paymentHash, amountMsat, descriptionHash: sha256Hex(albyMetadata), timestamp: T0, ...overrides });
}

function mpesaInvoice(amountMsat: bigint, overrides: Partial<Parameters<typeof makeInvoice>[0]> = {}) {
  return makeInvoice({
    nodeSecret,
    paymentHash,
    amountMsat,
    description: `Payment to ${MPESA}`,
    expirySeconds: 120,
    timestamp: T0,
    ...overrides,
  });
}

function problemOf(run: () => unknown): LnurlProblem | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof LnurlError) return error.problem;
    throw error;
  }
}

describe("payParamsUrl", () => {
  it("follows LUD-16", () => {
    expect(payParamsUrl(MPESA)).toBe("https://bitcoin.co.ke/.well-known/lnurlp/254700000001");
    expect(payParamsUrl("a+b@example.com")).toBe("https://example.com/.well-known/lnurlp/a%2Bb");
  });
});

describe("parsePayParams", () => {
  it("reads a plain Lightning address", () => {
    expect(alby.minSendable).toBe(1000n);
    expect(alby.currency).toBeUndefined();
    expect(alby.metadata).toBe(albyMetadata);
  });

  it("reads Tando's currency block", () => {
    expect(mpesa.currency).toEqual({ code: "KES", multiplier: 11687, min: 15, max: 50000 });
  });

  it.each<[string, Record<string, unknown>, LnurlProblem]>([
    ["a service error", { status: "ERROR", reason: "unknown user" }, "service"],
    ["the wrong tag", { ...albyResponse, tag: "withdrawRequest" }, "response"],
    ["an http callback", { ...albyResponse, callback: "http://example.com/cb" }, "response"],
    ["no callback", { ...albyResponse, callback: undefined }, "response"],
    ["min above max", { ...albyResponse, minSendable: 10, maxSendable: 5 }, "response"],
    ["a fractional amount", { ...albyResponse, minSendable: 1.5 }, "response"],
    ["no metadata", { ...albyResponse, metadata: undefined }, "response"],
    ["metadata naming someone else", { ...albyResponse, metadata: lnurlMetadata("eve@example.com") }, "identifier"],
    ["metadata naming no one", { ...albyResponse, metadata: '[["text/plain","hi"]]' }, "identifier"],
  ])("rejects %s", (_label, json, expected) => {
    expect(problemOf(() => parsePayParams(json, ALBY_LIKE))).toBe(expected);
  });

  it("ignores a malformed currency block instead of trusting it", () => {
    const params = parsePayParams({ ...mpesaResponse, currency: { ...mpesaResponse.currency, multiplier: -1 } }, MPESA);
    expect(params.currency).toBeUndefined();
  });
});

describe("amountFor", () => {
  it("uses Tando's rate for KES to an M-Pesa recipient, raised to its minimum", () => {
    // 15 × 11,687 = 175,305 msat → 176 sats, below Tando's 178-sat minimum → 178 sats.
    expect(amountFor(mpesa, 15, "KES", quote)).toBe(178_000n);
    // 500 × 11,687 = 5,843,500 msat → 5,844 sats.
    expect(amountFor(mpesa, 500, "KES", quote)).toBe(5_844_000n);
  });

  it("refuses shillings outside Tando's range", () => {
    expect(problemOf(() => amountFor(mpesa, 14, "KES", quote))).toBe("range");
    expect(problemOf(() => amountFor(mpesa, 50_001, "KES", quote))).toBe("range");
  });

  it("refuses when Tando's rate is far from the market", () => {
    const greedy: PayParams = { ...mpesa, currency: { code: "KES", multiplier: 2 * 11687, min: 15, max: 50000 } };
    expect(problemOf(() => amountFor(greedy, 500, "KES", quote))).toBe("rate");
  });

  it("uses the market price for other addresses", () => {
    // 500 KES / 8,556,000 KES per BTC = 5,843.85 sats → 5,844.
    expect(amountFor(alby, 500, "KES", quote)).toBe(5_844_000n);
  });
});

describe("invoiceRequestUrl", () => {
  it("adds the amount to the callback, keeping its own query", () => {
    const params = { ...alby, callback: "https://example.com/cb?k=1" };
    expect(invoiceRequestUrl(params, 5_000n * 1000n)).toBe("https://example.com/cb?k=1&amount=5000000");
  });

  it("refuses amounts outside the address's range", () => {
    expect(problemOf(() => invoiceRequestUrl(mpesa, 177_000n))).toBe("range");
    expect(problemOf(() => invoiceRequestUrl(mpesa, 584_347_000n))).toBe("range");
  });
});

describe("checkInvoiceResponse", () => {
  const known = { knownNodeKeys: [nodeKey], now };

  it("accepts an invoice that commits to the metadata", () => {
    const checked = checkInvoiceResponse(
      { pr: albyInvoice(5_000_000n), verify: "https://example.com/verify/abc" },
      alby,
      5_000_000n,
      known,
    );
    expect(checked.proof).toBe("description-hash");
    expect(checked.verifyUrl).toBe("https://example.com/verify/abc");
  });

  it("accepts Tando's plain description, as the weaker proof", () => {
    const checked = checkInvoiceResponse({ pr: mpesaInvoice(178_000n), routes: [] }, mpesa, 178_000n, known);
    expect(checked.proof).toBe("description");
    expect(checked.verifyUrl).toBeUndefined();
  });

  it.each<[string, () => unknown, LnurlProblem]>([
    ["a service error", () => ({ status: "ERROR", reason: "amount too low" }), "service"],
    ["no invoice", () => ({ routes: [] }), "response"],
    ["garbage", () => ({ pr: "lnbc1notaninvoice" }), "invoice"],
    ["a different amount", () => ({ pr: albyInvoice(5_000_001n) }), "amount"],
    ["no amount", () => ({ pr: albyInvoice(null as unknown as bigint) }), "amount"],
    ["testnet", () => ({ pr: albyInvoice(5_000_000n, { network: "tb" }) }), "network"],
    [
      "a hash of someone else's metadata",
      () => ({ pr: albyInvoice(5_000_000n, { descriptionHash: sha256Hex(lnurlMetadata("eve@example.com")) }) }),
      "identifier",
    ],
    ["a stranger's node", () => ({ pr: albyInvoice(5_000_000n, { nodeSecret: otherSecret }) }), "issuer"],
    ["an expired invoice", () => ({ pr: albyInvoice(5_000_000n, { timestamp: T0 - 3600 }) }), "expired"],
    ["an http verify URL", () => ({ pr: albyInvoice(5_000_000n), verify: "http://example.com/v" }), "response"],
  ])("refuses %s", (_label, response, expected) => {
    expect(problemOf(() => checkInvoiceResponse(response(), alby, 5_000_000n, known))).toBe(expected);
  });

  it("refuses an M-Pesa invoice with under 15 seconds left", () => {
    const late = new Date((T0 + 110) * 1000);
    expect(
      problemOf(() => checkInvoiceResponse({ pr: mpesaInvoice(178_000n) }, mpesa, 178_000n, { ...known, now: late })),
    ).toBe("expired");
  });

  it("skips the issuer check only while setup records the node", () => {
    const pr = albyInvoice(5_000_000n, { nodeSecret: otherSecret });
    expect(() => checkInvoiceResponse({ pr }, alby, 5_000_000n, { knownNodeKeys: [], now })).not.toThrow();
  });
});

describe("fetching", () => {
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  it("probes an address at setup and records its node, paying nothing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === "/.well-known/lnurlp/awa") return json(albyResponse);
      expect(u.searchParams.get("amount")).toBe("1000");
      return json({ pr: albyInvoice(1000n), routes: [] });
    });
    const probe = await probeAddress(ALBY_LIKE, { fetch, now });
    expect(probe.nodeKey).toBe(nodeKey);
    expect(probe.proof).toBe("description-hash");
    expect(fetch).toHaveBeenCalledTimes(2);
    // Redirects are refused, so the phone only talks to the address's own domain.
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("reports a service's error reason", async () => {
    const fetch = vi.fn(async () => json({ status: "ERROR", reason: "Invoice limit reached" }, 400));
    await expect(fetchInvoice(alby, 5_000_000n, { fetch, knownNodeKeys: [nodeKey], now })).rejects.toThrow(
      /Invoice limit reached/,
    );
  });

  it("explains a network failure in plain words", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchInvoice(alby, 5_000_000n, { fetch, knownNodeKeys: [nodeKey], now })).rejects.toThrow(
      /Couldn't reach the recipient's service/,
    );
  });
});
