"use client";
import Link from "next/link";
import { useApi } from "@/lib/use-api";
import { AppBar, EmptyState } from "@/components/ui/kit";
import { MathText } from "@/components/ui/math-text";

type Bookmark = { courseCode: string; questionId: string; courseId: string; text: string; savedAt: string };

/** D19 / D20: a revision list for the night before. */
export default function Bookmarks() {
  const { data } = useApi<{ bookmarks: Bookmark[] }>("/me/bookmarks");
  const list = data?.bookmarks ?? [];
  const groups = list.reduce<Record<string, Bookmark[]>>((acc, b) => ((acc[b.courseCode] ??= []).push(b), acc), {});

  if (data && !list.length) {
    return (
      <>
        <AppBar title="Bookmarks" />
        <EmptyState glyph="bookmark" tone="accent" title="No bookmarks yet">
          Tap the bookmark on any question while reviewing to save it here. It&apos;s useful for the ones you keep getting wrong.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <AppBar title="Bookmarks" sub={`${list.length} saved`} />
      <main className="flex flex-col gap-3 px-5 pb-5">
        {Object.entries(groups).map(([code, items]) => (
          <section key={code} className="flex flex-col gap-3">
            <span className="label pt-1.5">{code} · {items.length}</span>
            {items.map((b) => (
              <Link key={b.questionId} href={`/ask?q=${b.questionId}`} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-5 py-4">
                <span className="text-sm leading-snug"><MathText text={b.text} /></span>
                <span className="font-mono text-[11px] text-ink3">Saved {new Date(b.savedAt).toLocaleDateString()}</span>
              </Link>
            ))}
          </section>
        ))}
      </main>
    </>
  );
}
