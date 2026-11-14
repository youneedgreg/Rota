import { describe, expect, it, vi } from "vitest";
import { coinbaseResponse, coingeckoResponse, coingeckoXof } from "./fixtures/prices";
import {
  COINBASE_URL,
  COINGECKO_URL,
  PriceError,
  XOF_PER_EUR,
  checkTandoRate,
  createPriceSource,
  localToMsat,
  msatToLocal,
  parseCoinGecko,
  parseCoinbase,
  perBtc,
  tandoToMsat,
  type Quote,
} from "./prices";

const gecko = parseCoinGecko(coingeckoResponse);
const quoteTime = gecko.at;

describe("parsing", () => {
  it("reads CoinGecko's recorded response", () => {
    expect(gecko.source).toBe("coingecko");
    expect(gecko.perBtc.KES).toBeCloseTo(8551555.68, 2);
    expect(gecko.at.toISOString()).toBe("2026-11-14T17:55:50.000Z");
  });

  it("reads Coinbase's string rates", () => {
    const at = new Date("2026-11-14T18:00:00Z");
    const quote = parseCoinbase(coinbaseResponse, at);
    expect(quote.perBtc).toEqual({ EUR: 59638.26, KES: 8550488.385 });
    expect(quote.at).toBe(at);
  });

  it("agrees with CoinGecko's own XOF through the euro peg", () => {
    const gap = Math.abs(perBtc(gecko, "XOF") - coingeckoXof) / coingeckoXof;
    expect(gap).toBeLessThan(1e-9);
    expect(perBtc(gecko, "XOF")).toBeCloseTo(gecko.perBtc.EUR * XOF_PER_EUR, 6);
  });

  it.each<[string, unknown]>([
    ["nothing", null],
    ["no bitcoin", { ethereum: {} }],
    ["no timestamp", { bitcoin: { eur: 60000, kes: 8_500_000 } }],
    ["a zero price", { bitcoin: { eur: 0, kes: 8_500_000, last_updated_at: 1 } }],
    ["a string price", { bitcoin: { eur: "60000", kes: 8_500_000, last_updated_at: 1 } }],
    ["KES and EUR swapped", { bitcoin: { eur: 8_500_000_000, kes: 60000, last_updated_at: 1 } }],
  ])("rejects a CoinGecko response with %s", (_label, json) => {
    expect(() => parseCoinGecko(json)).toThrow(PriceError);
  });

  it.each<[string, unknown]>([
    ["the wrong base", { data: { currency: "ETH", rates: coinbaseResponse.data.rates } }],
    ["no KES", { data: { currency: "BTC", rates: { EUR: "60000" } } }],
    ["an empty rate", { data: { currency: "BTC", rates: { EUR: "", KES: "8500000" } } }],
    ["a word for a rate", { data: { currency: "BTC", rates: { EUR: "lots", KES: "8500000" } } }],
  ])("rejects a Coinbase response with %s", (_label, json) => {
    expect(() => parseCoinbase(json, new Date())).toThrow(PriceError);
  });
});

