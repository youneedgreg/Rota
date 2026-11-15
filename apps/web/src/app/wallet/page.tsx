import type { Metadata } from "next";
import { T } from "@/lib/lang";
import { NwcPanel } from "./nwc-panel";
import { WalletPanel } from "./wallet-panel";

export const metadata: Metadata = {
  title: "Wallet · Rota",
  description: "Rota's built-in Lightning wallet. Its keys stay on this device.",
};

export default function WalletPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          <T k="wallet.title" />
        </h1>
        <p className="leading-7 opacity-80">
          <T k="wallet.intro" />
        </p>
      </header>
      <WalletPanel />
      <NwcPanel />
    </main>
  );
}
