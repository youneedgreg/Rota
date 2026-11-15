"use client";

import type { BreezSdk } from "@breeztech/breez-sdk-spark/ssr";
import { decodeInvoice } from "@rota/receipts";
import { generateWords, MIN_PIN_LENGTH, normalizeWords } from "@rota/wallet";
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
import { useT } from "@/lib/lang";
import { UiError } from "@/lib/messages";

type Step =
  | { name: "loading" }
  | { name: "start" }
  | { name: "backup"; words: string }
  | { name: "restore" }
  | { name: "pin"; words: string }
  | { name: "locked" }
  | { name: "open"; sdk: BreezSdk };

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
  const { t } = useT();

  return (
    <div className="space-y-4">
      {walletNetwork() === "regtest" && (
        <p className="rounded-lg bg-amber-100 p-3 text-amber-900">
          {t("wallet.regtest")}
        </p>
      )}
      {step.name === "loading" && <p>{t("common.loading")}</p>}
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
  const { t } = useT();
  return (
    <Card>
      <h2 className="text-xl font-medium">{t("wallet.setup")}</h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button className={button} onClick={() => onCreate(generateWords())}>
          {t("wallet.create")}
        </button>
        <button className={secondary} onClick={onRestore}>
          {t("wallet.haveWords")}
        </button>
      </div>
    </Card>
  );
}

function Backup({ words, onDone }: { words: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const { t } = useT();
  return (
    <Card>
      <h2 className="text-xl font-medium">{t("wallet.backupTitle")}</h2>
      <p className="leading-7">
        {t("wallet.backupText")}
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
        {t("wallet.written")}
      </label>
      <button className={button} disabled={!saved} onClick={onDone}>
        {t("common.continue")}
      </button>
    </Card>
  );
}

function Restore({ onDone, onBack }: { onDone: (words: string) => void; onBack: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { t, explain } = useT();
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
        <h2 className="text-xl font-medium">{t("wallet.restoreTitle")}</h2>
        <label className="block space-y-2">
          <span>{t("wallet.wordsLabel")}</span>
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
            {t("common.continue")}
          </button>
          <button type="button" className={secondary} onClick={onBack}>
            {t("common.back")}
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
  const { t, explain } = useT();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pin !== again) return setError(t("wallet.pinMismatch"));
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
        <h2 className="text-xl font-medium">{t("wallet.pinTitle")}</h2>
        <p className="leading-7">
          {t("wallet.pinText", { min: MIN_PIN_LENGTH })}
        </p>
        <label className="block space-y-2">
          <span>{t("common.pin")}</span>
          <input className={input} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="block space-y-2">
          <span>{t("wallet.pinAgain")}</span>
          <input className={input} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
        </label>
        <ErrorText text={error} />
        <button type="submit" className={button} disabled={busy}>
          {t(busy ? "wallet.locking" : "wallet.save")}
        </button>
      </form>
    </Card>
  );
}

function Unlock({ onOpen, onForget }: { onOpen: (sdk: BreezSdk) => void; onForget: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, explain } = useT();
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
    if (window.confirm(t("wallet.forgetConfirm"))) {
      forgetWallet();
      onForget();
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-medium">{t("wallet.unlockTitle")}</h2>
        <label className="block space-y-2">
          <span>{t("common.pin")}</span>
          <input className={input} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" />
        </label>
        <ErrorText text={error} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={button} disabled={busy}>
            {t(busy ? "common.unlocking" : "common.unlock")}
          </button>
          <button type="button" className={secondary} onClick={forget}>
            {t("wallet.forget")}
          </button>
        </div>
      </form>
    </Card>
  );
}

function OpenWallet({ sdk }: { sdk: BreezSdk }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, explain, num } = useT();

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
  }, [sdk, explain]);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-xl font-medium">{t("wallet.balance")}</h2>
        <p className="text-3xl font-semibold" aria-live="polite">
          {balance === null ? "…" : t("common.sats", { n: num(balance) })}
        </p>
        <ErrorText text={error} />
        <button className={secondary} onClick={refresh}>
          {t("common.refresh")}
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
  const { t, explain } = useT();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const amount = Number(sats);
    if (!Number.isInteger(amount) || amount < 1) return setError(t("wallet.wholeSats"));
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
        <h2 className="text-xl font-medium">{t("wallet.receive")}</h2>
        <label className="block space-y-2">
          <span>{t("wallet.amountSats")}</span>
          <input className={input} inputMode="numeric" value={sats} onChange={(e) => setSats(e.target.value)} />
        </label>
        <ErrorText text={error} />
        <button type="submit" className={button} disabled={busy}>
          {t(busy ? "wallet.creating" : "wallet.createInvoice")}
        </button>
      </form>
      {invoice && (
        <div className="space-y-2">
          <p className="break-all rounded-md border border-current/20 p-2 font-mono text-sm">{invoice}</p>
          <button className={secondary} onClick={() => navigator.clipboard.writeText(invoice)}>
            {t("wallet.copyInvoice")}
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
  const { t, explain, num } = useT();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const invoice = text.trim().replace(/^lightning:/i, "");
      const decoded = decodeInvoice(invoice);
      if (decoded.amountMsat === null) throw new UiError("wallet.noAmount");
      if (decoded.amountMsat % 1000n !== 0n) throw new UiError("wallet.fraction");
      const sats = decoded.amountMsat / 1000n;
      if (!window.confirm(t("wallet.confirmPay", { sats: num(sats) }))) return;
      setBusy(true);
      const paid = await payInvoice(sdk, { invoice, amountMsat: decoded.amountMsat, paymentHash: decoded.paymentHash });
      setResult(t("wallet.paidResult", { sats: num(sats), fee: num(paid.feeSats) }));
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
        <h2 className="text-xl font-medium">{t("wallet.payTitle")}</h2>
        <label className="block space-y-2">
          <span>{t("wallet.invoice")}</span>
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
          {t(busy ? "common.paying" : "common.pay")}
        </button>
      </form>
    </Card>
  );
}
