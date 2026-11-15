"use client";

import type { NWCClient } from "@getalby/sdk/nwc";
import { decodeInvoice } from "@rota/receipts";
import { capSats, MIN_PIN_LENGTH, type ConnectionReport } from "@rota/wallet";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import {
  connectionLimits,
  connectWithApprovalPage,
  connectWithString,
  DEFAULT_APPROVAL_PAGE,
  forgetConnection,
  openConnection,
  payWithConnection,
  savedConnection,
} from "@/lib/nwc";

const button = "min-h-12 rounded-lg bg-foreground px-4 font-medium text-background disabled:opacity-50";
const secondary = "min-h-12 rounded-lg border border-current px-4 font-medium disabled:opacity-50";
const input = "min-h-12 w-full rounded-lg border border-current/30 bg-transparent px-3";

function explain(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

function Limits({ limits }: { limits: ConnectionReport }) {
  const total = Math.floor((limits.budget.total_budget ?? 0) / 1000);
  const used = Math.floor((limits.budget.used_budget ?? 0) / 1000);
  return (
    <p className="leading-7">
      Can only pay. Monthly limit {total.toLocaleString()} sats, {used.toLocaleString()} used this month.
    </p>
  );
}

const noSubscribe = () => () => {};

export function NwcPanel() {
  const hasConnection = useSyncExternalStore(noSubscribe, () => savedConnection() !== null, () => null);
  const [state, setState] = useState<"connect" | "locked" | null>(null);
  const [client, setClient] = useState<NWCClient | null>(null);
  const view = client ? "open" : (state ?? (hasConnection === null ? "loading" : hasConnection ? "locked" : "connect"));

  return (
    <section className="space-y-4 rounded-xl border border-current/20 p-4">
      <h2 className="text-xl font-medium">Your own wallet</h2>
      <p className="leading-7 opacity-80">
        Connect a wallet you already use (Nostr Wallet Connect). Rota asks for a connection that can only pay, up to one
        contribution plus 25% a month, and refuses anything wider. Your wallet enforces the limit, not Rota.
      </p>
      {view === "loading" && <p>Loading…</p>}
      {view === "connect" && <Connect onSaved={() => setState("locked")} />}
      {view === "locked" && (
        <Unlock
          onOpen={setClient}
          onForget={() => {
            forgetConnection();
            setState("connect");
          }}
        />
      )}
      {view === "open" && client && (
        <Connected
          client={client}
          onClose={() => {
            client.close();
            setClient(null);
            setState("locked");
          }}
        />
      )}
    </section>
  );
}

function Connect({ onSaved }: { onSaved: () => void }) {
  // Until circles drive this, the member types the contribution and the cycle's end.
  const [sats, setSats] = useState("");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState(DEFAULT_APPROVAL_PAGE);
  const [connection, setConnection] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const contribution = Number(sats);
  const validAmount = Number.isInteger(contribution) && contribution > 0;

  async function run(how: "page" | "paste", e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!validAmount) return setError("Enter the contribution in whole sats.");
    if (pin.length < MIN_PIN_LENGTH) return setError(`Choose a PIN of at least ${MIN_PIN_LENGTH} characters.`);
    setBusy(true);
    try {
      if (how === "page") {
        const expiresAt = new Date(`${until}T23:59:59`);
        if (!until || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
          throw new Error("Choose the date the cycle ends; the connection expires then.");
        }
        await connectWithApprovalPage({ approvalPage: page, contributionSats: contribution, expiresAt, pin });
      } else {
        await connectWithString({ connection, contributionSats: contribution, pin });
      }
      setConnection("");
      onSaved();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => run("paste", e)} className="space-y-4">
      <label className="block space-y-2">
        <span>Contribution in sats</span>
        <input className={input} inputMode="numeric" value={sats} onChange={(e) => setSats(e.target.value)} />
      </label>
      {validAmount && <p className="opacity-80">Monthly limit Rota will ask for: {capSats(contribution).toLocaleString()} sats.</p>}
      <label className="block space-y-2">
        <span>PIN to lock this connection on this device</span>
        <input className={input} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" />
      </label>
      <fieldset className="space-y-3 rounded-lg border border-current/20 p-3">
        <legend className="px-1 font-medium">Alby Hub</legend>
        <label className="block space-y-2">
          <span>Cycle ends on</span>
          <input className={input} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <label className="block space-y-2">
          <span>Your Hub&apos;s approval page</span>
          <input className={input} value={page} onChange={(e) => setPage(e.target.value)} autoCapitalize="none" spellCheck={false} />
        </label>
        <button type="button" className={button} disabled={busy} onClick={() => run("page")}>
          {busy ? "Waiting for your wallet…" : "Connect Alby Hub"}
        </button>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border border-current/20 p-3">
        <legend className="px-1 font-medium">Any other wallet</legend>
        <p className="opacity-80">
          In your wallet, create a connection that can only pay, with a monthly limit of the amount above, then paste it here.
        </p>
        <label className="block space-y-2">
          <span>Wallet connection</span>
          <textarea
            className={`${input} min-h-24 py-2 font-mono text-sm`}
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <button type="submit" className={secondary} disabled={busy || !connection.trim()}>
          Check and save
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

function Unlock({ onOpen, onForget }: { onOpen: (client: NWCClient) => void; onForget: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onOpen(await openConnection(pin));
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p>A wallet is connected on this device.</p>
      <label className="block space-y-2">
        <span>PIN</span>
        <input className={input} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" />
      </label>
      {error && (
        <p role="alert" className="font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={button} disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        <button
          type="button"
          className={secondary}
          onClick={() => window.confirm("Remove this connection from this device? Also revoke it in your wallet.") && onForget()}
        >
          Remove connection
        </button>
      </div>
    </form>
  );
}

function Connected({ client, onClose }: { client: NWCClient; onClose: () => void }) {
  const [limits, setLimits] = useState<ConnectionReport | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setError(null);
    try {
      setLimits(await connectionLimits(client));
    } catch (err) {
      setError(explain(err));
    }
  }

  async function pay(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const invoice = text.trim().replace(/^lightning:/i, "");
      const decoded = decodeInvoice(invoice);
      if (decoded.amountMsat === null) throw new Error("This invoice has no amount. Ask for one with an amount.");
      const sats = decoded.amountMsat / 1000n;
      if (!window.confirm(`Pay ${sats.toLocaleString()} sats from your own wallet?`)) return;
      setBusy(true);
      const paid = await payWithConnection(client, {
        invoice,
        amountMsat: decoded.amountMsat,
        paymentHash: decoded.paymentHash,
      });
      setResult(`Paid ${sats.toLocaleString()} sats (fee ${paid.feeSats} sats). Proof of payment received.`);
      setText("");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {limits ? <Limits limits={limits} /> : <p>Connected.</p>}
      <div className="flex flex-wrap gap-3">
        <button className={secondary} onClick={check}>
          Check limits
        </button>
        <button className={secondary} onClick={onClose}>
          Lock
        </button>
      </div>
      <form onSubmit={pay} className="space-y-4">
        <label className="block space-y-2">
          <span>Lightning invoice to pay</span>
          <textarea
            className={`${input} min-h-24 py-2 font-mono text-sm`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        {error && (
          <p role="alert" className="font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        {result && (
          <p role="status" className="font-medium text-green-800 dark:text-green-400">
            {result}
          </p>
        )}
        <button type="submit" className={button} disabled={busy || !text.trim()}>
          {busy ? "Paying…" : "Pay from my wallet"}
        </button>
      </form>
    </div>
  );
}
