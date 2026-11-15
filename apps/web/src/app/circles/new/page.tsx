import type { Metadata } from "next";
import { T } from "@/lib/lang";
import { NewCircleForm } from "./new-circle-form";

export const metadata: Metadata = {
  title: "Start a circle · Rota",
  description: "Start a savings circle with no treasurer.",
};

export default function NewCirclePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          <T k="new.title" />
        </h1>
        <p className="leading-7 opacity-80">
          <T k="new.intro" />
        </p>
      </header>
      <NewCircleForm />
    </main>
  );
}
