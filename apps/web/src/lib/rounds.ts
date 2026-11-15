// A round of a circle, from the member's browser: read and check its receipts,
// and pay it. Client-only. The invoice is fetched and checked here, on the
// payer's phone; Rota's server never supplies or sees it.
import type { NWCClient } from "@getalby/sdk/nwc";
import {
  amountFor,
  createPriceSource,
  fetchInvoice,
  fetchPayParams,
  getRound,
  localToMsat,
  type Quote,
} from "@rota/circles";
import {
  AMOUNT_TOLERANCE,
  amountOutsideBand,
  createReceiptEvent,
  decodeInvite,
  fetchReceipts,
  publishEvent,
  roundView,
  type CircleView,
  type RoundView,
} from "@rota/records";
import { memberPubkey, memberSecret, relayUrl } from "./circles";
import { UiError, type MessageKey } from "./messages";

/** A signed Nostr event, as @rota/records publishes it. */
type Event = Parameters<typeof publishEvent>[1];

const PENDING_KEY = "rota.unsent.v1";

/** The BOLT11 network prefix this copy of Rota pays on: "bc" (mainnet) or "bcrt" (regtest). */
export function invoiceNetwork(): string {
  return process.env.NEXT_PUBLIC_BREEZ_NETWORK === "regtest" ? "bcrt" : "bc";
}

let priceSource: ReturnType<typeof createPriceSource> | null = null;

/** Today's price, cached for a minute. */
export function todaysQuote(): Promise<Quote> {
  priceSource ??= createPriceSource({ fetch: window.fetch.bind(window) });
  return priceSource.getQuote();
}

/** What the circle's contribution costs at today's price, or null if no price could be had. */
export async function marketMsatFor(view: CircleView): Promise<bigint | null> {
  try {
    return localToMsat(view.draft.contribution, view.draft.currency, await todaysQuote());
  } catch {
    return null;
  }
}

// ---------- receipts that haven't reached the relay yet ----------

/** Receipts this device made but couldn't publish. Kept so a paid round is never lost. */
export function unsentReceipts(): Event[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as Event[]).filter((e) => typeof e?.id === "string") : [];
  } catch {
    return [];
  }
}

function keepUnsent(event: Event): void {
  const others = unsentReceipts().filter((e) => e.id !== event.id);
  localStorage.setItem(PENDING_KEY, JSON.stringify([...others, event]));
}

function dropUnsent(id: string): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(unsentReceipts().filter((e) => e.id !== id)));
}

/** Tries again to publish every receipt this device still holds. */
export async function sendUnsent(): Promise<void> {
  for (const event of unsentReceipts()) {
    try {
      await publishEvent(relayUrl(), event);
      dropUnsent(event.id);
    } catch {
      // The relay is still unreachable; try again on the next refresh.
    }
  }
}

// ---------- reading a round ----------

/** Reads one round's receipts from the relay and checks each of them on this device. */
export async function loadRound(invite: string, view: CircleView, round: number): Promise<RoundView> {
  const decoded = decodeInvite(invite);
  if (!decoded || !view.circle) throw new UiError("err.notReady");
  const [events, marketMsat] = await Promise.all([
    fetchReceipts(relayUrl(), view.circlePubkey, { round }),
    marketMsatFor(view),
  ]);
  // Include this device's unsent receipts for this circle, so its own payment shows at once.
  const mine = unsentReceipts().filter((e) => e.tags.some((t) => t[0] === "p" && t[1] === view.circlePubkey));
  return roundView({
    view,
    circleSecret: decoded.circleSecret,
    round,
    events: [...events, ...mine],
    marketMsat,
    now: new Date(),
    network: invoiceNetwork(),
  });
}

// ---------- paying a round ----------

export type PayingWallet =
  | { kind: "built-in"; pin: string }
  | { kind: "nwc"; pin: string };

export interface PaidRound {
  amountMsat: bigint;
  feeSats: number;
  /** False when the receipt is saved on this device but hasn't reached the relay yet. */
  published: boolean;
}

