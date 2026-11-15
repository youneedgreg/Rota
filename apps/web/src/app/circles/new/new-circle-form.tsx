"use client";

import { CURRENCIES, MAX_MEMBERS, MIN_MEMBERS, type Currency, type Schedule } from "@rota/circles";
import { checkDraft } from "@rota/records";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createCircle, profileFor } from "@/lib/circles";
import { useT } from "@/lib/lang";
import type { MessageKey } from "@/lib/messages";
import { button, field, input } from "@/lib/ui";

type Pace = "demo" | "weekly" | "monthly";

/** Five minutes from now, on the minute: the default first round. */
function soon(): Date {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  return d;
}

export function NewCircleForm() {
  const router = useRouter();
  const { t, explain } = useT();
  const [you, setYou] = useState("");
  const [payout, setPayout] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("KES");
  const [contribution, setContribution] = useState("15");
  const [seats, setSeats] = useState("3");
  const [pace, setPace] = useState<Pace>("demo");
  const [startsAt, setStartsAt] = useState("");
  const [roundMinutes, setRoundMinutes] = useState("10");
  const [grace, setGrace] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<MessageKey | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const start = startsAt ? new Date(startsAt) : soon();
    if (Number.isNaN(start.getTime())) return setError(t("form.chooseStart"));
    const schedule: Schedule =
      pace === "demo"
        ? { kind: "demo", startsAt: start.toISOString(), roundMinutes: Number(roundMinutes), graceMinutes: Number(grace) }
        : { kind: pace, startsAt: start.toISOString(), graceDays: Number(grace) };
    try {
      setBusy("form.checkingPayout");
      const organizer = await profileFor(you, payout);
      const draft = checkDraft({
        name,
        currency,
        contribution: Number(contribution),
        seats: Number(seats),
        schedule,
        organizer,
      });
      setBusy("form.saving");
      const invite = await createCircle(draft);
      router.push(`/circle#${invite}`);
    } catch (err) {
      setError(explain(err));
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="text-xl font-medium">{t("form.you")}</legend>
        <label className={field}>
          <span>{t("form.yourName")}</span>
          <input className={input} value={you} onChange={(e) => setYou(e.target.value)} maxLength={40} required />
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
          <span className="text-sm opacity-70">
            {t("form.payoutHelp")}
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xl font-medium">{t("form.circle")}</legend>
        <label className={field}>
          <span>{t("form.circleName")}</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className={field}>
            <span>{t("form.eachPays")}</span>
            <input
              className={input}
              inputMode="numeric"
              value={contribution}
              onChange={(e) => setContribution(e.target.value)}
              required
            />
          </label>
          <label className={field}>
            <span>{t("form.currency")}</span>
            <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className={field}>
          <span>{t("form.seats")}</span>
          <input
            className={input}
            inputMode="numeric"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            min={MIN_MEMBERS}
            max={MAX_MEMBERS}
            required
          />
          <span className="text-sm opacity-70">
            {t("form.seatsHelp", { min: MIN_MEMBERS, max: MAX_MEMBERS })}
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xl font-medium">{t("form.rounds")}</legend>
        <label className={field}>
          <span>{t("form.pace")}</span>
          <select
            className={input}
            value={pace}
            onChange={(e) => {
              const next = e.target.value as Pace;
              setPace(next);
              setGrace(next === "demo" ? "5" : next === "weekly" ? "2" : "5");
            }}
          >
            <option value="demo">{t("form.pace.demo")}</option>
            <option value="weekly">{t("form.pace.weekly")}</option>
            <option value="monthly">{t("form.pace.monthly")}</option>
          </select>
        </label>
        <label className={field}>
          <span>{t("form.firstRound")}</span>
          <input className={input} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <span className="text-sm opacity-70">{t("form.firstRoundHelp")}</span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          {pace === "demo" && (
            <label className={field}>
              <span>{t("form.roundMinutes")}</span>
              <input className={input} inputMode="numeric" value={roundMinutes} onChange={(e) => setRoundMinutes(e.target.value)} />
            </label>
          )}
          <label className={field}>
            <span>{t(pace === "demo" ? "form.lateMinutes" : "form.lateDays")}</span>
            <input className={input} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
          </label>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg border border-current p-3">
          {error}
        </p>
      )}
      <button className={`${button} w-full`} disabled={busy !== null}>
        {t(busy ?? "form.submit")}
      </button>
    </form>
  );
}
