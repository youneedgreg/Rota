"use client";

import type { BreezSdk } from "@breeztech/breez-sdk-spark/ssr";
import { decodeInvoice, InvoiceError } from "@rota/receipts";
import { generateWords, MIN_PIN_LENGTH, normalizeWords, VaultError } from "@rota/wallet";
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import {
  balanceSats,
  forgetWallet,
  payInvoice,
  receiveInvoice,
  savedWallet,
  saveWallet,
  unlockWallet,
  walletNetwork,
} from "@/lib/wallet";

type Step =
  | { name: "loading" }
  | { name: "start" }
  | { name: "backup"; words: string }
  | { name: "restore" }
  | { name: "pin"; words: string }
  | { name: "locked" }
  | { name: "open"; sdk: BreezSdk };

/** Plain-language text for any error, without stack traces or internals. */
function explain(error: unknown): string {
  if (error instanceof VaultError || error instanceof InvoiceError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

const button =
  "min-h-12 rounded-lg bg-foreground px-4 font-medium text-background disabled:opacity-50";
const secondary = "min-h-12 rounded-lg border border-current px-4 font-medium disabled:opacity-50";
const input = "min-h-12 w-full rounded-lg border border-current/30 bg-transparent px-3";

function Card({ children }: { children: ReactNode }) {
  return <section className="space-y-4 rounded-xl border border-current/20 p-4">{children}</section>;
}

function ErrorText({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="font-medium text-red-700 dark:text-red-400">
      {text}
    </p>
  ) : null;
}

// Browser storage doesn't change behind our back; nothing to subscribe to.
const noSubscribe = () => () => {};

export function WalletPanel() {
  // null on the server (no storage there), then whether this device has a wallet.
  const hasWallet = useSyncExternalStore(noSubscribe, () => savedWallet() !== null, () => null);
  const [chosen, setStep] = useState<Step | null>(null);
  const step: Step = chosen ?? (hasWallet === null ? { name: "loading" } : hasWallet ? { name: "locked" } : { name: "start" });

  return (
    <div className="space-y-4">
      {walletNetwork() === "regtest" && (
        <p className="rounded-lg bg-amber-100 p-3 text-amber-900">
          Test network: these coins have no value, and Lightning payments don&apos;t work here.
        </p>
      )}
      {step.name === "loading" && <p>Loading…</p>}
      {step.name === "start" && <Start onCreate={(words) => setStep({ name: "backup", words })} onRestore={() => setStep({ name: "restore" })} />}
      {step.name === "backup" && <Backup words={step.words} onDone={() => setStep({ name: "pin", words: step.words })} />}
      {step.name === "restore" && <Restore onDone={(words) => setStep({ name: "pin", words })} onBack={() => setStep({ name: "start" })} />}
      {step.name === "pin" && <ChoosePin words={step.words} onDone={() => setStep({ name: "locked" })} />}
      {step.name === "locked" && <Unlock onOpen={(sdk) => setStep({ name: "open", sdk })} onForget={() => setStep({ name: "start" })} />}
      {step.name === "open" && <OpenWallet sdk={step.sdk} />}
    </div>
  );
}

function Start({ onCreate, onRestore }: { onCreate: (words: string) => void; onRestore: () => void }) {
  return (
    <Card>
      <h2 className="text-xl font-medium">Set up your wallet</h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button className={button} onClick={() => onCreate(generateWords())}>
          Create a new wallet
        </button>
        <button className={secondary} onClick={onRestore}>
          I have recovery words
        </button>
      </div>
    </Card>
  );
}

function Backup({ words, onDone }: { words: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <h2 className="text-xl font-medium">Write down these 12 words</h2>
      <p className="leading-7">
        They are the only way to get your money back if you lose this phone. Write them on paper, in order. Never type
        them into a chat or a website, and never share them. Rota will never ask for them.
      </p>
      <ol className="grid grid-cols-2 gap-2 font-mono sm:grid-cols-3">
        {words.split(" ").map((word, i) => (
          <li key={i} className="rounded-md border border-current/20 px-2 py-1">
            <span className="opacity-60">{i + 1}.</span> {word}
          </li>
        ))}
      </ol>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className="size-5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I have written them down
      </label>
      <button className={button} disabled={!saved} onClick={onDone}>
        Continue
      </button>
    </Card>
  );
}

function Restore({ onDone, onBack }: { onDone: (words: string) => void; onBack: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      onDone(normalizeWords(text));
    } catch (err) {
      setError(explain(err));
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-medium">Restore your wallet</h2>
        <label className="block space-y-2">
          <span>Your 12 recovery words, in order</span>
          <textarea
            className={`${input} min-h-28 py-2 font-mono`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <ErrorText text={error} />
        <div className="flex gap-3">
          <button type="submit" className={button}>
            Continue
          </button>
          <button type="button" className={secondary} onClick={onBack}>
            Back
          </button>
        </div>
      </form>
    </Card>
  );
}

function ChoosePin({ words, onDone }: { words: string; onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pin !== again) return setError("The two PINs don't match.");
    setBusy(true);
    setError(null);
    try {
      await saveWallet(words, pin);
      onDone();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-medium">Choose a PIN</h2>
        <p className="leading-7">
          Your recovery words are saved on this device, locked with this PIN. At least {MIN_PIN_LENGTH} characters;
          longer is safer.
        </p>
        <label className="block space-y-2">
          <span>PIN</span>
          <input className={input} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="block space-y-2">
          <span>PIN again</span>
          <input className={input} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
        </label>
        <ErrorText text={error} />
        <button type="submit" className={button} disabled={busy}>
          {busy ? "Locking…" : "Save wallet"}
        </button>
      </form>
    </Card>
  );
}

function Unlock({ onOpen, onForget }: { onOpen: (sdk: BreezSdk) => void; onForget: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onOpen(await unlockWallet(pin));
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  function forget() {
    if (window.confirm("Remove this wallet from this device? You'll need your 12 recovery words to get it back.")) {
      forgetWallet();
      onForget();
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-medium">Unlock your wallet</h2>
        <label className="block space-y-2">
          <span>PIN</span>
          <input className={input} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" />
        </label>
        <ErrorText text={error} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={button} disabled={busy}>
            {busy ? "Unlocking…" : "Unlock"}
          </button>
          <button type="button" className={secondary} onClick={forget}>
            Remove from this device
          </button>
        </div>
      </form>
    </Card>
  );
}

function OpenWallet({ sdk }: { sdk: BreezSdk }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setBalance(await balanceSats(sdk));
      setError(null);
    } catch (err) {
      setError(explain(err));
    }
  }

  useEffect(() => {
    let live = true;
    balanceSats(sdk)
      .then((sats) => live && setBalance(sats))
      .catch((err: unknown) => live && setError(explain(err)));
    return () => {
      live = false;
    };
  }, [sdk]);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-xl font-medium">Balance</h2>
        <p className="text-3xl font-semibold" aria-live="polite">
          {balance === null ? "…" : `${balance.toLocaleString()} sats`}
        </p>
        <ErrorText text={error} />
        <button className={secondary} onClick={refresh}>
          Refresh
        </button>
      </Card>
      <Receive sdk={sdk} />
      <Pay sdk={sdk} onPaid={refresh} />
    </div>
  );
}

function Receive({ sdk }: { sdk: BreezSdk }) {
  const [sats, setSats] = useState("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const amount = Number(sats);
    if (!Number.isInteger(amount) || amount < 1) return setError("Enter a whole number of sats.");
    setBusy(true);
    setError(null);
    try {
      setInvoice(await receiveInvoice(sdk, amount, "Rota wallet"));
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-medium">Receive</h2>
        <label className="block space-y-2">
          <span>Amount in sats</span>
          <input className={input} inputMode="numeric" value={sats} onChange={(e) => setSats(e.target.value)} />
        </label>
        <ErrorText text={error} />
        <button type="submit" className={button} disabled={busy}>
          {busy ? "Creating…" : "Create invoice"}
        </button>
      </form>
      {invoice && (
        <div className="space-y-2">
          <p className="break-all rounded-md border border-current/20 p-2 font-mono text-sm">{invoice}</p>
          <button className={secondary} onClick={() => navigator.clipboard.writeText(invoice)}>
            Copy invoice
          </button>
        </div>
      )}
    </Card>
  );
}

function Pay({ sdk, onPaid }: { sdk: BreezSdk; onPaid: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const invoice = text.trim().replace(/^lightning:/i, "");
      const decoded = decodeInvoice(invoice);
      if (decoded.amountMsat === null) throw new Error("This invoice has no amount. Ask for one with an amount.");
      if (decoded.amountMsat % 1000n !== 0n) throw new Error("This invoice asks for a fraction of a sat.");
      const sats = decoded.amountMsat / 1000n;
      if (!window.confirm(`Pay ${sats.toLocaleString()} sats?`)) return;
      setBusy(true);
      const paid = await payInvoice(sdk, { invoice, amountMsat: decoded.amountMsat, paymentHash: decoded.paymentHash });
      setResult(`Paid ${sats.toLocaleString()} sats (fee ${paid.feeSats} sats). Proof of payment received.`);
      setText("");
      onPaid();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-medium">Pay an invoice</h2>
        <label className="block space-y-2">
          <span>Lightning invoice</span>
          <textarea
            className={`${input} min-h-24 py-2 font-mono text-sm`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <ErrorText text={error} />
        {result && (
          <p role="status" className="font-medium text-green-800 dark:text-green-400">
            {result}
          </p>
        )}
        <button type="submit" className={button} disabled={busy || !text.trim()}>
          {busy ? "Paying…" : "Pay"}
        </button>
      </form>
    </Card>
  );
}
