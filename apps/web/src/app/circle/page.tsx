import type { Metadata } from "next";
import { CircleScreen } from "./circle-screen";

export const metadata: Metadata = {
  title: "Circle · Rota",
  description: "A savings circle on Rota.",
};

// The circle comes from the invite link after "#", which only the browser
// reads, so the page itself is the same for every circle.
export default function CirclePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <CircleScreen />
    </main>
  );
}
