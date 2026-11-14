"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useOnline } from "@/lib/use-online";
import { askLater, useAskLater } from "@/lib/offline";
import { startOnline } from "@/lib/start";
import { Gate } from "@/components/gate";
import { KeyedBySearch } from "@/components/keyed";
import { AppBar, Banner, EmptyState, Screen } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MathText } from "@/components/ui/math-text";
import { LETTERS } from "@/shared/game";

type AskData = {
  question: {
    id: string;
    text: string;
    options: string[];
    correctOption: number | null;
    /** Older cached copies may not have these. */
    courseCode?: string;
    topicId?: string | null;
    topicName?: string | null;
  };
  messages: { role: "user" | "assistant"; content: string }[];
  used: number;
  remaining: number;
  limit: number;
};

/** C16: the first suggestion names the student's own pick when it's short enough to quote. */
function suggestions(q: AskData["question"] | undefined, chosen: number | null) {
  const quote = (n: number | null) => {
    const t = n != null ? q?.options[n]?.trim() : undefined;
    return t && t.length <= 40 ? `"${t}"` : null;
  };
  const mine = quote(chosen);
  const key = quote(q?.correctOption ?? null);
  const first =
    chosen != null && chosen !== q?.correctOption && mine
      ? `Why isn't ${mine} the answer?`
      : chosen == null && key
        ? `Why is ${key} the answer?`
        : "Why is my answer wrong?";
  return [first, "Give me 3 more examples like this", "Explain it like I'm in SS2"];
}

export default function AskPage() {
  return (
    <Gate>
      <Suspense>
        <KeyedBySearch>
          <Ask />
        </KeyedBySearch>
      </Suspense>
    </Gate>
  );
}

