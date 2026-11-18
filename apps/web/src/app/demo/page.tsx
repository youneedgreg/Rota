import type { Metadata } from "next";
import { DemoScreen } from "./demo-screen";

export const metadata: Metadata = {
  title: "Demo login · Rota",
  description: "Act as a fictional member of the local demo circle.",
};

// The login comes from the link after "#", which only the browser reads.
export default function DemoPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <DemoScreen />
    </main>
  );
}
