import { base64 } from "@scure/base";
import { generateMnemonic as bip39Generate, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/**
 * The built-in wallet's recovery words, kept on the member's device only and
 * encrypted with a PIN or passphrase the member chooses. Rota's server never
 * sees the words, the PIN or the encrypted blob.
 *
 * Key: PBKDF2-HMAC-SHA256 over the PIN with a random 16-byte salt.
 * Cipher: AES-256-GCM with a random 12-byte nonce, so a wrong PIN or a
 * changed blob fails to decrypt instead of giving wrong words.
 *
 * Limit (in the threat model): this protects the words from anything that
 * can read the browser's storage but doesn't know the PIN. Someone who copies
 * the blob can still guess PINs offline, so longer passphrases are stronger.
 */

/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. Stored in each blob so it can change. */
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PIN_LENGTH = 6;

export interface SealedWords {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  /** Base64. */
  salt: string;
  /** Base64. */
  iv: string;
  /** Base64: AES-GCM ciphertext with its tag. */
  ciphertext: string;
}

export class VaultError extends Error {
  constructor(
    readonly problem: "pin" | "words" | "locked" | "blob",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

/** Twelve new BIP-39 words from the device's secure random source. */
export function generateWords(): string {
  return bip39Generate(wordlist, 128);
}

/** Normalizes typed words (case, spaces) and checks their checksum. */
export function normalizeWords(words: string): string {
  const normalized = words.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(normalized, wordlist)) {
    throw new VaultError("words", "Those aren't valid recovery words. Check each word and its order.");
  }
  return normalized;
}

function checkPin(pin: string): void {
  if (pin.length < MIN_PIN_LENGTH) {
    throw new VaultError("pin", `Use at least ${MIN_PIN_LENGTH} characters.`);
  }
}

async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealWords(words: string, pin: string, iterations = PBKDF2_ITERATIONS): Promise<SealedWords> {
  return sealSecret(normalizeWords(words), pin, iterations);
}

/**
 * Seals any secret the same way, e.g. an NWC connection string, which can
 * spend up to its budget and so gets the same protection as the words.
 */
export async function sealSecret(secret: string, pin: string, iterations = PBKDF2_ITERATIONS): Promise<SealedWords> {
  checkPin(pin);
  if (secret.length === 0) throw new VaultError("blob", "Nothing to save.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, iterations);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)),
  );
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: base64.encode(salt),
    iv: base64.encode(iv),
    ciphertext: base64.encode(ciphertext),
  };
}

/** Reads a stored blob, refusing anything that isn't one this code wrote. */
export function parseSealed(value: unknown): SealedWords {
  const v = value as Partial<SealedWords> | null;
  if (
    !v ||
    v.version !== 1 ||
    v.kdf !== "PBKDF2-SHA256" ||
    typeof v.iterations !== "number" ||
    !Number.isInteger(v.iterations) ||
    v.iterations < 100_000 ||
    typeof v.salt !== "string" ||
    typeof v.iv !== "string" ||
    typeof v.ciphertext !== "string"
  ) {
    throw new VaultError("blob", "The saved wallet on this device is damaged.");
  }
  return v as SealedWords;
}

export async function openWords(sealed: SealedWords, pin: string): Promise<string> {
  return normalizeWords(await openSecret(sealed, pin));
}

export async function openSecret(sealed: SealedWords, pin: string): Promise<string> {
  const blob = parseSealed(sealed);
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(pin, base64.decode(blob.salt), blob.iterations);
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64.decode(blob.iv) as BufferSource },
      key,
      base64.decode(blob.ciphertext) as BufferSource,
    );
  } catch {
    // GCM can't tell a wrong PIN from a changed blob; both mean "don't unlock".
    throw new VaultError("locked", "Wrong PIN. Try again.");
  }
  return new TextDecoder().decode(plain);
}
