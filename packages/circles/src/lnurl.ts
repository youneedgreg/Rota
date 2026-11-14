import {
  checkAddress,
  checkAmount,
  checkIssuer,
  decodeInvoice,
  InvoiceError,
  metadataIdentifier,
  type AddressProof,
  type Invoice,
} from "@rota/receipts";
import type { Currency } from "./circle";
import { checkTandoRate, localToMsat, PriceError, type Quote } from "./prices";

/**
 * Paying a Lightning address (LUD-16 over LUD-06), from the payer's phone.
 * Rota's server never runs this: the phone fetches the address's pay
 * parameters, asks the address for an invoice, and checks that invoice before
 * any wallet sees it. Every check failure throws LnurlError and nothing is paid.
 */

export type LnurlProblem =
  | "address"
  | "network"
  | "response"
  | "service"
  | "identifier"
  | "range"
  | "invoice"
  | "amount"
  | "issuer"
  | "expired"
  | "rate";

export class LnurlError extends Error {
  constructor(
    readonly problem: LnurlProblem,
    message: string,
  ) {
    super(message);
    this.name = "LnurlError";
  }
}

/** The service's own price for one unit of local money (an LNURL `currency` extension; Tando sends it). */
export interface ServiceCurrency {
  code: string;
  /** Msat per one unit of `code`. */
  multiplier: number;
  /** Smallest and largest payment, in units of `code`. */
  min: number;
  max: number;
}

export interface PayParams {
  address: string;
  callback: string;
  minSendable: bigint;
  maxSendable: bigint;
  /** The exact metadata string served; receipts hash it, so it's kept byte for byte. */
  metadata: string;
  currency?: ServiceCurrency;
}

export interface CheckedInvoice {
  invoice: string;
  decoded: Invoice;
  amountMsat: bigint;
  proof: AddressProof;
  /** LUD-21 verify URL, if the service offers one. */
  verifyUrl?: string;
}

/** Seconds an invoice must still have left when it's handed to a wallet. */
export const MIN_SECONDS_LEFT = 15;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function httpsUrl(value: unknown, what: string): string {
  if (typeof value !== "string") throw new LnurlError("response", `The ${what} URL is missing.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LnurlError("response", `The ${what} URL is not a URL.`);
  }
  if (url.protocol !== "https:") throw new LnurlError("response", `The ${what} URL is not HTTPS.`);
  return url.toString();
}

function msat(value: unknown, what: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new LnurlError("response", `The address's ${what} is missing or invalid.`);
  }
  return BigInt(value);
}

/** LUD-16: user@domain is served at https://domain/.well-known/lnurlp/user. */
export function payParamsUrl(address: string): string {
  const at = address.indexOf("@");
  if (at <= 0) throw new LnurlError("address", "Not a Lightning address.");
  return `https://${address.slice(at + 1)}/.well-known/lnurlp/${encodeURIComponent(address.slice(0, at))}`;
}

function serviceError(json: unknown): void {
  if (isRecord(json) && json.status === "ERROR") {
    // The reason is the service's own text; show it, but it decides nothing.
    const reason = typeof json.reason === "string" ? json.reason.slice(0, 200) : "no reason given";
    throw new LnurlError("service", `The recipient's service refused: ${reason}`);
  }
}

function parseCurrency(value: unknown): ServiceCurrency | undefined {
  if (!isRecord(value)) return undefined;
  const { code, multiplier, minSendable, maxSendable } = value;
  if (
    typeof code !== "string" ||
    typeof multiplier !== "number" ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    typeof minSendable !== "number" ||
    typeof maxSendable !== "number" ||
    !(minSendable > 0 && minSendable <= maxSendable)
  ) {
    return undefined; // Optional extension: ignore it rather than trust a malformed one.
  }
  return { code: code.toUpperCase(), multiplier, min: minSendable, max: maxSendable };
}

/**
 * Reads an address's pay parameters (LUD-06) and checks that its metadata
 * names exactly this address (LUD-16), so check 2 can pass later.
 */
export function parsePayParams(json: unknown, address: string): PayParams {
  serviceError(json);
  if (!isRecord(json) || json.tag !== "payRequest") {
    throw new LnurlError("response", "The address didn't answer with pay parameters.");
  }
  const minSendable = msat(json.minSendable, "minimum");
  const maxSendable = msat(json.maxSendable, "maximum");
  if (minSendable > maxSendable) throw new LnurlError("response", "The address's minimum is above its maximum.");
  if (typeof json.metadata !== "string") throw new LnurlError("response", "The address served no metadata.");
  if (metadataIdentifier(json.metadata) !== address.toLowerCase()) {
    throw new LnurlError("identifier", "The address's metadata names a different address.");
  }
  const currency = parseCurrency(json.currency);
  return {
    address: address.toLowerCase(),
    callback: httpsUrl(json.callback, "callback"),
    minSendable,
    maxSendable,
    metadata: json.metadata,
    ...(currency ? { currency } : {}),
  };
}

/**
 * Msat to send for `amount` of the circle's currency to this address.
 * If the service quotes the same currency (Tando quotes KES), its own rate
 * is used, so the recipient gets the exact amount, after checking that rate
 * against the market. Otherwise the market quote is used.
 */
