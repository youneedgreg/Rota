import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * Rules for a member's outside wallet connected through Nostr Wallet Connect
 * (NIP-47). The limit lives in the member's wallet, not in Rota: the wallet
 * itself refuses to pay more than the monthly budget, even if Rota's server
 * were taken over. Rota asks for a narrow connection and refuses any
 * connection it can't confirm is narrow.
 */

/** The only methods Rota asks for: pay, and read the connection's own limits. */
export const NWC_METHODS = ["pay_invoice", "get_info", "get_budget"] as const;
export type NwcMethod = (typeof NWC_METHODS)[number];

/**
 * Headroom over today's contribution, for bitcoin price moves and routing
 * fees during the cycle. Rota's own choice: covers about a 20% price drop.
 * A fully compromised Rota could take at most 1.25 contributions a month.
 */
export const CAP_MARGIN = 0.25;

/** Monthly cap in sats for a contribution worth `contributionSats` today. */
export function capSats(contributionSats: number): number {
  if (!Number.isInteger(contributionSats) || contributionSats < 1) {
    throw new RangeError("Contribution must be a whole number of sats.");
  }
  return Math.ceil(contributionSats * (1 + CAP_MARGIN));
}

/**
 * What Rota asks the wallet for when it opens the wallet's approval page
 * (Alby Hub's /apps/new deep link; `maxAmount` is in msat there). The member
 * still approves it in their own wallet.
 */
export function connectionRequest(options: { contributionSats: number; expiresAt: Date; name?: string }) {
  return {
    name: options.name ?? "Rota",
    requestMethods: [...NWC_METHODS],
    maxAmount: capSats(options.contributionSats) * 1000,
    budgetRenewal: "monthly" as const,
    expiresAt: options.expiresAt,
    isolated: false,
  };
}

/** The parts of the wallet's get_info and get_budget answers Rota reads. */
export interface ConnectionReport {
  methods: readonly string[];
  /** NIP-47 style budget (msat); an empty object when the wallet reports none. */
  budget: { total_budget?: number; used_budget?: number; renewal_period?: string };
}

export type NwcProblem = "methods" | "no-pay" | "no-budget" | "renewal" | "too-large" | "too-small" | "proof";

export class NwcPolicyError extends Error {
  constructor(
    readonly problem: NwcProblem,
    message: string,
  ) {
    super(message);
    this.name = "NwcPolicyError";
  }
}

/**
 * Accepts a connection only if it can do no more than Rota asked for and its
 * wallet reports a monthly budget between one contribution and the cap.
 *
 * Requiring at least one contribution also makes a unit mix-up fail safe:
 * a wallet reporting sats where NIP-47 uses msat looks 1000 times too small
 * and is refused, never accepted as a smaller budget than it really is.
 */
export function checkConnection(report: ConnectionReport, contributionSats: number): void {
  const extra = report.methods.filter((m) => !(NWC_METHODS as readonly string[]).includes(m));
  if (extra.length > 0) {
    throw new NwcPolicyError(
      "methods",
      `This connection can also ${extra.join(", ")}. Make a new one that can only pay, so Rota can't do anything else.`,
    );
  }
  if (!report.methods.includes("pay_invoice")) {
    throw new NwcPolicyError("no-pay", "This connection can't pay invoices.");
  }
  const total = report.budget.total_budget;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    throw new NwcPolicyError(
      "no-budget",
      "Your wallet didn't confirm a spending limit for this connection. Rota only accepts connections with a monthly limit.",
    );
  }
  if (report.budget.renewal_period !== "monthly") {
    throw new NwcPolicyError("renewal", "The spending limit must renew monthly.");
  }
  const cap = capSats(contributionSats);
  if (total > cap * 1000) {
    throw new NwcPolicyError(
      "too-large",
      `This connection may spend ${Math.floor(total / 1000).toLocaleString("en")} sats a month. Rota asks for at most ${cap.toLocaleString("en")}.`,
    );
  }
  if (total < contributionSats * 1000) {
    throw new NwcPolicyError("too-small", "This connection's monthly limit is too small to pay one contribution.");
  }
}

/** Checks the wallet's pay_invoice answer: its preimage must match the invoice. */
export function checkNwcPayment(response: { preimage?: unknown; fees_paid?: unknown }, paymentHash: string): string {
  const preimage = typeof response.preimage === "string" ? response.preimage.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(preimage)) {
    throw new NwcPolicyError("proof", "Your wallet didn't return a proof of payment.");
  }
  if (bytesToHex(sha256(hexToBytes(preimage))) !== paymentHash.toLowerCase()) {
    throw new NwcPolicyError("proof", "Your wallet's proof of payment doesn't match the invoice.");
  }
  return preimage;
}
