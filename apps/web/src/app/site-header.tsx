import Link from "next/link";
import { LanguageSwitch } from "@/lib/lang";

/** Rota's mark: seats around a circle, the round's recipient lit. */
export function Mark({ className = "size-7" }: { className?: string }) {
  const seats = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * 2 * Math.PI - Math.PI / 2;
    return { x: 16 + 11 * Math.cos(a), y: 16 + 11 * Math.sin(a), lit: i === 0 };
  });
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      {seats.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.lit ? 4 : 2.6} className={s.lit ? "fill-accent" : "fill-current"} />
      ))}
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-xl items-center justify-between gap-2 px-4 pt-3">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-lg font-bold tracking-tight">
        <Mark />
        Rota
      </Link>
      <LanguageSwitch />
    </header>
  );
}
