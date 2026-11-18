"use client";

import { currentRound, getRound, roundCount, type PayerStatus } from "@rota/circles";
import type { CheckedReceipt, CircleView, Dispute, RoundView } from "@rota/records";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { loadRound, payRound, sendUnsent, settleRound, type PaidRound } from "@/lib/rounds";
import { walletsOnDevice } from "@/lib/storage-keys";
import { useT } from "@/lib/lang";
import type { MessageKey } from "@/lib/messages";
import { button, field, input, maskAddress, secondary } from "@/lib/ui";

const REFRESH_MS = 10_000;
const noSubscribe = () => () => {};

const CHECK_LABELS: Record<string, MessageKey> = {
  paid: "check.paid",
  address: "check.address",
  issuer: "check.issuer",
  amount: "check.amount",
};

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
  const { t, when } = useT();

  if (!circle) return null;
  if (!open || number === null) {
    return (
      <section aria-labelledby="round" className="space-y-2 rounded-xl border border-current/20 p-4">
        <h2 id="round" className="text-xl font-medium">
          {t("round.title", { n: 1 })}
        </h2>
        <p>{t("round.opens", { when: when(new Date(view.draft.schedule.startsAt)) })}</p>
      </section>
    );
  }

  return (
    <>
      {open.number > 1 && (
        <nav aria-label={t("round.nav")} className="flex flex-wrap gap-2">
          {Array.from({ length: open.number }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-current={n === number ? "true" : undefined}
              className={`min-h-12 min-w-12 rounded-lg border px-3 ${n === number ? "bg-foreground text-background" : "border-current/60"}`}
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
  const [error, setError] = useState<MessageKey | null>(null);
  const { t, when, num } = useT();

  const refresh = useCallback(async () => {
    try {
      await sendUnsent();
      setRound(await loadRound(invite, view, number));
      setError(null);
    } catch {
      setError("round.readError");
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

  if (!round) return <p role="status">{error ? t(error) : t("round.loading", { n: number })}</p>;

  const { status, recipient, disputed, notCounted, settledFor, disputes, receipts } = round;
  const names = new Map(view.members.map((m) => [m.pubkey, m.name]));
  const mine = status.payers.find((p) => p.member.id === me);
  const noPrice = receipts.some((r) => r.checks.some((c) => c.check === "amount" && /no price/.test(c.detail)));
  const { currency, contribution } = view.draft;
  const lateAfterOf = view.circle ? getRound(view.circle, number).lateAfter : new Date(NaN);

  return (
    <>
      <section aria-labelledby="round" className="space-y-3 rounded-xl border border-current/20 p-4">
        <h2 id="round" className="text-xl font-medium">
          {t("round.titleOf", { n: number, total })}
        </h2>
        <p className="leading-7">
          {t("round.pays")}
          <span className="font-medium">{recipient.name}</span>
          {recipient.pubkey === me && t("round.youSuffix")}
          {t("round.at", { address: maskAddress(recipient.payoutAddress) })}{" "}
          {status.state === "complete"
            ? t("round.complete")
            : t("round.progress", { paid: status.paidCount, total: status.payers.length, when: when(lateAfterOf) })}
        </p>
        <ul className="space-y-2">
          {status.payers.map((p) => (
            <li key={p.member.id} className="flex items-baseline justify-between gap-3">
              <span>
                {p.member.name}
                {p.member.id === me && t("circle.you")}
              </span>
              <StateBadge
                payer={p}
                disputed={disputed.has(p.member.id)}
                notCounted={notCounted.has(p.member.id)}
                settled={settledFor.has(p.member.id)}
              />
            </li>
          ))}
        </ul>
        {error && <p role="status">{t(error)}</p>}
        {noPrice && (
          <p role="status" className="text-sm">
            {t("round.noPrice")}
          </p>
        )}
      </section>

      {mine && mine.state !== "paid" && !disputed.has(mine.member.id) && (
        <Pay
          invite={invite}
          view={view}
          number={number}
          label={t("pay.title", { amount: num(contribution), currency, name: recipient.name })}
          onPaid={refresh}
        />
      )}

      {recipient.pubkey === me && disputes.length > 0 && (
        <Settle invite={invite} view={view} number={number} disputes={disputes} receipts={receipts} names={names} onSaved={refresh} />
      )}

      <Receipts receipts={receipts} />
    </>
  );
}

function StateBadge({
  payer,
  disputed,
  notCounted,
  settled,
}: {
  payer: PayerStatus;
  disputed: boolean;
  notCounted: boolean;
  settled: boolean;
}) {
  const { t, when } = useT();
  if (disputed) return <span className="font-medium">{t("state.disputed")}</span>;
  if (payer.state === "paid") {
    return (
      <span className="text-right">
        <span className="font-medium">{t("state.paid")}</span>
        {payer.onTime === false && t("state.paidLate")}
        {payer.paidAt && <span className="block text-sm opacity-70">{when(payer.paidAt)}</span>}
        {settled && <span className="block text-sm opacity-70">{t("state.settledNote")}</span>}
      </span>
    );
  }
  return (
    <span className="text-right">
      <span className={payer.state === "late" ? "font-medium" : "opacity-70"}>
        {t(payer.state === "late" ? "state.late" : "state.pending")}
      </span>
      {notCounted && <span className="block text-sm opacity-70">{t("state.notCounted")}</span>}
    </span>
  );
}

/** For the round's recipient only: say which member each disputed payment came from. */
function Settle({
  invite,
  view,
  number,
  disputes,
  receipts,
  names,
  onSaved,
}: {
  invite: string;
  view: CircleView;
  number: number;
  disputes: Dispute[];
  receipts: CheckedReceipt[];
  names: Map<string, string>;
  onSaved: () => Promise<void>;
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"saved" | "error" | null>(null);
  const { t, when, num } = useT();

  const pickFor = (d: Dispute) => picks[d.paymentHash] ?? d.settledFor;
  const settled = disputes.flatMap((d) => {
    const member = pickFor(d);
    return member ? [{ paymentHash: d.paymentHash, member }] : [];
  });
  const changed = disputes.some((d) => picks[d.paymentHash] !== undefined && picks[d.paymentHash] !== d.settledFor);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setState(null);
    try {
      await settleRound({ invite, view, round: number, settled });
      setPicks({});
      setState("saved");
      await onSaved();
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="settle" className="space-y-4 rounded-xl border border-current p-4">
      <h2 id="settle" className="text-xl font-medium">
        {t("settle.title")}
      </h2>
      <p className="leading-7">{t("settle.intro")}</p>
      {disputes.map((d) => {
        const first = [...receipts].reverse().find((r) => r.paymentHash === d.paymentHash && r.content);
        return (
          <fieldset key={d.paymentHash} className="space-y-2">
            <legend className="font-medium">
              {first?.content
                ? t("settle.payment", {
                    sats: t("common.sats", { n: num(first.content.amountMsat / 1000n) }),
                    when: when(new Date(first.content.paidAt * 1000)),
                  })
                : d.paymentHash.slice(0, 12)}
            </legend>
            {d.claimants.map((pubkey, i) => (
              <label key={pubkey} className="flex min-h-12 items-center gap-3">
                <input
                  type="radio"
                  className="size-5"
                  name={`settle-${d.paymentHash}`}
                  checked={pickFor(d) === pubkey}
                  onChange={() => setPicks({ ...picks, [d.paymentHash]: pubkey })}
                />
                <span>
                  {names.get(pubkey) ?? t("receipts.outsider")}
                  {i === 0 && t("settle.claimFirst")}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
      {state && (
        <p role={state === "error" ? "alert" : "status"} className={state === "error" ? "rounded-lg border border-current p-3" : ""}>
          {t(state === "saved" ? "settle.saved" : "settle.error")}
        </p>
      )}
      <button className={`${button} w-full`} disabled={busy || !changed}>
        {t(busy ? "settle.saving" : "settle.save")}
      </button>
    </form>
  );
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
  const [busy, setBusy] = useState<MessageKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PaidRound | null>(null);
  const { t, explain, num } = useT();

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
          {t("pay.done")}
        </h2>
        <p className="leading-7">
          {t("pay.doneText", { sats: t("common.sats", { n: num(done.amountMsat / 1000n) }), fee: num(done.feeSats) })}
          {t(done.published ? "pay.published" : "pay.unsent")}
        </p>
      </section>
    );
  }

  if (!view.sealed) {
    return (
      <p className="rounded-xl border border-current/20 p-4">
        {t("pay.waitSeats")}
      </p>
    );
  }

  if (!chosen) {
    return (
      <section aria-labelledby="pay" className="space-y-3 rounded-xl border border-current/20 p-4">
        <h2 id="pay" className="text-xl font-medium">
          {label}
        </h2>
        <p className="leading-7">{t("pay.setupFirst")}</p>
        <Link href="/wallet" className={`${button} inline-flex items-center`}>
          {t("pay.setupButton")}
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={submit} aria-labelledby="pay" className="space-y-4 rounded-xl border border-current/20 p-4">
      <h2 id="pay" className="text-xl font-medium">
        {label}
      </h2>
      <p className="leading-7 opacity-80">{t("pay.intro")}</p>
      {has.builtIn && has.nwc && (
        <fieldset className="space-y-2">
          <legend>{t("pay.from")}</legend>
          {(
            [
              ["built-in", "pay.builtIn"],
              ["nwc", "pay.nwc"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex min-h-12 items-center gap-3">
              <input type="radio" className="size-5" name="wallet" checked={chosen === value} onChange={() => setKind(value)} />
              {t(text)}
            </label>
          ))}
        </fieldset>
      )}
      <label className={field}>
        <span>{t("pay.pin")}</span>
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
        {t(busy ?? "common.pay")}
      </button>
    </form>
  );
}

function Receipts({ receipts }: { receipts: CheckedReceipt[] }) {
  const { t } = useT();
  if (receipts.length === 0) return null;
  return (
    <section aria-labelledby="receipts" className="space-y-3 rounded-xl border border-current/20 p-4">
      <h2 id="receipts" className="text-xl font-medium">
        {t("receipts.title")}
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
  const { t, when, num, detail } = useT();
  const who = receipt.member.name ?? t("receipts.outsider");
  const content = receipt.content;
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="font-medium">{who}</span>
          {content && (
            <span className="block text-sm opacity-70">
              {t("common.sats", { n: num(content.amountMsat / 1000n) })} · {when(new Date(content.paidAt * 1000))}
            </span>
          )}
        </span>
        <button type="button" className={secondary} aria-expanded={shown} onClick={() => setShown(!shown)}>
          {t(shown ? "receipts.hide" : "receipts.verify")}
        </button>
      </div>
      {shown && (
        <div className="space-y-2 rounded-lg border border-current/20 p-3">
          <p className="font-medium">{t(receipt.ok ? "receipts.allPass" : "receipts.fails")}</p>
          <ul className="space-y-1">
            {receipt.checks.map((c) => (
              <CheckLine
                key={c.check}
                ok={c.ok}
                label={CHECK_LABELS[c.check] ? t(CHECK_LABELS[c.check]) : c.check}
                detail={detail(c.detail) + (c.proof === "description" ? t("receipts.weaker") : "")}
              />
            ))}
            <CheckLine ok={receipt.member.ok} label={t("receipts.member")} detail={detail(receipt.member.detail)} />
          </ul>
          <p className="text-sm opacity-70">{t("receipts.local")}</p>
        </div>
      )}
    </li>
  );
}

function CheckLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const { t } = useT();
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="w-5 shrink-0 font-bold">
        {ok ? "✓" : "✗"}
      </span>
      <span>
        <span className="sr-only">{t(ok ? "receipts.passes" : "receipts.failsPrefix")}</span>
        {label}
        <span className="block text-sm opacity-70">{detail}</span>
      </span>
    </li>
  );
}
