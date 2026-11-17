// Removes personal data and secrets from an error report before it leaves the
// phone. Rota's invite links carry the circle's secret after "#", payout
// addresses can be phone numbers, and error text can quote an address, an
// invoice or a key. Everything below runs on the phone; Sentry's own
// server-side scrubbing is a second layer, not the first.

/** Each pattern, in order, and what it's replaced with. */
const PATTERNS: [RegExp, string][] = [
  // Anything after # or ? in a URL: invite secrets live after #.
  [/([a-z][a-z0-9+.-]*:\/\/[^\s"'<>#?]*)[?#][^\s"'<>]*/gi, "$1"],
  // A bare invite fragment: 64 hex, a dot, 64 hex.
  [/#?[0-9a-f]{64}\.[0-9a-f]{64}/gi, "[invite]"],
  // BOLT11 invoices.
  [/\bln(bc|tb|bcrt|tbs)[0-9a-z]{20,}\b/gi, "[invoice]"],
  // Nostr and NWC secrets and connection strings.
  [/\bnostr\+walletconnect:\/\/\S+/gi, "[nwc]"],
  [/\bnsec1[0-9a-z]{20,}\b/gi, "[key]"],
  // Lightning addresses and e-mail addresses (user@domain).
  [/[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/gi, "[address]"],
  // Phone numbers: 7 or more digits, optionally with + and separators.
  [/\+?\d[\d\s-]{6,}\d/g, "[number]"],
  // Long hex: keys, preimages, payment hashes, event ids.
  [/\b[0-9a-f]{32,}\b/gi, "[hex]"],
];

/** Scrubs one string. */
export function scrubText(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

/** Scrubs every string in a value, however deep, without changing its shape. */
export function scrubValue<T>(value: T, depth = 0): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubValue(v, depth + 1);
  return out as T;
}

/** Parts of a report dropped outright: the page URL and headers, clicks, the user and free-form extras. */
const DROPPED = ["request", "breadcrumbs", "user", "extra"] as const;

/**
 * Prepares a report for sending: drops the request (page URL and headers),
 * breadcrumbs, user and extra data outright, then scrubs every remaining
 * string (messages, stack frames, tags, contexts).
 */
export function scrubReport<T extends object>(report: T): T {
  const rest = { ...report } as Record<string, unknown>;
  for (const key of DROPPED) delete rest[key];
  return scrubValue(rest) as unknown as T;
}
