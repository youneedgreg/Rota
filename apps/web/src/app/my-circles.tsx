"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { savedCircles, type SavedCircle } from "@/lib/circles";
import { T } from "@/lib/lang";

const noSubscribe = () => () => {};
let cache: { raw: string | null; list: SavedCircle[] } = { raw: null, list: [] };

/** The saved list, re-read only when storage changes, so React gets a stable value. */
function snapshot(): SavedCircle[] {
  const raw = localStorage.getItem("rota.circles.v1");
  if (raw !== cache.raw) cache = { raw, list: savedCircles() };
  return cache.list;
}

export function MyCircles() {
  const circles = useSyncExternalStore(noSubscribe, snapshot, () => null);
  if (!circles || circles.length === 0) return null;
  return (
    <section aria-labelledby="mine" className="space-y-2">
      <h2 id="mine" className="text-xl font-semibold">
        <T k="mine.title" />
      </h2>
      <ul className="space-y-2">
        {circles.map((c) => (
          <li key={c.invite}>
            <Link className="flex min-h-12 items-center justify-between rounded-2xl border border-line bg-surface px-4 font-medium shadow-sm" href={`/circle#${c.invite}`}>
              {c.name}
              <span aria-hidden="true" className="text-accent">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
