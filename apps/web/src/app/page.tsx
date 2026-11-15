import { RECEIPT_CHECKS } from "@rota/receipts";
import { T, TLink } from "@/lib/lang";
import { MyCircles } from "./my-circles";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Rota</h1>
      <p className="text-lg leading-8">
        <T k="home.tagline" />
      </p>
      <div className="flex flex-wrap gap-3">
        <TLink
          href="/circles/new"
          k="home.start"
          className="inline-flex min-h-12 items-center rounded-lg bg-foreground px-4 font-medium text-background"
        />
        <TLink
          href="/wallet"
          k="home.wallet"
          className="inline-flex min-h-12 items-center rounded-lg border border-current px-4 font-medium"
        />
      </div>
      <MyCircles />
      <section aria-labelledby="checks">
        <h2 id="checks" className="mb-2 font-medium">
          <T k="home.checksTitle" />
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          {RECEIPT_CHECKS.map((check) => (
            <li key={check}>
              <T k={`home.check.${check}`} />
            </li>
          ))}
        </ol>
      </section>
      <p className="text-sm opacity-70">
        <T k="home.construction" />
      </p>
    </main>
  );
}