/**
 * Pays this device's member's contribution for `round`, straight to the
 * round's recipient. Every step runs on this phone: fetch the recipient's pay
 * parameters, work out the sats (Tando's own rate for M-Pesa, today's price
 * otherwise), fetch the invoice, check it, pay it, then sign the receipt and
 * publish it. Nothing is paid unless every check passes.
 */
export async function payRound(options: {
  invite: string;
  view: CircleView;
  round: number;
  wallet: PayingWallet;
  onStep: (step: MessageKey) => void;
}): Promise<PaidRound> {
  const { invite, view, round, wallet, onStep } = options;
  const decoded = decodeInvite(invite);
  const circle = view.circle;
  if (!decoded || !circle || !view.sealed) throw new UiError("err.notSealed");

  const me = memberPubkey();
  const recipientId = getRound(circle, round).recipient.id;
  const recipient = view.members.find((m) => m.pubkey === recipientId);
  if (!recipient) throw new UiError("err.noRecipient");
  if (!view.members.some((m) => m.pubkey === me)) throw new UiError("err.notMember");
  if (me === recipientId) throw new UiError("err.youReceive");

  const fetcher = { fetch: window.fetch.bind(window) };
  const network = invoiceNetwork();
  const { currency, contribution } = view.draft;

  onStep("step.terms");
  const params = await fetchPayParams(recipient.payoutAddress, fetcher);
  onStep("step.sats");
  const quote = await todaysQuote();
  const amountMsat = amountFor(params, contribution, currency, quote);
  // The other members will check this payment against today's price: don't pay one they'd reject.
  const outside = amountOutsideBand(
    { amountMsat, local: { currency, amount: contribution } },
    { currency, contribution, marketMsat: localToMsat(contribution, currency, quote), tolerance: AMOUNT_TOLERANCE },
  );
  if (outside) throw new UiError("err.rateOff");

  onStep("step.invoice");
  const checked = await fetchInvoice(params, amountMsat, { ...fetcher, knownNodeKeys: recipient.knownNodeKeys, network });
  const approved = { invoice: checked.invoice, amountMsat, paymentHash: checked.decoded.paymentHash };

  let preimage: string;
  let feeSats: number;
  if (wallet.kind === "built-in") {
    onStep("step.unlock");
    // Loaded here so the circle page doesn't download the wallet unless someone pays.
    const { payInvoice, unlockWallet } = await import("./wallet");
    const sdk = await unlockWallet(wallet.pin);
    try {
      onStep("step.paying");
      ({ preimage, feeSats } = await payInvoice(sdk, approved));
    } finally {
      await sdk.disconnect().catch(() => undefined);
    }
  } else {
    onStep("step.connection");
    const { openConnection, payWithConnection } = await import("./nwc");
    const client: NWCClient = await openConnection(wallet.pin);
    try {
      onStep("step.paying");
      ({ preimage, feeSats } = await payWithConnection(client, approved));
    } finally {
      client.close();
    }
  }

  onStep("step.signing");
  const event = createReceiptEvent({
    memberSecret: memberSecret(),
    context: {
      circleSecret: decoded.circleSecret,
      round,
      recipient: { address: recipient.payoutAddress, knownNodeKeys: recipient.knownNodeKeys },
      expectedAmountMsat: amountMsat,
      network,
    },
    payment: {
      address: recipient.payoutAddress,
      metadata: params.metadata,
      invoice: checked.invoice,
      preimage,
      amountMsat,
      local: { currency, amount: contribution },
      paidAt: Math.floor(Date.now() / 1000),
    },
  });
  // Saved before publishing: if the relay is down, the receipt waits on this device.
  keepUnsent(event);
  onStep("step.publishing");
  try {
    await publishEvent(relayUrl(), event);
    dropUnsent(event.id);
    return { amountMsat, feeSats, published: true };
  } catch {
    return { amountMsat, feeSats, published: false };
  }
}
