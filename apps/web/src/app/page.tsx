import { RECEIPT_CHECKS } from "lightning-receipts";
import { T, TLink } from "@/lib/lang";
import { button, card, secondary } from "@/lib/ui";
import { MyCircles } from "./my-circles";

const STEPS = ["home.how.1", "home.how.2", "home.how.3"] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <section className="space-y-4">
        <h1 className="text-4xl font-bold leading-tight tracking-tight">
          <T k="home.headline" />
        </h1>
        <p className="text-lg leading-8 text-muted">
          <T k="home.tagline" />
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <TLink href="/circles/new" k="home.start" className={`${button} inline-flex items-center`} />
          <TLink href="/wallet" k="home.wallet" className={`${secondary} inline-flex items-center`} />
          <TLink href="/track-record" k="home.trackRecord" className={`${secondary} inline-flex items-center`} />
        </div>
      </section>

      <MyCircles />

      <section aria-labelledby="how" className="space-y-3">
        <h2 id="how" className="text-xl font-semibold">
          <T k="home.how.title" />
        </h2>
        <ol className="space-y-3">
          {STEPS.map((k, i) => (
            <li key={k} className={`${card} flex items-start gap-3`}>
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-accent-ink"
              >
                {i + 1}
              </span>
              <span className="pt-1 leading-6">
                <T k={k} />
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="checks" className={`${card} space-y-3`}>
        <h2 id="checks" className="font-semibold">
          <T k="home.checksTitle" />
        </h2>
        <ul className="space-y-2">
          {RECEIPT_CHECKS.map((check) => (
            <li key={check} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ok/15 text-sm font-bold text-ok"
              >
                ✓
              </span>
              <T k={`home.check.${check}`} />
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-sm text-muted">
        <T k="home.builtFor" />{" "}
        <a className="inline-flex min-h-11 items-center underline" href="https://github.com/youneedgreg/Rota">
          <T k="home.source" />
        </a>
      </footer>
    </main>
  );
}
