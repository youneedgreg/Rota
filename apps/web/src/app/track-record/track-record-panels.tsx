"use client";

import { MAX_TRACK_RECORD_BYTES, verifyTrackRecord, type TrackedReceipt, type TrackRecordResult } from "@rota/records";
import { useState, useSyncExternalStore, type ChangeEvent } from "react";
import { savedCircles } from "@/lib/circles";
import { useT } from "@/lib/lang";
import type { MessageKey } from "@/lib/messages";
import { invoiceNetwork } from "@/lib/rounds";
import { buildMyTrackRecord, downloadTrackRecord, type MyTrackRecord } from "@/lib/track-record";
import { button, field, maskAddress, secondary } from "@/lib/ui";

const noSubscribe = () => () => {};

const CHECK_LABELS: Record<string, MessageKey> = {
  paid: "check.paid",
  address: "check.address",
  issuer: "check.issuer",
  amount: "check.amount",
};

/** Builds this device's member's track record and downloads it. */
export function ExportPanel() {
  const hasCircles = useSyncExternalStore(noSubscribe, () => savedCircles().length > 0, () => false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<MyTrackRecord | null>(null);
  const [error, setError] = useState(false);
  const { t, num } = useT();

  if (!hasCircles) return null;

  async function make() {
    setBusy(true);
    setError(false);
    try {
      const record = await buildMyTrackRecord();
      setMade(record);
      if (record.receipts > 0) downloadTrackRecord(record.file);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="export" className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 id="export" className="text-xl font-medium">
        {t("track.exportTitle")}
      </h2>
      <p className="leading-7">{t("track.exportText")}</p>
      <p className="rounded-lg border border-line p-3 leading-7">{t("track.warning")}</p>
      {made && (
        <p role="status">
          {made.receipts > 0
            ? t("track.made", { receipts: num(made.receipts), circles: num(made.circles) })
            : t("track.none")}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/50 bg-bad/10 p-3 text-bad">
          {t("track.error")}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} disabled={busy} onClick={make}>
          {t(busy ? "track.making" : "track.make")}
        </button>
        {made && made.receipts > 0 && (
          <button type="button" className={secondary} onClick={() => downloadTrackRecord(made.file)}>
            {t("track.again")}
          </button>
        )}
      </div>
    </section>
  );
}

/** Opens a track-record file and checks it here, in this browser. */
export function CheckPanel() {
  const [result, setResult] = useState<TrackRecordResult | null>(null);
  const [bad, setBad] = useState(false);
  const { t, when, num, detail } = useT();

  async function open(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setBad(false);
    if (!file) return;
    if (file.size > MAX_TRACK_RECORD_BYTES * 2) {
      setBad(true);
      return;
    }
    try {
      setResult(verifyTrackRecord(JSON.parse(await file.text()), { network: invoiceNetwork() }));
    } catch {
      setBad(true);
    }
  }

  return (
    <section aria-labelledby="check" className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 id="check" className="text-xl font-medium">
        {t("track.checkTitle")}
      </h2>
      <p className="leading-7">{t("track.checkText")}</p>
      <label className={field}>
        <span>{t("track.file")}</span>
        <input type="file" accept="application/json,.json" onChange={open} className="block w-full min-h-12" />
      </label>
      {bad && (
        <p role="alert" className="rounded-lg border border-bad/50 bg-bad/10 p-3 text-bad">
          {t("track.badFile")}
        </p>
      )}
      {result && !result.ok && (
        <p role="alert" className="rounded-lg border border-bad/50 bg-bad/10 p-3 text-bad">
          {detail(result.problem ?? "")}
        </p>
      )}
      {result?.ok && (
        <div className="space-y-4">
          <div role="status" className="space-y-1">
            <p>
              {t("track.summary", {
                member: `${result.member?.slice(0, 8)}…`,
                when: result.exportedAt ? when(result.exportedAt) : "",
              })}
            </p>
            <p className="font-medium">
              {t("track.totals", {
                proven: num(result.totals.proven),
                failed: num(result.totals.failed),
                onTime: num(result.totals.onTime),
                late: num(result.totals.late),
              })}
            </p>
          </div>
          {result.circles.map((c) => (
            <div key={c.circle} className="space-y-2">
              <h3 className="font-medium">
                {t("track.circle", { name: c.name, amount: num(c.contribution), currency: c.currency })}
              </h3>
              <ul className="space-y-3">
                {c.receipts.map((r) => (
                  <TrackedRow key={r.eventId} receipt={r} />
                ))}
              </ul>
            </div>
          ))}
          <p className="text-sm leading-6 text-muted">{t("track.stated")}</p>
        </div>
      )}
    </section>
  );
}

function TrackedRow({ receipt }: { receipt: TrackedReceipt }) {
  const [shown, setShown] = useState(false);
  const { t, when, num, detail } = useT();
  const badge = receipt.duplicate
    ? t("track.duplicate")
    : !receipt.ok
      ? t("track.failed")
      : receipt.onTime === true
        ? t("track.onTime")
        : receipt.onTime === false
          ? t("track.late")
          : "";
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="font-medium">{receipt.round ? t("track.round", { n: receipt.round }) : "?"}</span>
          {badge && <span className="ml-2">· {badge}</span>}
          {receipt.sats !== undefined && receipt.address && (
            <span className="block text-sm text-muted">
              {t("track.paidTo", { sats: t("common.sats", { n: num(receipt.sats) }), address: maskAddress(receipt.address) })}
            </span>
          )}
          {receipt.invoiceIssuedAt && (
            <span className="block text-sm text-muted">{t("track.issued", { when: when(receipt.invoiceIssuedAt) })}</span>
          )}
        </span>
        <button type="button" className={secondary} aria-expanded={shown} onClick={() => setShown(!shown)}>
          {t(shown ? "receipts.hide" : "receipts.verify")}
        </button>
      </div>
      {shown && (
        <ul className="space-y-1 rounded-xl border border-line bg-background p-3">
          {receipt.checks.map((c) => (
            <Line
              key={c.check}
              ok={c.ok}
              label={CHECK_LABELS[c.check] ? t(CHECK_LABELS[c.check]) : c.check}
              detail={detail(c.detail) + (c.proof === "description" ? t("receipts.weaker") : "")}
            />
          ))}
          <Line ok={receipt.member.ok} label={t("track.member")} detail={detail(receipt.member.detail)} />
        </ul>
      )}
    </li>
  );
}

function Line({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const { t } = useT();
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="w-5 shrink-0 font-bold">
        {ok ? "✓" : "✗"}
      </span>
      <span>
        <span className="sr-only">{t(ok ? "receipts.passes" : "receipts.failsPrefix")}</span>
        {label}
        <span className="block text-sm text-muted">{detail}</span>
      </span>
    </li>
  );
}
