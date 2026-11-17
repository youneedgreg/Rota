import type { Metadata } from "next";
import { T } from "@/lib/lang";
import { CheckPanel, ExportPanel } from "./track-record-panels";

export const metadata: Metadata = {
  title: "Track record · Rota",
  description: "Export the payments you made, or check someone else's. Every check runs in your browser.",
};

export default function TrackRecordPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          <T k="track.title" />
        </h1>
        <p className="leading-7 opacity-80">
          <T k="track.intro" />
        </p>
      </header>
      <ExportPanel />
      <CheckPanel />
    </main>
  );
}
