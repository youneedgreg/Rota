import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";

/** A BOLT11 invoice, decoded and with its signature checked. */
export interface Invoice {
  /** Network prefix from the human-readable part: "bc" is mainnet. */
  network: string;
  /** Amount in millisatoshis, or null for an invoice with no amount. */
  amountMsat: bigint | null;
  /** Creation time, seconds since the Unix epoch. */
  timestamp: number;
  /** Seconds after `timestamp` until the invoice expires (default 3600). */
  expirySeconds: number;
  /** 32-byte payment hash, lower-case hex. */
  paymentHash: string;
  /** Plain-text description (`d` field), if present. */
  description: string | null;
  /** SHA-256 of the description (`h` field), lower-case hex, if present. */
  descriptionHash: string | null;
  /** 33-byte compressed public key of the node that signed the invoice. */
  payeeNodeKey: string;
}

/** Thrown when an invoice is malformed or its signature does not check out. */
export class InvoiceError extends Error {
  override name = "InvoiceError";
}

const SIGNATURE_WORDS = 104; // 65 bytes = 520 bits = 104 five-bit words
const TIMESTAMP_WORDS = 7;

const TAG = {
  paymentHash: 1,
  description: 13,
  payeeNodeKey: 19,
  descriptionHash: 23,
  expiry: 6,
} as const;

// Millisatoshis per unit of each BOLT11 multiplier. 1 BTC = 10^11 msat.
// "p" (pico-bitcoin) is a tenth of a millisatoshi, handled separately.
const MSAT_PER_UNIT: Record<string, bigint> = {
  "": 100_000_000_000n,
  m: 100_000_000n,
  u: 100_000n,
  n: 100n,
};

function wordsToBigInt(words: readonly number[]): bigint {
  let value = 0n;
  for (const w of words) value = (value << 5n) | BigInt(w);
  return value;
}

/** Converts 5-bit words to bytes, keeping the trailing padding bits (BOLT11 signing rule). */
function wordsToBytesPadded(words: readonly number[]): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  if (bits > 0) bytes.push((acc << (8 - bits)) & 0xff);
  return Uint8Array.from(bytes);
}

function parseHrp(hrp: string): { network: string; amountMsat: bigint | null } {
  const match = /^ln([a-z]+?)(\d+)?([munp])?$/.exec(hrp);
  if (!match) throw new InvoiceError("not a Lightning invoice");
  const [, network = "", digits, multiplier = ""] = match;
  if (digits === undefined) {
    if (multiplier) throw new InvoiceError("amount multiplier without digits");
    return { network, amountMsat: null };
  }
  if (digits.length > 1 && digits.startsWith("0")) throw new InvoiceError("amount has leading zeros");
  const value = BigInt(digits);
  if (multiplier === "p") {
    if (value % 10n !== 0n) throw new InvoiceError("amount is not a whole number of millisatoshis");
    return { network, amountMsat: value / 10n };
  }
  const perUnit = MSAT_PER_UNIT[multiplier];
  if (perUnit === undefined) throw new InvoiceError("unknown amount multiplier");
  return { network, amountMsat: value * perUnit };
}

/**
 * Decodes a BOLT11 invoice and checks its signature.
 *
 * The payee's node key is taken from the `n` field when present (and the
 * signature verified against it), otherwise recovered from the signature.
 * Either way, `payeeNodeKey` is the key that actually signed the invoice.
 */
export function decodeInvoice(invoice: string): Invoice {
  const text = invoice.trim().toLowerCase().replace(/^lightning:/, "");
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(text as `${string}1${string}`, false);
  } catch {
    throw new InvoiceError("invoice is not valid bech32");
  }
  const { prefix: hrp, words } = decoded;
  if (words.length < TIMESTAMP_WORDS + SIGNATURE_WORDS) throw new InvoiceError("invoice is too short");

  const { network, amountMsat } = parseHrp(hrp);
  const dataWords = words.slice(0, -SIGNATURE_WORDS);
  const signature = bech32.fromWords(words.slice(-SIGNATURE_WORDS));
  const timestamp = Number(wordsToBigInt(dataWords.slice(0, TIMESTAMP_WORDS)));

  let paymentHash: string | null = null;
  let description: string | null = null;
  let descriptionHash: string | null = null;
  let statedPayee: string | null = null;
  let expirySeconds = 3600;

  // Tagged fields: 5-bit type, 10-bit length (in words), then the data.
  // Per BOLT11, fields of the wrong length are skipped; the first valid one wins.
  let i = TIMESTAMP_WORDS;
  while (i < dataWords.length) {
    if (i + 3 > dataWords.length) throw new InvoiceError("truncated tagged field");
    const type = dataWords[i] as number;
    const length = ((dataWords[i + 1] as number) << 5) | (dataWords[i + 2] as number);
    const field = dataWords.slice(i + 3, i + 3 + length);
    if (field.length !== length) throw new InvoiceError("truncated tagged field");
    i += 3 + length;

    switch (type) {
      case TAG.paymentHash:
        if (paymentHash === null && length === 52) paymentHash = bytesToHex(bech32.fromWords(field));
        break;
      case TAG.descriptionHash:
        if (descriptionHash === null && length === 52) descriptionHash = bytesToHex(bech32.fromWords(field));
        break;
      case TAG.payeeNodeKey:
        if (statedPayee === null && length === 53) statedPayee = bytesToHex(bech32.fromWords(field));
        break;
      case TAG.description:
        if (description === null) {
          try {
            description = new TextDecoder("utf-8", { fatal: true }).decode(bech32.fromWords(field));
          } catch {
            throw new InvoiceError("description is not valid UTF-8");
          }
        }
        break;
      case TAG.expiry:
        expirySeconds = Number(wordsToBigInt(field));
        break;
    }
  }

  if (paymentHash === null) throw new InvoiceError("invoice has no payment hash");
  if (signature.length !== 65) throw new InvoiceError("signature has the wrong length");

  const signed = new Uint8Array([...utf8ToBytes(hrp), ...wordsToBytesPadded(dataWords)]);
  const messageHash = sha256(signed);
  const compact = signature.slice(0, 64);
  const recovery = signature[64] as number;
  if (recovery > 3) throw new InvoiceError("bad signature recovery id");

  let payeeNodeKey: string;
  try {
    if (statedPayee !== null) {
      if (!secp256k1.verify(compact, messageHash, hexToBytes(statedPayee), { prehash: false, lowS: false })) {
        throw new InvoiceError("signature does not match the stated payee");
      }
      payeeNodeKey = statedPayee;
    } else {
      // noble's "recovered" format puts the recovery byte first; BOLT11 puts it last.
      const recovered = new Uint8Array([recovery, ...compact]);
      payeeNodeKey = bytesToHex(secp256k1.recoverPublicKey(recovered, messageHash, { prehash: false }));
    }
  } catch (error) {
    if (error instanceof InvoiceError) throw error;
    throw new InvoiceError("invoice signature is invalid");
  }

  return { network, amountMsat, timestamp, expirySeconds, paymentHash, description, descriptionHash, payeeNodeKey };
}
