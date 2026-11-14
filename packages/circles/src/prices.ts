import type { Currency } from "./circle";

/**
 * Turning KES and XOF into sats. Runs on the payer's phone just before a
 * payment, so Rota's server never sets the amount.
 *
 * - Lightning addresses in general: CoinGecko's keyless simple/price, with
 *   Coinbase's exchange-rates as the fallback (both checked 2026-11-14:
 *   browser requests allowed, within 0.1% of each other).
 * - XOF is pegged to the euro: 1 EUR = 655.957 XOF, so XOF = EUR × 655.957.
 * - M-Pesa recipients (number@bitcoin.co.ke): Tando's own rate from the
 *   LNURL response, so the recipient gets the exact shillings. The market
 *   quote is then only a second check that Tando's rate is sane.
 */

export const XOF_PER_EUR = 655.957;
export const SATS_PER_BTC = 100_000_000;

export const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur,kes&include_last_updated_at=true&precision=full";
export const COINBASE_URL = "https://api.coinbase.com/v2/exchange-rates?currency=BTC";

export interface Quote {
  source: "coingecko" | "coinbase";
  /** When the price was set (CoinGecko) or fetched (Coinbase gives no time). */
  at: Date;
  /** Price of one bitcoin. */
  perBtc: { EUR: number; KES: number };
}

export class PriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceError";
  }
}

// Wide bounds that only catch garbage (a zero, a unit mix-up), not market moves.
const BOUNDS = { EUR: [1_000, 100_000_000], KES: [100_000, 10_000_000_000] } as const;

/** CoinGecko sends numbers; Coinbase sends decimal strings. */
function price(value: unknown, currency: "EUR" | "KES", fromString = false): number {
  const n = fromString && typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  const [low, high] = BOUNDS[currency];
  if (typeof n !== "number" || !Number.isFinite(n) || n < low || n > high) {
    throw new PriceError(`BTC/${currency} price is missing or implausible.`);
  }
  return n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads CoinGecko's `simple/price` response for ids=bitcoin, vs eur,kes. */
export function parseCoinGecko(json: unknown): Quote {
  const btc = isRecord(json) ? json.bitcoin : undefined;
  if (!isRecord(btc)) throw new PriceError("CoinGecko response has no bitcoin price.");
  const updated = btc.last_updated_at;
  if (typeof updated !== "number" || !Number.isInteger(updated) || updated <= 0) {
    throw new PriceError("CoinGecko response has no timestamp.");
  }
  return {
    source: "coingecko",
    at: new Date(updated * 1000),
    perBtc: { EUR: price(btc.eur, "EUR"), KES: price(btc.kes, "KES") },
  };
}

/** Reads Coinbase's `exchange-rates?currency=BTC` response (rates are strings). */
export function parseCoinbase(json: unknown, fetchedAt: Date): Quote {
  const data = isRecord(json) ? json.data : undefined;
  if (!isRecord(data) || data.currency !== "BTC" || !isRecord(data.rates)) {
    throw new PriceError("Coinbase response has no BTC rates.");
  }
  return {
    source: "coinbase",
    at: fetchedAt,
    perBtc: { EUR: price(data.rates.EUR, "EUR", true), KES: price(data.rates.KES, "KES", true) },
  };
}

/** Price of one bitcoin in the circle's currency. */
export function perBtc(quote: Quote, currency: Currency): number {
  return currency === "XOF" ? quote.perBtc.EUR * XOF_PER_EUR : quote.perBtc.KES;
}

// Float noise (e.g. 175.00000000000003) must not cost a whole extra sat.
function ceilSats(sats: number): bigint {
  return BigInt(Math.ceil(sats - 1e-9));
}

function checkAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("Amount must be a positive number.");
}

/**
 * Msat to send for `amount` of local money at the market quote. Rounded up
 * to a whole sat, so the recipient never gets less than the amount, and
 * whole sats because some wallets and services reject msat precision.
 */
export function localToMsat(amount: number, currency: Currency, quote: Quote): bigint {
  checkAmount(amount);
  return ceilSats((amount * SATS_PER_BTC) / perBtc(quote, currency)) * 1000n;
}

/** Local money that `msat` is worth at the quote, for display only. */
export function msatToLocal(msat: bigint, currency: Currency, quote: Quote): number {
  return (Number(msat) / 1000 / SATS_PER_BTC) * perBtc(quote, currency);
}

/**
 * Msat to send an M-Pesa recipient `kes` shillings at Tando's rate
 * (`currency.multiplier` in its LNURL response, msat per KES), rounded up to
 * a whole sat.
 */
export function tandoToMsat(kes: number, multiplier: number): bigint {
  checkAmount(kes);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new PriceError("Tando's rate is missing or implausible.");
  }
  return ceilSats((kes * multiplier) / 1000) * 1000n;
}

/** How far Tando's rate may sit from the market before Rota refuses to pay. Rota's own choice. */
export const TANDO_TOLERANCE = 0.05;

/**
 * Second check on Tando's rate: the bitcoin price it implies must be within
 * `tolerance` of the market quote. A broken or hostile LNURL response asking
 * for far more sats than the shillings are worth is refused.
 */
export function checkTandoRate(multiplier: number, quote: Quote, tolerance = TANDO_TOLERANCE): void {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new PriceError("Tando's rate is missing or implausible.");
  }
  const tandoKesPerBtc = (SATS_PER_BTC * 1000) / multiplier;
  const gap = Math.abs(tandoKesPerBtc - quote.perBtc.KES) / quote.perBtc.KES;
  if (gap > tolerance) {
    throw new PriceError(`Tando's rate is ${(gap * 100).toFixed(1)}% away from the market price.`);
  }
}

export interface PriceSourceOptions {
  fetch: typeof fetch;
  now?: () => Date;
  /** Reuse a quote for this long (CoinGecko allows 30–60 s of caching). */
  cacheMs?: number;
  /** Refuse a quote older than this, and try the fallback instead. */
  maxAgeMs?: number;
  timeoutMs?: number;
}

/**
 * A cached price source: CoinGecko first, Coinbase if CoinGecko fails or is
 * stale. Throws PriceError if neither gives a usable quote.
 */
export function createPriceSource(options: PriceSourceOptions): { getQuote(): Promise<Quote> } {
  const now = options.now ?? (() => new Date());
  const cacheMs = options.cacheMs ?? 60_000;
  const maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
  const timeoutMs = options.timeoutMs ?? 8_000;
  let cached: { quote: Quote; fetchedAt: number } | null = null;

  async function getJson(url: string): Promise<unknown> {
    const response = await options.fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new PriceError(`Price service answered ${response.status}.`);
    return response.json();
  }

  function fresh(quote: Quote): Quote {
    const age = now().getTime() - quote.at.getTime();
    if (age > maxAgeMs) throw new PriceError("Price is too old.");
    if (age < -5 * 60_000) throw new PriceError("Price is dated in the future.");
    return quote;
  }

  return {
    async getQuote() {
      const t = now().getTime();
      if (cached && t - cached.fetchedAt < cacheMs) return cached.quote;
      let quote: Quote;
      try {
        quote = fresh(parseCoinGecko(await getJson(COINGECKO_URL)));
      } catch (first) {
        try {
          quote = fresh(parseCoinbase(await getJson(COINBASE_URL), now()));
        } catch (second) {
          throw new PriceError(
            `No price available. CoinGecko: ${(first as Error).message} Coinbase: ${(second as Error).message}`,
          );
        }
      }
      cached = { quote, fetchedAt: t };
      return quote;
    },
  };
}
