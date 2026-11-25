"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { odb } from "@/lib/offline";
import type { GradeResult, Session } from "@/lib/types";
import { Gate } from "@/components/gate";
import { KeyedBySearch } from "@/components/keyed";
import { Runner, type Answer, type Driver, type Feedback } from "@/components/session/runner";
import { EmptyState, Screen, Sheet, fmtClock } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icon";

export default function SessionPage() {
  return (
    <Gate>
      <Suspense>
        <KeyedBySearch>
          <Online />
        </KeyedBySearch>
      </Suspense>
    </Gate>
  );
}

const MODE_LABEL: Record<string, string> = { exam: "Exam simulation", drill: "Quick drill", topic: "Topic practice", retry: "Retry mistakes", daily: "Daily challenge", challenge: "Friend challenge", quiz: "Quiz" };

function Online() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [s, setS] = useState<Session | null>(null);
  const [initial, setInitial] = useState<Record<string, Answer>>({});
  const [skew, setSkew] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState<number | null>(null);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeLeft, setResumeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      let session: Session | null = null;
      try {
        session = await api<Session>(`/attempts/${id}`);
        odb().cache.put({ path: `/attempts/${id}`, data: session, at: Date.now() }).catch(() => {});
      } catch (e) {
        const saved = await odb().cache.get(`/attempts/${id}`).catch(() => undefined);
        if (saved) session = saved.data as Session;
        else return setError((e as ApiError).message);
      }
      if (cancelled || !session) return;
      if (session.submittedAt) return router.replace(`/result?id=${id}`);

      const offset = Date.parse(session.serverNow) - Date.now();
      // Answers saved on this phone win over the server copy: they're newer.
      const mirror = await odb().sessions.get(id).catch(() => undefined);
      const merged: Record<string, Answer> = {};
      for (const a of session.answers) merged[a.questionId] = { choice: a.choice, flagged: a.flagged, timeSpentMs: a.timeSpentMs };
      Object.assign(merged, mirror?.answers ?? {});

      setSkew(offset);
      setInitial(merged);
      setS(session);
      if (session.deadlineAt && Date.parse(session.deadlineAt) - offset < Date.now()) {
        setExpired(Object.values(merged).filter((x) => x.choice != null).length);
        api(`/attempts/${id}/submit`, { method: "POST" }).catch(() => odb().sessions.put({ attemptId: id, answers: merged, dirty: [], updatedAt: Date.now(), submitRequestedAt: Date.now() }));
      } else if (Object.keys(merged).length > 0 && !session.instantFeedback && Date.now() - Date.parse(session.startedAt) + offset > 60_000) {
        setResumeLeft(session.deadlineAt ? (Date.parse(session.deadlineAt) - offset - Date.now()) / 1000 : null);
        setResumeOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const flush = useCallback(async () => {
    const m = await odb().sessions.get(id);
    if (!m?.dirty.length) return;
    const sending = [...m.dirty];
    try {
      await api(`/attempts/${id}`, { method: "PATCH", body: { answers: sending.map((questionId) => ({ questionId, ...m.answers[questionId] })) } });
      const latest = await odb().sessions.get(id);
      if (latest) await odb().sessions.update(id, { dirty: latest.dirty.filter((q) => !sending.includes(q) || latest.answers[q] !== m.answers[q]) });
    } catch (e) {
      if ((e as ApiError).status === 410) router.replace(`/result?id=${id}`);
      // Otherwise keep it dirty; the sync watcher retries when the network is back.
    }
  }, [id, router]);

  useEffect(() => {
    const on = () => flush();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [flush]);

  const driver = useMemo<Driver | null>(() => {
    if (!s) return null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    return {
      mode: s.mode,
      title: MODE_LABEL[s.mode],
      subtitle: [s.course.code, s.paper?.session ?? s.quiz?.title].filter(Boolean).join(" · "),
      questions: s.questions,
      initial,
      deadline: s.deadlineAt ? Date.parse(s.deadlineAt) - skew : null,
      negativeMark: s.negativeMark,
      instantFeedback: s.instantFeedback,
      offline: false,
      save: (qid, a) => {
        const db = odb();
        db.transaction("rw", db.sessions, async () => {
          const m = (await db.sessions.get(id)) ?? { attemptId: id, answers: {}, dirty: [], updatedAt: 0 };
          m.answers[qid] = a;
          if (!m.dirty.includes(qid)) m.dirty.push(qid);
          m.updatedAt = Date.now();
          await db.sessions.put(m);
        }).then(() => {
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(flush, 400);
        });
      },
      check: async (qid, choice) => api<Feedback>(`/attempts/${id}/check`, { method: "POST", body: { questionId: qid, choice } }),
      submit: async () => {
        if (flushTimer) clearTimeout(flushTimer);
        await flush();
        try {
          const r = await api<GradeResult>(`/attempts/${id}/submit`, { method: "POST" });
          sessionStorage.setItem(`iq-grade-${id}`, JSON.stringify(r));
          await odb().sessions.delete(id).catch(() => {});
          return `/result?id=${id}`;
        } catch (e) {
          const err = e as ApiError;
          if (err.offline || err.status >= 500) {
            const m = await odb().sessions.get(id);
            await odb().sessions.put({ ...(m ?? { attemptId: id, answers: {}, dirty: [], updatedAt: Date.now() }), submitRequestedAt: Date.now() });
            throw new Error("No connection");
          }
          if (err.status === 409) return `/result?id=${id}`;
          throw err;
        }
      },
      onAsk: (qid, choice) => router.push(`/ask?q=${qid}&n=${s.questions.findIndex((x) => x.id === qid) + 1}${choice != null ? `&chosen=${choice}` : ""}`),
      onLeave: () => router.push("/home"),
    };
  }, [s, initial, skew, id, flush, router]);

  if (error) {
    return (
      <Screen>
        <EmptyState glyph="alert" title="Couldn't open this session">{error}</EmptyState>
        <div className="p-5"><Button full onClick={() => router.push("/home")}>Go home</Button></div>
      </Screen>
    );
  }
  if (!driver || !s) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={32} color="var(--accent)" />
      </Screen>
    );
  }

  if (!s.questions.length) {
    return (
      <Screen>
        <EmptyState glyph="alert" title="This session has no questions">The questions in it were taken down. Start a new session from Practise.</EmptyState>
        <div className="p-5"><Button full onClick={() => router.push("/practise")}>Go to Practise</Button></div>
      </Screen>
    );
  }

  // B12
  if (expired != null) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center gap-3.5 px-7 pt-[70px] text-center">
          <span className="flex h-[76px] w-[76px] items-center justify-center rounded-3xl bg-bad-tint">
            <Icon name="timer" size={38} color="var(--bad-text)" />
          </span>
          <strong className="font-display text-[26px] leading-tight">Time ran out while you were away</strong>
          <p className="text-[15px] leading-relaxed text-ink2">
            We submitted your {expired} answer{expired === 1 ? "" : "s"} at {new Date(Date.parse(s.deadlineAt!) - skew).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, when the time ended. Unanswered questions count as skipped.
          </p>
        </div>
        <div className="flex flex-col gap-2 px-[22px] pb-5">
          <Button full onClick={() => router.push(`/result?id=${id}`)}>See my result</Button>
          <Button full kind="ghost" onClick={() => router.push("/home")}>Go home</Button>
        </div>
      </Screen>
    );
  }

  const answered = Object.values(initial).filter((x) => x.choice != null).length;
  const left = resumeLeft;
  return (
    <Screen>
      <Runner d={driver} onDone={(url) => router.replace(url)} />
      {/* B11 */}
      <Sheet open={resumeOpen} onClose={() => setResumeOpen(false)} label="Resume session">
        <span className="font-mono text-[11px] font-bold tracking-wide text-accent-text">PICK UP WHERE YOU LEFT OFF</span>
        <strong className="font-display text-2xl leading-tight">{driver.subtitle} {MODE_LABEL[s.mode].toLowerCase()}</strong>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-0.5 rounded-[14px] bg-bg p-3">
            <strong className="font-mono text-xl">{answered}/{s.questions.length}</strong>
            <span className="text-xs text-ink2">answered</span>
          </div>
          {left != null && (
            <div className="flex flex-1 flex-col gap-0.5 rounded-[14px] bg-bg p-3">
              <strong className="font-mono text-xl text-bad-text">{fmtClock(left)}</strong>
              <span className="text-xs text-ink2">left</span>
            </div>
          )}
        </div>
        <Button full onClick={() => setResumeOpen(false)}>Resume</Button>
        <Button full kind="ghost" onClick={async () => { setResumeOpen(false); await driver.submit(false).then((u) => router.replace(u)).catch(() => {}); }}>Submit what I have</Button>
      </Sheet>
    </Screen>
  );
}
