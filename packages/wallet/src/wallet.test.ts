import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  PaymentGuardError,
  VaultError,
  checkQuote,
  generateWords,
  maxFeeSats,
  normalizeWords,
  openSecret,
  openWords,
  parseSealed,
  preimageOf,
  sealSecret,
  sealWords,
  type PreparedQuote,
  type SentPayment,
} from "./index";

// A low iteration count keeps tests fast; the real default is 600,000.
const FAST = 100_000;
// The standard BIP-39 test vector (all-zero entropy), never a real wallet.
const TEST_WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("recovery words", () => {
  it("generates 12 valid words, different each time", () => {
    const a = generateWords();
    expect(a.split(" ")).toHaveLength(12);
    expect(normalizeWords(a)).toBe(a);
    expect(generateWords()).not.toBe(a);
  });

  it("tidies typed words", () => {
    expect(normalizeWords(`  ${TEST_WORDS.toUpperCase().replaceAll(" ", "   ")} `)).toBe(TEST_WORDS);
  });

  it("refuses words with a bad checksum or unknown word", () => {
    expect(() => normalizeWords(TEST_WORDS.replace(/about$/, "abandon"))).toThrow(VaultError);
    expect(() => normalizeWords(TEST_WORDS.replace(/^abandon/, "rota"))).toThrow(VaultError);
  });
});

describe("vault", () => {
  it("seals and opens with the right PIN", async () => {
    const sealed = await sealWords(TEST_WORDS, "482915", FAST);
    expect(sealed.ciphertext).not.toContain("abandon");
    expect(JSON.stringify(sealed)).not.toContain("482915");
    expect(await openWords(sealed, "482915")).toBe(TEST_WORDS);
  });

  it("uses a fresh salt and nonce each time", async () => {
    const a = await sealWords(TEST_WORDS, "482915", FAST);
    const b = await sealWords(TEST_WORDS, "482915", FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses a wrong PIN", async () => {
    const sealed = await sealWords(TEST_WORDS, "482915", FAST);
    await expect(openWords(sealed, "482916")).rejects.toMatchObject({ problem: "locked" });
  });

  it("refuses a changed blob", async () => {
    const sealed = await sealWords(TEST_WORDS, "482915", FAST);
    const bytes = Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = { ...sealed, ciphertext: btoa(String.fromCharCode(...bytes)) };
    await expect(openWords(tampered, "482915")).rejects.toMatchObject({ problem: "locked" });
  });

  it("seals any secret, such as an NWC connection string", async () => {
    const secret = "nostr+walletconnect://" + "ab".repeat(32) + "?relay=wss%3A%2F%2Frelay.example.com&secret=" + "cd".repeat(32);
    const sealed = await sealSecret(secret, "482915", FAST);
    expect(sealed.ciphertext).not.toContain("walletconnect");
    expect(await openSecret(sealed, "482915")).toBe(secret);
  });

  it("refuses a short PIN", async () => {
    await expect(sealWords(TEST_WORDS, "12345", FAST)).rejects.toMatchObject({ problem: "pin" });
  });

  it("refuses a weakened or damaged blob", () => {
    expect(() => parseSealed(null)).toThrow(VaultError);
    expect(() => parseSealed({ version: 1, kdf: "PBKDF2-SHA256", iterations: 1000, salt: "", iv: "", ciphertext: "" })).toThrow(
      VaultError,
    );
  });
});

describe("checkQuote", () => {
  const invoice = "lnbc50u1ptestinvoice";
  const paymentHash = "00".repeat(32);
  function quote(overrides: { amountMsat?: number; fee?: number; amount?: bigint; bolt11?: string; type?: string } = {}) {
    return {
      paymentMethod: {
        type: overrides.type ?? "bolt11Invoice",
        invoiceDetails: { amountMsat: overrides.amountMsat ?? 5_000_000, paymentHash, invoice: { bolt11: overrides.bolt11 ?? invoice } },
        lightningFeeSats: overrides.fee ?? 3,
      },
      amount: overrides.amount ?? 5000n,
    } as PreparedQuote;
  }
  const expected = { invoice, amountMsat: 5_000_000n };

  it("accepts the approved invoice and amount within the fee limit", () => {
    expect(checkQuote(quote(), expected)).toBe(3);
  });

  it("caps fees at 1%, with a 10-sat floor", () => {
    expect(maxFeeSats(5_000_000n)).toBe(50);
    expect(maxFeeSats(178_000n)).toBe(10);
  });

  it.each<[string, Parameters<typeof quote>[0], PaymentGuardError["problem"]]>([
    ["not a Lightning invoice", { type: "sparkAddress" }, "method"],
    ["a different invoice", { bolt11: "lnbc50u1pother" }, "invoice"],
    ["a different invoice amount", { amountMsat: 5_000_001 }, "amount"],
    ["a different send amount", { amount: 5001n }, "amount"],
    ["a fee above 1%", { fee: 51 }, "fee"],
    ["a negative fee", { fee: -1 }, "fee"],
  ])("refuses %s", (_label, overrides, problem) => {
    expect(() => checkQuote(quote(overrides), expected)).toThrow(expect.objectContaining({ problem }));
  });
});

describe("preimageOf", () => {
  const preimage = "11".repeat(32);
  const paymentHash = bytesToHex(sha256(hexToBytes(preimage)));
  const done = (details: SentPayment["details"], status: SentPayment["status"] = "completed"): SentPayment => ({
    status,
    fees: 3n,
    details,
  });

  it("returns a preimage that matches the invoice", () => {
    expect(preimageOf(done({ type: "lightning", htlcDetails: { paymentHash, preimage } }), paymentHash)).toBe(preimage);
  });

  it.each<[string, SentPayment, PaymentGuardError["problem"]]>([
    ["a failed payment", done(undefined, "failed"), "failed"],
    ["a pending payment", done(undefined, "pending"), "pending"],
    ["a Spark transfer", done({ type: "spark" }), "preimage"],
    ["no preimage", done({ type: "lightning", htlcDetails: { paymentHash } }), "preimage"],
    ["a preimage for another invoice", done({ type: "lightning", htlcDetails: { paymentHash, preimage: "22".repeat(32) } }), "preimage"],
  ])("refuses %s", (_label, payment, problem) => {
    expect(() => preimageOf(payment, paymentHash)).toThrow(expect.objectContaining({ problem }));
  });
});
