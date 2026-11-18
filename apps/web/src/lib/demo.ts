// Demo logins for the local demo circle that `@rota/seed` puts on the relay.
// A login link is /demo#<member secret>.<circle invite>. The demo keys are
// public, so this only works on regtest: on mainnet, a link that swaps in
// someone else's key would let them sign as you.
import { decodeInvite, publicKeyOf } from "@rota/records";
import { hexToBytes } from "@noble/hashes/utils.js";
import { invoiceNetwork } from "./rounds";

export interface DemoLogin {
  secret: string;
  pubkey: string;
  invite: string;
}

/** Whether this copy of Rota accepts demo logins. */
export function demoLoginsAllowed(): boolean {
  return invoiceNetwork() === "bcrt";
}

/** Reads a demo login link's fragment, or null if it's broken. */
export function parseDemoLogin(fragment: string): DemoLogin | null {
  const [secret, ...rest] = fragment.replace(/^#/, "").trim().toLowerCase().split(".");
  const invite = rest.join(".");
  if (!secret || !/^[0-9a-f]{64}$/.test(secret) || !decodeInvite(invite)) return null;
  try {
    return { secret, pubkey: publicKeyOf(hexToBytes(secret)), invite };
  } catch {
    return null;
  }
}
