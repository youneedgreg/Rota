"use client";

import { currentRound, getRound, roundCount, type PayerStatus } from "@rota/circles";
import type { CheckedReceipt, CircleView, RoundView } from "@rota/records";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { loadRound, payRound, sendUnsent, type PaidRound } from "@/lib/rounds";
import { walletsOnDevice } from "@/lib/storage-keys";
import { button, explain, field, input, maskAddress, secondary } from "@/lib/ui";

const REFRESH_MS = 10_000;
const noSubscribe = () => () => {};

const CHECK_LABELS: Record<string, string> = {
  paid: "It was paid",
  address: "To the round's recipient",
  issuer: "Invoice from the recipient's own service",
  amount: "The contribution, on this network",
};

function when(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function sats(msat: bigint): string {
  return `${(Number(msat / 1000n)).toLocaleString()} sats`;
}

/** The round open now, ticking over on its own when the next one opens. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function RoundPanel({ invite, view, me }: { invite: string; view: CircleView; me: string | null }) {
  const circle = view.circle;
  const now = useNow();
  const open = circle ? currentRound(circle, now) : null;
  const [picked, setPicked] = useState<number | null>(null);
  const number = picked ?? open?.number ?? null;

  if (!circle) return null;
  if (!open || number === null) {
    return (
      <section aria-labelledby="round" className="space-y-2 rounded-xl border border-current/20 p-4">
        <h2 id="round" className="text-xl font-medium">
          Round 1
        </h2>
        <p>Opens {when(new Date(view.draft.schedule.startsAt))}.</p>
      </section>
    );
  }

  return (
    <>
      {open.number > 1 && (
        <nav aria-label="Rounds" className="flex flex-wrap gap-2">
          {Array.from({ length: open.number }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-current={n === number ? "true" : undefined}
              className={`min-h-12 min-w-12 rounded-lg border px-3 ${n === number ? "bg-foreground text-background" : "border-current/40"}`}
              onClick={() => setPicked(n === open.number ? null : n)}
            >
              {n}
            </button>
          ))}
        </nav>
      )}
      <Round key={number} invite={invite} view={view} me={me} number={number} total={roundCount(circle)} />
    </>
  );
}

function Round({
  invite,
  view,
  me,
  number,
  total,
}: {
  invite: string;
  view: CircleView;
  me: string | null;
  number: number;
  total: number;
}) {
  const [round, setRound] = useState<RoundView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await sendUnsent();
      setRound(await loadRound(invite, view, number));
      setError(null);
    } catch {
      setError("Rota couldn't read this round's receipts. It will keep trying.");
    }
  }, [invite, view, number]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  if (!round) return <p role="status">{error ?? `Checking round ${number}'s receipts…`}</p>;

  const { status, recipient, disputed, receipts } = round;
  const mine = status.payers.find((p) => p.member.id === me);
  const noPrice = receipts.some((r) => r.checks.some((c) => c.check === "amount" && /no price/.test(c.detail)));
  const { currency, contribution } = view.draft;
  const lateAfterOf = view.circle ? getRound(view.circle, number).lateAfter : new Date(NaN);

  return (
    <>
      <section aria-labelledby="round" className="space-y-3 rounded-xl border border-current/20 p-4">
        <h2 id="round" className="text-xl font-medium">
          Round {number} of {total}
        </h2>
        <p className="leading-7">
          Pays <span className="font-medium">{recipient.name}</span>
          {recipient.pubkey === me && " (you)"} at {maskAddress(recipient.payoutAddress)}.{" "}
          {status.state === "complete"
            ? "Everyone has paid."
            : `${status.paidCount} of ${status.payers.length} paid. Late after ${when(lateAfterOf)}.`}
        </p>
        <ul className="space-y-2">
          {status.payers.map((p) => (
            <li key={p.member.id} className="flex items-baseline justify-between gap-3">
              <span>
                {p.member.name}
                {p.member.id === me && " · you"}
              </span>
              <StateBadge payer={p} disputed={disputed.has(p.member.id)} />
            </li>
          ))}
        </ul>
        {error && <p role="status">{error}</p>}
        {noPrice && (
          <p role="status" className="text-sm">
            Rota couldn&apos;t get today&apos;s bitcoin price, so it can&apos;t check amounts right now. Payments
            show as pending until it can.
          </p>
        )}
      </section>

      {mine && mine.state !== "paid" && !disputed.has(mine.member.id) && (
        <Pay
          invite={invite}
          view={view}
          number={number}
          label={`${contribution.toLocaleString()} ${currency} to ${recipient.name}`}
          onPaid={refresh}
        />
      )}

      <Receipts receipts={receipts} />
    </>
  );
}

function StateBadge({ payer, disputed }: { payer: PayerStatus; disputed: boolean }) {
  if (disputed) return <span className="font-medium">Disputed</span>;
  if (payer.state === "paid") {
    return (
      <span className="text-right">
        <span className="font-medium">Paid</span>
        {payer.onTime === false && " late"}
        {payer.paidAt && <span className="block text-sm opacity-70">{when(payer.paidAt)}</span>}
      </span>
    );
  }
  return <span className={payer.state === "late" ? "font-medium" : "opacity-70"}>{payer.state === "late" ? "Late" : "Pending"}</span>;
}

function Pay({
  invite,
  view,
  number,
  label,
  onPaid,
}: {
  invite: string;
  view: CircleView;
  number: number;
  label: string;
  onPaid: () => Promise<void>;
}) {
  const wallets = useSyncExternalStore(noSubscribe, () => JSON.stringify(walletsOnDevice()), () => null);
  const has = wallets ? (JSON.parse(wallets) as { builtIn: boolean; nwc: boolean }) : null;
  const [kind, setKind] = useState<"built-in" | "nwc" | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PaidRound | null>(null);

  if (!has) return null;
  const chosen = kind ?? (has.builtIn ? "built-in" : has.nwc ? "nwc" : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setError(null);
    try {
      const paid = await payRound({ invite, view, round: number, wallet: { kind: chosen, pin }, onStep: setBusy });
      setPin("");
      setDone(paid);
      await onPaid();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <section aria-labelledby="pay" className="space-y-2 rounded-xl border border-current p-4">
        <h2 id="pay" className="text-xl font-medium">
          Paid
        </h2>
        <p className="leading-7">
          You paid {sats(done.amountMsat)} plus {done.feeSats.toLocaleString()} sats in fees, straight to the recipient.
          {done.published
            ? " Your signed receipt is on the circle's relay."
            : " Your receipt is saved on this phone and will reach the relay when it's back."}
        </p>
      </section>
    );
  }

  if (!view.sealed) {
    return (
      <p className="rounded-xl border border-current/20 p-4">
        You can pay once the organizer&apos;s app confirms the seats.
      </p>
    );
  }

  if (!chosen) {
    return (
      <section aria-labelledby="pay" className="space-y-3 rounded-xl border border-current/20 p-4">
        <h2 id="pay" className="text-xl font-medium">
          Pay {label}
        </h2>
        <p className="leading-7">
          Set up a wallet first: Rota&apos;s built-in one, or connect your own with a monthly limit.
        </p>
        <Link href="/wallet" className={`${button} inline-flex items-center`}>
          Set up a wallet
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={submit} aria-labelledby="pay" className="space-y-4 rounded-xl border border-current/20 p-4">
      <h2 id="pay" className="text-xl font-medium">
        Pay {label}
      </h2>
      <p className="leading-7 opacity-80">
        Your phone fetches the recipient&apos;s invoice, checks it, and pays it directly. Rota never holds the money.
      </p>
      {has.builtIn && has.nwc && (
        <fieldset className="space-y-2">
          <legend>Pay from</legend>
          {(
            [
              ["built-in", "Rota's built-in wallet"],
              ["nwc", "Your own wallet (connected)"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex min-h-12 items-center gap-3">
              <input type="radio" name="wallet" checked={chosen === value} onChange={() => setKind(value)} />
              {text}
            </label>
          ))}
        </fieldset>
      )}
      <label className={field}>
        <span>Your wallet PIN</span>
        <input
          className={input}
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-current p-3">
          {error}
        </p>
      )}
      <button className={`${button} w-full`} disabled={busy !== null}>
        {busy ?? "Pay"}
      </button>
    </form>
  );
}

function Receipts({ receipts }: { receipts: CheckedReceipt[] }) {
  if (receipts.length === 0) return null;
  return (
    <section aria-labelledby="receipts" className="space-y-3 rounded-xl border border-current/20 p-4">
      <h2 id="receipts" className="text-xl font-medium">
        Receipts
      </h2>
      <ul className="space-y-3">
        {receipts.map((r) => (
          <ReceiptRow key={r.eventId} receipt={r} />
        ))}
      </ul>
    </section>
  );
}

function ReceiptRow({ receipt }: { receipt: CheckedReceipt }) {
  const [shown, setShown] = useState(false);
  const who = receipt.member.name ?? "Someone outside the circle";
  const content = receipt.content;
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="font-medium">{who}</span>
          {content && (
            <span className="block text-sm opacity-70">
              {sats(content.amountMsat)} · {when(new Date(content.paidAt * 1000))}
            </span>
          )}
        </span>
        <button type="button" className={secondary} aria-expanded={shown} onClick={() => setShown(!shown)}>
          {shown ? "Hide" : "Verify"}
        </button>
      </div>
      {shown && (
        <div className="space-y-2 rounded-lg border border-current/20 p-3">
          <p className="font-medium">{receipt.ok ? "All checks pass" : "This receipt fails a check"}</p>
          <ul className="space-y-1">
            {receipt.checks.map((c) => (
              <CheckLine key={c.check} ok={c.ok} label={CHECK_LABELS[c.check] ?? c.check} detail={proofNote(c.detail, c.proof)} />
            ))}
            <CheckLine ok={receipt.member.ok} label="Signed by this member" detail={receipt.member.detail} />
          </ul>
          <p className="text-sm opacity-70">Checked on this phone, from the circle&apos;s own record. Rota&apos;s server isn&apos;t asked.</p>
        </div>
      )}
    </li>
  );
}

function proofNote(detail: string, proof?: string): string {
  return proof === "description" ? `${detail} (weaker proof: this service signs a description, not a hash)` : detail;
}

function CheckLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="w-5 shrink-0 font-bold">
        {ok ? "✓" : "✗"}
      </span>
      <span>
        <span className="sr-only">{ok ? "Passes: " : "Fails: "}</span>
        {label}
        <span className="block text-sm opacity-70">{detail}</span>
      </span>
    </li>
  );
}
