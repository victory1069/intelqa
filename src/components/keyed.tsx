"use client";
import { Fragment, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Next keeps visited pages mounted, so opening /session?id=B after /session?id=A would reuse
 * A's component state (question index, timers, "seen" flags). Keying on the query string gives
 * every attempt, result or question a fresh component. Must sit inside <Suspense>.
 */
export function KeyedBySearch({ children }: { children: ReactNode }) {
  const key = useSearchParams().toString();
  return <Fragment key={key}>{children}</Fragment>;
}
