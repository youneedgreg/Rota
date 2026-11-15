"use client";

// The reader's language: their choice on this device, else the browser's
// language, else English. The server always renders English; the browser
// switches after loading, without a hydration mismatch.
import Link from "next/link";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { checkDetail, explainError } from "./errors";
import { LANGS, localeOf, translate, type Lang, type MessageKey, type Vars } from "./messages";

const STORAGE_KEY = "rota.lang.v1";
const EVENT = "rota-lang";

function current(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  } catch {
    // Storage blocked: fall through to the browser's language.
  }
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not remembered, but still switched for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, current, () => "en");
}

/** Text, errors, dates and numbers in the reader's language. */
export function useT() {
  const lang = useLang();
  const t = useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  const explain = useCallback((error: unknown) => explainError(error, lang), [lang]);
  const detail = useCallback((text: string) => checkDetail(text, lang), [lang]);
  const locale = localeOf(lang);
  const when = useCallback(
    (date: Date) => date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const num = useCallback((n: number | bigint) => n.toLocaleString(locale), [locale]);
  return { lang, t, explain, detail, when, num };
}

/** Two buttons, English and Français, at the top of every page. Keeps <html lang> in step. */
export function LanguageSwitch() {
  const { lang, t } = useT();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <nav aria-label={t("lang.label")} className="mx-auto flex w-full max-w-xl justify-end gap-1 px-4 pt-3 text-sm">
      {(
        [
          ["en", "English"],
          ["fr", "Français"],
        ] as const
      ).map(([code, name]) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          className={`min-h-11 rounded-md px-3 ${lang === code ? "font-semibold underline" : "opacity-70"}`}
          onClick={() => setLang(code)}
        >
          {name}
        </button>
      ))}
    </nav>
  );
}

/** One translated string, for server-rendered pages. */
export function T({ k, vars }: { k: MessageKey; vars?: Vars }) {
  const { t } = useT();
  return <>{t(k, vars)}</>;
}

/**
 * A link with a translated label, for server-rendered pages. The Link lives
 * in this client component: a server-rendered Link with <T> inside it stops
 * Next's dev check of instant navigation from rendering the page.
 */
export function TLink({ href, k, className }: { href: string; k: MessageKey; className?: string }) {
  const { t } = useT();
  return (
    <Link href={href} className={className}>
      {t(k)}
    </Link>
  );
}
