"use client";

import type { CircleView } from "@rota/records";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { inviteUrl, joinCircle, loadCircle, memberPubkey, profileFor, rememberCircle, sealCircle } from "@/lib/circles";
import { button, explain, field, input, maskAddress, secondary } from "@/lib/ui";

const REFRESH_MS = 10_000;

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function paceText(view: CircleView): string {
  const s = view.draft.schedule;
  const when = new Date(s.startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (s.kind === "demo") return `A round every ${s.roundMinutes} minutes from ${when} (demo)`;
  return `A round every ${s.kind === "weekly" ? "week" : "month"} from ${when}`;
}

export function CircleScreen() {
  const invite = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => null);
  const me = useSyncExternalStore(subscribeHash, memberPubkey, () => null);
  const [view, setView] = useState<CircleView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

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
      setError("Rota couldn't reach the circle's relay. It will keep trying.");
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

  if (invite === null) return <p>Loading…</p>;
  if (!invite) {
    return (
      <p>
        Open a circle from its invite link, or <Link className="underline" href="/circles/new">start one</Link>.
      </p>
    );
  }
  if (view === undefined) return <p>{error ?? "Loading the circle…"}</p>;
  if (view === null) {
    return <p role="alert">This invite link doesn&apos;t match a circle on this relay. Ask for the link again.</p>;
  }

  const isMember = view.members.some((m) => m.pubkey === me);
  const { draft } = view;

  return (
    <>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{draft.name}</h1>
        <p className="leading-7">
          Each member pays {draft.contribution.toLocaleString()} {draft.currency} a round. {paceText(view)}.
        </p>
      </header>

      {error && <p role="status">{error}</p>}

      <section aria-labelledby="seats" className="space-y-3 rounded-xl border border-current/20 p-4">
        <h2 id="seats" className="text-xl font-medium">
          Seats {view.members.length} of {draft.seats}
        </h2>
        <ol className="list-decimal space-y-2 pl-6">
          {view.members.map((m) => (
            <li key={m.pubkey}>
              <span className="font-medium">{m.name}</span>
              {m.pubkey === view.organizer && " · organizer"}
              {m.pubkey === me && " · you"}
              <span className="block text-sm opacity-70">Paid at {maskAddress(m.payoutAddress)}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm opacity-70">
          {view.sealed
            ? "Seats are final. Round 1 pays seat 1, round 2 pays seat 2, and so on."
            : view.full
              ? "Every seat is taken. The organizer's app will confirm the order the next time it opens."
              : "Seats fill in the order people join. The organizer's app confirms the order once every seat is taken."}
        </p>
      </section>

      {!view.full && <Invite invite={invite} />}
      {!view.full && !isMember && <Join invite={invite} onJoined={refresh} />}
    </>
  );
}

function Invite({ invite }: { invite: string }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(invite);
  return (
    <section aria-labelledby="invite" className="space-y-3 rounded-xl border border-current/20 p-4">
      <h2 id="invite" className="text-xl font-medium">
        Invite members
      </h2>
      <p className="leading-7 opacity-80">
        Anyone with this link can read the circle and take a free seat. Share it only with the people you&apos;re saving
        with.
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
        {copied ? "Copied" : "Copy the link"}
      </button>
    </section>
  );
}

function Join({ invite, onJoined }: { invite: string; onJoined: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [payout, setPayout] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setBusy("Checking your payout address…");
      const profile = await profileFor(name, payout);
      setBusy("Taking your seat…");
      await joinCircle(invite, profile);
      await onJoined();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="join" className="space-y-4 rounded-xl border border-current/20 p-4">
      <h2 id="join" className="text-xl font-medium">
        Join this circle
      </h2>
      <label className={field}>
        <span>Your name</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <label className={field}>
        <span>Where you get paid</span>
        <input
          className={input}
          value={payout}
          onChange={(e) => setPayout(e.target.value)}
          placeholder="M-Pesa number (07…) or Lightning address"
          autoComplete="off"
          required
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-current p-3">
          {error}
        </p>
      )}
      <button className={`${button} w-full`} disabled={busy !== null}>
        {busy ?? "Join"}
      </button>
    </form>
  );
}