export function amountFor(params: PayParams, amount: number, currency: Currency, quote: Quote): bigint {
  const service = params.currency;
  if (service && service.code === currency && currency === "KES") {
    if (amount < service.min || amount > service.max) {
      throw new LnurlError("range", `This recipient accepts ${service.min} to ${service.max} ${service.code} per payment.`);
    }
    try {
      checkTandoRate(service.multiplier, quote);
    } catch (error) {
      if (error instanceof PriceError) throw new LnurlError("rate", error.message);
      throw error;
    }
    const raw = BigInt(Math.ceil((amount * service.multiplier) / 1000 - 1e-9)) * 1000n;
    // The service's msat minimum can sit a few sats above its own rate × its
    // minimum (178 vs 176 sats for 15 KES on 2026-11-14). The amount is within
    // its stated range, so send its minimum: the recipient gets a little more.
    return raw < params.minSendable ? params.minSendable : raw;
  }
  return localToMsat(amount, currency, quote);
}

/** The callback URL that asks for an invoice of `amountMsat` (LUD-06). */
export function invoiceRequestUrl(params: PayParams, amountMsat: bigint): string {
  if (amountMsat < params.minSendable || amountMsat > params.maxSendable) {
    throw new LnurlError("range", "The amount is outside what this address accepts.");
  }
  const url = new URL(params.callback);
  url.searchParams.set("amount", amountMsat.toString());
  return url.toString();
}

export interface InvoiceCheckOptions {
  /** Node keys recorded for this address at setup. Empty: setup is recording them now. */
  knownNodeKeys: readonly string[];
  network?: string;
  now?: Date;
}

/**
 * Checks the callback's answer before any wallet sees the invoice: it must be
 * a valid invoice, on the circle's network, for exactly the amount asked,
 * tied to this address, signed by the address's known node, and not about to
 * expire. These are receipt checks 2 to 4, run before paying instead of after.
 */
export function checkInvoiceResponse(
  json: unknown,
  params: PayParams,
  amountMsat: bigint,
  options: InvoiceCheckOptions,
): CheckedInvoice {
  serviceError(json);
  if (!isRecord(json) || typeof json.pr !== "string") {
    throw new LnurlError("response", "The address didn't return an invoice.");
  }
  let decoded: Invoice;
  try {
    decoded = decodeInvoice(json.pr);
  } catch (error) {
    throw new LnurlError("invoice", error instanceof InvoiceError ? error.message : "The invoice could not be read.");
  }

  const network = options.network ?? "bc";
  const amount = checkAmount(decoded, amountMsat, network);
  if (!amount.ok) {
    throw new LnurlError(decoded.network === network ? "amount" : "network", `Invoice refused: ${amount.detail}.`);
  }
  const address = checkAddress(decoded, params.address, params.metadata);
  if (!address.ok || !address.proof) throw new LnurlError("identifier", `Invoice refused: ${address.detail}.`);
  if (options.knownNodeKeys.length > 0) {
    const issuer = checkIssuer(decoded, options.knownNodeKeys);
    if (!issuer.ok) throw new LnurlError("issuer", `Invoice refused: ${issuer.detail}.`);
  }
  const now = (options.now ?? new Date()).getTime() / 1000;
  if (decoded.timestamp + decoded.expirySeconds - now < MIN_SECONDS_LEFT) {
    throw new LnurlError("expired", "The invoice has expired or is about to. Tap Pay again for a fresh one.");
  }

  const verifyUrl = json.verify === undefined ? undefined : httpsUrl(json.verify, "verify");
  return { invoice: json.pr, decoded, amountMsat, proof: address.proof, ...(verifyUrl ? { verifyUrl } : {}) };
}

export interface LnurlClientOptions {
  fetch: typeof fetch;
  timeoutMs?: number;
}

async function getJson(url: string, options: LnurlClientOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      // A redirect could send the phone somewhere the address didn't name.
      redirect: "error",
    });
  } catch {
    throw new LnurlError("network", "Couldn't reach the recipient's service. Check your connection and try again.");
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new LnurlError("response", `The recipient's service answered ${response.status} without JSON.`);
  }
  if (!response.ok) {
    serviceError(json);
    throw new LnurlError("service", `The recipient's service answered ${response.status}.`);
  }
  return json;
}

export async function fetchPayParams(address: string, options: LnurlClientOptions): Promise<PayParams> {
  return parsePayParams(await getJson(payParamsUrl(address), options), address);
}

export async function fetchInvoice(
  params: PayParams,
  amountMsat: bigint,
  options: LnurlClientOptions & InvoiceCheckOptions,
): Promise<CheckedInvoice> {
  const json = await getJson(invoiceRequestUrl(params, amountMsat), options);
  return checkInvoiceResponse(json, params, amountMsat, options);
}

export interface AddressProbe {
  params: PayParams;
  /** The node that signed a sample invoice: record it for the issuer check. */
  nodeKey: string;
  proof: AddressProof;
}

/**
 * Run once per payout address when the circle is set up: fetch its pay
 * parameters and an unpaid invoice for its minimum, and record which node
 * signed it and how the invoice names the address. Nothing is paid.
 */
export async function probeAddress(
  address: string,
  options: LnurlClientOptions & { network?: string; now?: Date },
): Promise<AddressProbe> {
  const params = await fetchPayParams(address, options);
  const sample = await fetchInvoice(params, params.minSendable, { ...options, knownNodeKeys: [] });
  return { params, nodeKey: sample.decoded.payeeNodeKey, proof: sample.proof };
}