/** C16–C20: AI follow-up scoped to one question, capped per day. */
function Ask() {
  const sp = useSearchParams();
  const qid = sp.get("q") ?? "";
  const chosenRaw = sp.get("chosen");
  const chosen = chosenRaw != null ? Number(chosenRaw) : null;
  const numRaw = sp.get("n");
  const num = numRaw != null && Number(numRaw) > 0 ? Number(numRaw) : null;
  const router = useRouter();
  const online = useOnline();
  const { data, error } = useApi<AskData>(qid ? `/questions/${qid}/ask` : null);
  type Msg = { role: "user" | "assistant"; content: string; failed?: boolean };
  const [local, setLocal] = useState<Msg[] | null>(null);
  const [usedNow, setUsedNow] = useState(0);
  const [limitHit, setLimitHit] = useState(false);
  const messages: Msg[] = local ?? data?.messages ?? [];
  const setMessages = (fn: (m: Msg[]) => Msg[]) => setLocal((prev) => fn(prev ?? data?.messages ?? []));
  const remaining = limitHit ? 0 : data ? Math.max(0, data.remaining - usedNow) : null;
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const saved = useAskLater();
  const [practising, setPractising] = useState(false);

  const lastText = messages.at(-1)?.content;
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages.length, lastText]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || streaming) return;
    setInput("");
    setStreaming(true);
    setMessages((m) => [...m.filter((x) => !x.failed), { role: "user", content: msg }, { role: "assistant", content: "" }]);
    const fail = (why: string) =>
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: why, failed: true }]);
    try {
      const res = await fetch(`/api/questions/${qid}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ message: msg, chosenOption: chosen }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 429) setLimitHit(true);
        return fail(j.error ?? "The reply didn't come through. This one didn't count toward your limit.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const errAt = acc.indexOf("\n[[error]]");
        if (errAt >= 0) return fail(`${acc.slice(errAt + 10)} This one didn't count toward your limit.`);
        setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: acc }]);
      }
      setUsedNow((n) => n + 1);
      askLater.remove(qid);
    } catch {
      fail("The reply didn't come through. This one didn't count toward your limit.");
    } finally {
      setStreaming(false);
    }
  }

  const q = data?.question;
  const title = num ? `Ask about Q${num}` : "Ask about this question";
  const left = remaining == null ? null : `${remaining} of ${data?.limit ?? 5} left today`;
  const sub = [q?.courseCode, left].filter(Boolean).join(" · ");

  // C19: Ask needs a server. Offer to keep the question until the phone is back online.
  if (!online && !messages.length) {
    const isSaved = saved.some((x) => x.questionId === qid);
    return (
      <Screen>
        <AppBar title={title} sub={sub} lead="close" border />
        <div className="flex-1">
          <EmptyState glyph="offline" title="Ask needs data">
            You&apos;re offline. Explanations you downloaded still work. We&apos;ll save this question so you can ask when you&apos;re back online.
          </EmptyState>
        </div>
        <div className="flex flex-col gap-2 px-[22px] pb-5">
          <Button
            full
            icon={isSaved ? "check" : "bookmark"}
            disabled={isSaved || !qid}
            onClick={() => askLater.save({ questionId: qid, chosen, number: num, courseCode: q?.courseCode ?? null, text: q?.text ?? null })}
          >
            {isSaved ? "Saved for later" : "Save for later"}
          </Button>
          {isSaved && <span className="text-center text-[13px] text-ink3">It&apos;ll be in your bookmarks once you reconnect.</span>}
          <Button full kind="ghost" onClick={() => router.back()}>Back to explanation</Button>
        </div>
      </Screen>
    );
  }
  if (error && !data) {
    return (
      <Screen>
        <AppBar title="Ask" lead="close" border />
        <EmptyState glyph="lock" title="Ask isn't open for this one">{error.message}</EmptyState>
      </Screen>
    );
  }

  const waiting = saved.filter((x) => x.questionId !== qid);
  return (
    <Screen>
      <AppBar title={title} sub={sub} lead="close" border />
      {waiting.length > 0 && (
        <div className="mx-4 mt-3">
          <Banner
            tone="accent"
            icon="bookmark"
            action={<button className="text-[13px] font-semibold" onClick={() => waiting.forEach((x) => askLater.remove(x.questionId))}>Clear</button>}
          >
            {waiting.length === 1 ? "You saved a question to ask about: " : `You saved ${waiting.length} questions to ask about: `}
            {waiting.slice(0, 3).map((x, n) => (
              <span key={x.questionId}>
                {n > 0 && ", "}
                <Link className="font-semibold underline" href={`/ask?q=${x.questionId}${x.number ? `&n=${x.number}` : ""}${x.chosen != null ? `&chosen=${x.chosen}` : ""}`}>
                  {[x.courseCode, x.number ? `Q${x.number}` : null].filter(Boolean).join(" ") || `Question ${n + 1}`}
                </Link>
              </span>
            ))}
            {waiting.length > 3 && ` and ${waiting.length - 3} more in Bookmarks`}
          </Banner>
        </div>
      )}
      {q && (
        <div className="mx-4 mt-3 flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3">
          <span className="text-sm font-medium"><MathText text={q.text} /></span>
          <span className="font-mono text-[11px] text-ink3">
            YOU: {chosen != null ? `${LETTERS[chosen]} · ${q.options[chosen]}` : "SKIPPED"}
            {"   "}CORRECT: {q.correctOption != null ? `${LETTERS[q.correctOption]} · ${q.options[q.correctOption]}` : "?"}
          </span>
        </div>
      )}
      <main className="flex flex-1 flex-col justify-end gap-3 overflow-y-auto px-4 pt-4" aria-live="polite">
        {!messages.length && remaining !== 0 && (
          <>
            <span className="pb-1.5 text-center text-[13px] text-ink3">Try one of these, or type your own</span>
            {suggestions(q, chosen).map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-[14px] border-[1.5px] border-line bg-surface px-3.5 py-3 text-left text-sm"><MathText text={s} /></button>
            ))}
          </>
        )}
        {messages.map((m, n) =>
          m.role === "user" ? (
            <div key={n} className="max-w-[80%] self-end rounded-[18px_18px_4px_18px] bg-accent px-3.5 py-2.5 text-sm leading-snug text-on-accent">{m.content}</div>
          ) : (
            <div key={n} className="flex max-w-[88%] gap-2 self-start">
              <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-[9px] ${m.failed ? "bg-bad-tint" : "bg-accent-tint"}`}>
                <Icon name={m.failed ? "alert" : "sparkle"} size={16} color={m.failed ? "var(--bad-text)" : "var(--accent-text)"} />
              </span>
              <div className={`flex flex-col gap-2 rounded-[4px_18px_18px_18px] px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap ${m.failed ? "bg-bad-tint text-bad-text" : "border border-line bg-surface"}`}>
                {m.content ? <MathText text={m.content} /> : <span className="flex gap-1.5 py-1"><Dot /><Dot o={0.6} /><Dot o={0.3} /></span>}
                {m.failed && (
                  <button className="flex items-center gap-1.5 self-start font-bold" onClick={() => send(messages[n - 1]?.content ?? "")}>
                    <Icon name="refresh" size={16} />Try again
                  </button>
                )}
              </div>
            </div>
          ),
        )}
        {messages.length > 0 && <span className="py-1 text-center text-[11px] text-ink3">AI answers can be wrong. The checked explanation is the one to trust.</span>}
        <div ref={bottom} />
      </main>
      {remaining === 0 ? (
        <div className="mx-3 my-3.5 flex flex-col gap-2.5 rounded-[18px] bg-raised p-4">
          <div className="flex items-center gap-2.5"><Icon name="clock" size={20} /><strong className="text-[15px]">You&apos;ve used today&apos;s {data?.limit ?? 5} questions</strong></div>
          <span className="text-sm leading-snug text-ink2">Ask opens again at midnight. Until then, the checked explanation and topic practice are still there.</span>
          {q?.topicId && q.topicName && online ? (
            <Button
              kind="secondary"
              size="md"
              full
              loading={practising}
              onClick={async () => {
                setPractising(true);
                try {
                  router.push(await startOnline({ mode: "topic", topicId: q.topicId! }));
                } catch {
                  setPractising(false);
                }
              }}
            >
              Practise {q.topicName}
            </Button>
          ) : (
            <Button kind="secondary" size="md" full onClick={() => router.back()}>Back to explanation</Button>
          )}
        </div>
      ) : (
        <form
          className="flex items-center gap-2 p-3"
          style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={600}
            placeholder={messages.length ? "Ask a follow-up…" : "Ask about this question…"}
            className="h-12 flex-1 rounded-full border-[1.5px] border-line bg-surface px-4 text-[15px] outline-none focus:border-accent"
            aria-label="Your question"
          />
          <button type="submit" disabled={!input.trim() || streaming} aria-label="Send" className={`flex h-12 w-12 items-center justify-center rounded-full ${input.trim() && !streaming ? "bg-accent" : "bg-raised"}`}>
            <Icon name={streaming ? "pause" : "send"} size={20} color={input.trim() && !streaming ? "var(--on-accent)" : "var(--ink3)"} />
          </button>
        </form>
      )}
    </Screen>
  );
}

function Dot({ o = 1 }: { o?: number }) {
  return <span className="h-[7px] w-[7px] rounded-full bg-ink3" style={{ opacity: o }} />;
}
