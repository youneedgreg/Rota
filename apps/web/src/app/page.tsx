import { RECEIPT_CHECKS } from "@rota/receipts";
import Link from "next/link";
import { MyCircles } from "./my-circles";

const CHECK_LABELS: Record<(typeof RECEIPT_CHECKS)[number], string> = {
  paid: "It was paid",
  address: "To this address",
  issuer: "By this service",
  amount: "This amount, this round, this member",
};

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Rota</h1>
      <p className="text-lg leading-8">
        A tontine with no treasurer. Each member pays that round&apos;s
        recipient directly over Lightning, and every payment leaves a receipt
        nobody can fake.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/circles/new"
          className="inline-flex min-h-12 items-center rounded-lg bg-foreground px-4 font-medium text-background"
        >
          Start a circle
        </Link>
        <Link href="/wallet" className="inline-flex min-h-12 items-center rounded-lg border border-current px-4 font-medium">
          Wallet
        </Link>
      </div>
      <MyCircles />
      <section aria-labelledby="checks">
        <h2 id="checks" className="mb-2 font-medium">
          Every receipt passes four checks
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          {RECEIPT_CHECKS.map((check) => (
            <li key={check}>{CHECK_LABELS[check]}</li>
          ))}
        </ol>
      </section>
      <p className="text-sm opacity-70">
        Under construction for the Dakar Bitcoin Hack.
      </p>
    </main>
  );
}