describe("conversion", () => {
  // A round number makes the arithmetic checkable by hand: 1 BTC = 10,000,000 KES = 100,000 EUR.
  const quote: Quote = { source: "coingecko", at: new Date(0), perBtc: { EUR: 100_000, KES: 10_000_000 } };

  it("converts KES at the market price", () => {
    // 500 KES = 500 / 10,000,000 BTC = 5,000 sats.
    expect(localToMsat(500, "KES", quote)).toBe(5_000_000n);
  });

  it("converts XOF through the euro", () => {
    // 1 BTC = 65,595,700 XOF, so 6,559.57 XOF = 10,000 sats.
    expect(localToMsat(6559.57, "XOF", quote)).toBe(10_000_000n);
  });

  it("rounds up to a whole sat, never down", () => {
    // 1 KES = 10 sats exactly; 1.01 KES = 10.1 sats → 11.
    expect(localToMsat(1.01, "KES", quote)).toBe(11_000n);
  });

  it("doesn't round float noise up", () => {
    const awkward: Quote = { ...quote, perBtc: { EUR: 100_000, KES: 3 * 10_000_000 } };
    // 3 KES = 10 sats; 3 * 1e8 / 3e7 may not be exactly 10 in floating point.
    expect(localToMsat(3, "KES", awkward)).toBe(10_000n);
  });

  it("converts back for display", () => {
    expect(msatToLocal(5_000_000n, "KES", quote)).toBeCloseTo(500, 9);
  });

  it("refuses zero and negative amounts", () => {
    expect(() => localToMsat(0, "KES", quote)).toThrow(RangeError);
    expect(() => localToMsat(-5, "KES", quote)).toThrow(RangeError);
    expect(() => tandoToMsat(Number.NaN, 11_684)).toThrow(RangeError);
  });

  it("uses Tando's multiplier for M-Pesa recipients", () => {
    // 15 KES × 11,684 msat/KES = 175,260 msat = 175.26 sats → 176 sats.
    expect(tandoToMsat(15, 11_684)).toBe(176_000n);
    expect(tandoToMsat(1, 11_000)).toBe(11_000n);
    expect(() => tandoToMsat(15, 0)).toThrow(PriceError);
  });
});

describe("checkTandoRate", () => {
  it("accepts Tando's rate from 14 Nov against that day's market", () => {
    // 11,684 msat/KES implies 1e11 / 11,684 ≈ 8.56M KES per BTC; the market was ≈ 8.55M.
    expect(() => checkTandoRate(11_684, gecko)).not.toThrow();
  });

  it("refuses a rate that asks for far more sats than the shillings are worth", () => {
    // Double the msat per KES = half the implied bitcoin price.
    expect(() => checkTandoRate(2 * 11_684, gecko)).toThrow(/away from the market/);
  });

  it("refuses a nonsense rate", () => {
    expect(() => checkTandoRate(-1, gecko)).toThrow(PriceError);
    expect(() => checkTandoRate(Number.POSITIVE_INFINITY, gecko)).toThrow(PriceError);
  });
});

describe("createPriceSource", () => {
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  it("uses CoinGecko and caches it", async () => {
    const fetch = vi.fn(async () => json(coingeckoResponse));
    let now = quoteTime.getTime() + 5_000;
    const source = createPriceSource({ fetch, now: () => new Date(now) });

    expect((await source.getQuote()).source).toBe("coingecko");
    now += 30_000;
    await source.getQuote();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(COINGECKO_URL, expect.anything());

    now += 31_000; // past the 60 s cache
    await source.getQuote();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to Coinbase when CoinGecko fails", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url) === COINGECKO_URL ? json({ status: "rate limited" }, 429) : json(coinbaseResponse),
    );
    const source = createPriceSource({ fetch, now: () => quoteTime });
    expect((await source.getQuote()).source).toBe("coinbase");
    expect(fetch).toHaveBeenLastCalledWith(COINBASE_URL, expect.anything());
  });

  it("falls back to Coinbase when CoinGecko's price is stale", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url) === COINGECKO_URL ? json(coingeckoResponse) : json(coinbaseResponse),
    );
    const source = createPriceSource({ fetch, now: () => new Date(quoteTime.getTime() + 11 * 60_000) });
    expect((await source.getQuote()).source).toBe("coinbase");
  });

  it("falls back when the network fails", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === COINGECKO_URL) throw new TypeError("Failed to fetch");
      return json(coinbaseResponse);
    });
    const source = createPriceSource({ fetch, now: () => quoteTime });
    expect((await source.getQuote()).source).toBe("coinbase");
  });

  it("says why when both fail", async () => {
    const fetch = vi.fn(async () => json({}, 503));
    const source = createPriceSource({ fetch, now: () => quoteTime });
    await expect(source.getQuote()).rejects.toThrow(/CoinGecko: .*503.*Coinbase: .*503/);
  });
});
