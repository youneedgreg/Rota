// The built-in wallet: Breez SDK (Spark) running in the member's browser.
// Client-only: import it from "use client" components. The SDK's WASM loads on
// the first connectWallet() call, so other pages don't download it.
import init, {
  connect,
  defaultConfig,
  type BreezSdk,
  type Network,
  type Payment,
  type PrepareSendPaymentResponse,
} from "@breeztech/breez-sdk-spark/ssr";
import {
  checkQuote,
  openWords,
  parseSealed,
  preimageOf,
  sealWords,
  type PreparedQuote,
  type SealedWords,
  type SentPayment,
} from "@rota/wallet";

import { BUILT_IN_WALLET_KEY as STORAGE_KEY } from "./storage-keys";
import { UiError } from "./messages";

/**
 * "mainnet" (the default, and the demo) or "regtest" (Lightspark's free test
 * network: no Lightning there, but enough to check that the wallet loads,
 * creates and unlocks). Set NEXT_PUBLIC_BREEZ_NETWORK in .env.local.
 */
export function walletNetwork(): Network {
  return process.env.NEXT_PUBLIC_BREEZ_NETWORK === "regtest" ? "regtest" : "mainnet";
}

/** The sealed recovery words saved on this device, or null. */
export function savedWallet(): SealedWords | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseSealed(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Encrypts the words with the PIN and saves only the ciphertext on this device. */
export async function saveWallet(words: string, pin: string): Promise<void> {
  const sealed = await sealWords(words, pin);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sealed));
}

/** Removes this device's copy. The funds stay reachable with the recovery words. */
export function forgetWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** The wallet can't start on this device; its message comes from the app's own text. */
export class WalletSetupError extends UiError {}

/** Unlocks the saved words with the PIN and connects the wallet. */
export async function unlockWallet(pin: string): Promise<BreezSdk> {
  const sealed = savedWallet();
  if (!sealed) throw new WalletSetupError("err.noWallet");
  const words = await openWords(sealed, pin);
  return connectWallet(words);
}

async function connectWallet(mnemonic: string): Promise<BreezSdk> {
  const network = walletNetwork();
  const apiKey = process.env.NEXT_PUBLIC_BREEZ_API_KEY;
  // Breez requires a key on mainnet; its regtest network doesn't.
  if (network === "mainnet" && !apiKey) {
    throw new WalletSetupError("err.noBreezKey");
  }
  await init();
  const config = defaultConfig(network);
  if (apiKey) config.apiKey = apiKey;
  return connect({
    config,
    seed: { type: "mnemonic", mnemonic },
    // IndexedDB database name for the wallet's state (not the words).
    storageDir: `rota-wallet-${network}`,
  });
}

export async function balanceSats(sdk: BreezSdk): Promise<number> {
  const info = await sdk.getInfo({ ensureSynced: true });
  return info.balanceSats;
}

/** A Lightning invoice for someone to pay this wallet. */
export async function receiveInvoice(sdk: BreezSdk, amountSats: number, description: string): Promise<string> {
  const response = await sdk.receivePayment({
    paymentMethod: { type: "bolt11Invoice", description, amountSats },
  });
  return response.paymentRequest;
}

/**
 * A UUID-shaped key from the payment hash (version 4 and variant bits set).
 * The SDK rejects some idempotency keys without documenting the format, and a
 * UUID is the safe choice; the same invoice always gives the same key.
 */
function uuidFromHash(paymentHash: string): string {
  const h = paymentHash.toLowerCase().slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export interface WalletPaymentResult {
  preimage: string;
  feeSats: number;
  payment: Payment;
}

/**
 * Pays an invoice that Rota's invoice check (@rota/circles) already approved.
 * The wallet's quote must match that invoice and amount, with fees under
 * Rota's limit; the payment goes over Lightning (not as a Spark transfer) so
 * it returns the preimage the receipt needs.
 */
export async function payInvoice(
  sdk: BreezSdk,
  approved: { invoice: string; amountMsat: bigint; paymentHash: string },
): Promise<WalletPaymentResult> {
  const prepared: PrepareSendPaymentResponse = await sdk.prepareSendPayment({
    paymentRequest: { type: "input", input: approved.invoice },
  });
  const feeSats = checkQuote(prepared as unknown as PreparedQuote, approved);
  const { payment } = await sdk.sendPayment({
    prepareResponse: prepared,
    options: { type: "bolt11Invoice", preferSpark: false, completionTimeoutSecs: 30 },
    // The same invoice is never paid twice, even if the member taps again.
    idempotencyKey: uuidFromHash(approved.paymentHash),
  });
  const preimage = preimageOf(payment as unknown as SentPayment, approved.paymentHash);
  return { preimage, feeSats, payment };
}
