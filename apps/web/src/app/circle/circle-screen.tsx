"use client";

import type { CircleView } from "@rota/records";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { inviteUrl, joinCircle, loadCircle, memberPubkey, profileFor, rememberCircle, sealCircle } from "@/lib/circles";
import { useT } from "@/lib/lang";
import type { MessageKey } from "@/lib/messages";
import { button, field, input, maskAddress, secondary } from "@/lib/ui";
import { RoundPanel } from "./round-panel";

const REFRESH_MS = 10_000;

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function paceText(view: CircleView, { t, when }: Pick<ReturnType<typeof useT>, "t" | "when">): string {
  const s = view.draft.schedule;
  const start = when(new Date(s.startsAt));
  if (s.kind === "demo") return t("circle.pace.demo", { minutes: s.roundMinutes, when: start });
  return t(s.kind === "weekly" ? "circle.pace.weekly" : "circle.pace.monthly", { when: start });
}

export function CircleScreen() {
  const invite = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => null);
  const me = useSyncExternalStore(subscribeHash, memberPubkey, () => null);
  const [view, setView] = useState<CircleView | null | undefined>(undefined);
  const [error, setError] = useState<MessageKey | null>(null);
  const tools = useT();
  const { t, num } = tools;

  const refresh = useCallback(async () => {
    if (!invite) return;
    try {
      const next = await loadCircle(invite);
      setView(next);
      setError(null);
      if (next) {
        rememberCircle(invite, next.draft.name);
        await sealCircle(invite, next);
      }
    } catch {
      setError("circle.relayError");
    }
  }, [invite]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  if (invite === null) return <p>{t("common.loading")}</p>;
  if (!invite) {
    return (
      <p>
        {t("circle.openFromLink")}
        <Link className="underline" href="/circles/new">
          {t("circle.startOne")}
        </Link>
        .
      </p>
    );
  }
  if (view === undefined) return <p>{t(error ?? "circle.loading")}</p>;
  if (view === null) {
    return <p role="alert">{t("circle.badInvite")}</p>;
  }

  const isMember = view.members.some((m) => m.pubkey === me);
  const { draft } = view;

  return (
    <>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{draft.name}</h1>
        <p className="leading-7">
          {t("circle.contribution", { amount: num(draft.contribution), currency: draft.currency })} {paceText(view, tools)}.
        </p>
      </header>

      {error && <p role="status">{t(error)}</p>}

      {view.full && <RoundPanel invite={invite} view={view} me={me} />}

      <section aria-labelledby="seats" className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <h2 id="seats" className="text-xl font-medium">
          {t("circle.seats", { taken: view.members.length, total: draft.seats })}
        </h2>
        <ol className="list-decimal space-y-2 pl-6">
          {view.members.map((m) => (
            <li key={m.pubkey}>
              <span className="font-medium">{m.name}</span>
              {m.pubkey === view.organizer && t("circle.organizer")}
              {m.pubkey === me && t("circle.you")}
              <span className="block text-sm text-muted">{t("circle.paidAt", { address: maskAddress(m.payoutAddress) })}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">
          {t(view.sealed ? "circle.sealed" : view.full ? "circle.fullUnsealed" : "circle.filling")}
        </p>
      </section>

      {!view.full && <Invite invite={invite} />}
      {!view.full && !isMember && <Join invite={invite} onJoined={refresh} />}
    </>
  );
}

function Invite({ invite }: { invite: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useT();
  const url = inviteUrl(invite);
  return (
    <section aria-labelledby="invite" className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 id="invite" className="text-xl font-medium">
        {t("invite.title")}
      </h2>
      <p className="leading-7 text-muted">
        {t("invite.warning")}
      </p>
      <input className={`${input} font-mono text-sm`} readOnly value={url} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className={secondary}
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {t(copied ? "invite.copied" : "invite.copy")}
      </button>
    </section>
  );
}

function Join({ invite, onJoined }: { invite: string; onJoined: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [payout, setPayout] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<MessageKey | null>(null);
  const { t, explain } = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setBusy("form.checkingPayout");
      const profile = await profileFor(name, payout);
      setBusy("join.taking");
      await joinCircle(invite, profile);
      await onJoined();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="join" className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 id="join" className="text-xl font-medium">
        {t("join.title")}
      </h2>
      <label className={field}>
        <span>{t("form.yourName")}</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <label className={field}>
        <span>{t("form.payout")}</span>
        <input
          className={input}
          value={payout}
          onChange={(e) => setPayout(e.target.value)}
          placeholder={t("form.payoutPlaceholder")}
          autoComplete="off"
          required
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/50 bg-bad/10 p-3 text-bad">
          {error}
        </p>
      )}
      <button className={`${button} w-full`} disabled={busy !== null}>
        {t(busy ?? "join.submit")}
      </button>
    </form>
  );
}
