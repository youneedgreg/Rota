// A member's own wallet, connected through Nostr Wallet Connect (NIP-47).
// Client-only. The connection string can spend up to its monthly budget, so
// it's kept on this device encrypted with the member's PIN, like the
// built-in wallet's words. Rota's server never sees it.
import { NWCClient } from "@getalby/sdk/nwc";
import {
  checkConnection,
  checkNwcPayment,
  connectionRequest,
  openSecret,
  parseSealed,
  sealSecret,
  type ConnectionReport,
  type SealedWords,
} from "@rota/wallet";

const STORAGE_KEY = "rota.nwc.v1";

/** Alby Hub's approval page for new connections; a self-hosted Hub uses its own address. */
export const DEFAULT_APPROVAL_PAGE = "https://my.albyhub.com/apps/new";

export function savedConnection(): SealedWords | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseSealed(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function forgetConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function report(client: NWCClient): Promise<ConnectionReport> {
  const [info, budget] = await Promise.all([client.getInfo(), client.getBudget()]);
  return { methods: info.methods, budget: budget as ConnectionReport["budget"] };
}

/**
 * Checks a connection against Rota's rules and saves it sealed with the PIN.
 * A connection that fails the rules is closed and never saved.
 */
async function acceptAndSave(client: NWCClient, contributionSats: number, pin: string): Promise<ConnectionReport> {
  try {
    const checked = await report(client);
    checkConnection(checked, contributionSats);
    const sealed = await sealSecret(client.getNostrWalletConnectUrl(true), pin);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sealed));
    return checked;
  } finally {
    client.close();
  }
}

/**
 * Opens the wallet's approval page with Rota's limits filled in (pay only,
 * a monthly budget of 1.25 contributions, expiring at the cycle's end) and
 * waits for the member to approve it there.
 */
export async function connectWithApprovalPage(options: {
  approvalPage: string;
  contributionSats: number;
  expiresAt: Date;
  pin: string;
}): Promise<ConnectionReport> {
  const url = new URL(options.approvalPage);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("The wallet's approval page must use HTTPS.");
  }
  const client = await NWCClient.fromAuthorizationUrl(
    url.toString(),
    connectionRequest({ contributionSats: options.contributionSats, expiresAt: options.expiresAt }),
  );
  return acceptAndSave(client, options.contributionSats, options.pin);
}

/** For any NWC wallet: the member made a connection with Rota's limits and pasted it. */
export async function connectWithString(options: {
  connection: string;
  contributionSats: number;
  pin: string;
}): Promise<ConnectionReport> {
  const text = options.connection.trim();
  if (!text.startsWith("nostr+walletconnect://")) {
    throw new Error("That isn't a wallet connection. It starts with nostr+walletconnect://");
  }
  let client: NWCClient;
  try {
    client = new NWCClient({ nostrWalletConnectUrl: text, requireSecret: true });
  } catch {
    throw new Error("That wallet connection couldn't be read. Copy it again from your wallet.");
  }
  return acceptAndSave(client, options.contributionSats, options.pin);
}

/** Unlocks the saved connection with the PIN. Close it when done. */
export async function openConnection(pin: string): Promise<NWCClient> {
  const sealed = savedConnection();
  if (!sealed) throw new Error("No wallet is connected on this device.");
  return new NWCClient({ nostrWalletConnectUrl: await openSecret(sealed, pin), requireSecret: true });
}

/** The connection's current limits, as its wallet reports them. */
export async function connectionLimits(client: NWCClient): Promise<ConnectionReport> {
  return report(client);
}

/**
 * Pays an invoice that Rota's invoice check already approved. The wallet
 * enforces the monthly budget; Rota checks the preimage it returns.
 */
export async function payWithConnection(
  client: NWCClient,
  approved: { invoice: string; amountMsat: bigint; paymentHash: string },
): Promise<{ preimage: string; feeSats: number }> {
  const response = await client.payInvoice({ invoice: approved.invoice });
  const preimage = checkNwcPayment(response, approved.paymentHash);
  // NIP-47 reports fees in msat.
  return { preimage, feeSats: Math.ceil((response.fees_paid ?? 0) / 1000) };
}
