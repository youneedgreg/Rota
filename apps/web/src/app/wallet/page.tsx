import type { Metadata } from "next";
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
        <h1 className="text-3xl font-semibold tracking-tight">Wallet</h1>
        <p className="leading-7 opacity-80">
          Your wallet lives on this device. Rota never sees your recovery words
          or your PIN, and can&apos;t move your money.
        </p>
      </header>
      <WalletPanel />
      <NwcPanel />
    </main>
  );
}
