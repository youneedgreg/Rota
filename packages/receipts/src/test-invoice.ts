// Test-only: builds signed BOLT11 invoices from known keys, so tests never
// depend on real payments or real people's addresses. Exported as "@rota/receipts/testing" for tests only.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";

export interface TestInvoiceOptions {
  nodeSecret: Uint8Array;
  paymentHash: string;
  amountMsat?: bigint | null;
  network?: string;
  description?: string;
  /** Hex SHA-256 to put in the `h` field. */
  descriptionHash?: string;
  /** Put the signer's key in the `n` field (or this key, to forge a mismatch). */
  statedPayee?: string | true;
  expirySeconds?: number;
  timestamp?: number;
}

/** A deterministic test key from a label. */
export function testKey(label: string): Uint8Array {
  return sha256(utf8ToBytes(`rota test key: ${label}`));
}

export function nodeKeyOf(secret: Uint8Array): string {
  return bytesToHex(secp256k1.getPublicKey(secret, true));
}

/** Returns [preimage, payment hash] as hex, derived from a label. */
export function testPreimage(label: string): [string, string] {
  const preimage = sha256(utf8ToBytes(`rota test preimage: ${label}`));
  return [bytesToHex(preimage), bytesToHex(sha256(preimage))];
}

function intToWords(value: number, length: number): number[] {
  const words = new Array<number>(length).fill(0);
  let v = BigInt(value);
  for (let i = length - 1; i >= 0; i--) {
    words[i] = Number(v & 31n);
    v >>= 5n;
  }
  return words;
}

function minimalIntWords(value: number): number[] {
  const words: number[] = [];
  let v = value;
  do {
    words.unshift(v & 31);
    v = Math.floor(v / 32);
  } while (v > 0);
  return words;
}

function field(type: number, data: number[]): number[] {
  return [type, data.length >> 5, data.length & 31, ...data];
}

function amountPart(msat: bigint): string {
  if (msat % 100_000_000n === 0n) return `${msat / 100_000_000n}m`;
  if (msat % 100_000n === 0n) return `${msat / 100_000n}u`;
  if (msat % 100n === 0n) return `${msat / 100n}n`;
  return `${msat * 10n}p`;
}

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

/** Signs `dataWords` under `hrp` and returns the bech32 invoice. */
export function signInvoice(hrp: string, dataWords: number[], nodeSecret: Uint8Array): string {
  const hash = sha256(new Uint8Array([...utf8ToBytes(hrp), ...wordsToBytesPadded(dataWords)]));
  const recovered = secp256k1.sign(hash, nodeSecret, { prehash: false, format: "recovered" });
  // noble returns [recovery, r, s]; BOLT11 wants [r, s, recovery].
  const signature = new Uint8Array([...recovered.slice(1), recovered[0] as number]);
  return bech32.encode(hrp, [...dataWords, ...bech32.toWords(signature)], false);
}

/** Builds the unsigned parts of an invoice. */
export function invoiceParts(options: TestInvoiceOptions): { hrp: string; dataWords: number[] } {
  const network = options.network ?? "bc";
  const amount = options.amountMsat === undefined ? 1_000_000n : options.amountMsat;
  const hrp = `ln${network}${amount === null ? "" : amountPart(amount)}`;

  const words = [...intToWords(options.timestamp ?? 1_794_600_000, 7)];
  words.push(...field(1, bech32.toWords(hexToBytes(options.paymentHash))));
  if (options.description !== undefined) words.push(...field(13, bech32.toWords(utf8ToBytes(options.description))));
  if (options.descriptionHash !== undefined) words.push(...field(23, bech32.toWords(hexToBytes(options.descriptionHash))));
  if (options.statedPayee !== undefined) {
    const key = options.statedPayee === true ? nodeKeyOf(options.nodeSecret) : options.statedPayee;
    words.push(...field(19, bech32.toWords(hexToBytes(key))));
  }
  if (options.expirySeconds !== undefined) words.push(...field(6, minimalIntWords(options.expirySeconds)));
  return { hrp, dataWords: words };
}

export function makeInvoice(options: TestInvoiceOptions): string {
  const { hrp, dataWords } = invoiceParts(options);
  return signInvoice(hrp, dataWords, options.nodeSecret);
}

/** LUD-16 style metadata for an address. */
export function lnurlMetadata(address: string, text = `Payment to ${address}`): string {
  return JSON.stringify([
    ["text/plain", text],
    ["text/identifier", address],
  ]);
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}
