"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { odb, type OfflineAttempt, type OfflineQuestion } from "@/lib/offline";
import { bundleQuestions, gradeLocally } from "@/lib/grade-local";
import { syncAll } from "@/lib/sync";
import { Gate } from "@/components/gate";
import { KeyedBySearch } from "@/components/keyed";
import { Runner, type Driver } from "@/components/session/runner";
import { EmptyState, Screen } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icon";

/** Runs a session from a downloaded course with no connection. */
export default function PlayPage() {
  return (
    <Gate>
      <Suspense>
        <KeyedBySearch>
          <Play />
        </KeyedBySearch>
      </Suspense>
    </Gate>
  );
}

function Play() {
  const c = useSearchParams().get("c") ?? "";
  const router = useRouter();
  const [attempt, setAttempt] = useState<OfflineAttempt | null>(null);
  const [map, setMap] = useState<Map<string, OfflineQuestion> | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const a = await odb().offlineAttempts.get(c);
      if (!a) return setMissing(true);
      if (a.submittedAt) return router.replace(`/result?c=${c}`);
      const { map } = await bundleQuestions(a.courseId);
      setMap(map);
      setAttempt(a);
    })();
  }, [c, router]);

  const driver = useMemo<Driver | null>(() => {
    if (!attempt || !map) return null;
    const questions = attempt.questionIds
      .filter((id) => map.has(id))
      .map((id, n) => {
        const q = map.get(id)!;
        return { id, text: q.text, options: attempt.optionOrders[n].map((k) => ({ key: k, text: q.options[k] })), imageUrl: q.imageUrl, imageAlt: q.imageAlt, imageBytes: null, topicId: q.topicId };
      });
    return {
      mode: attempt.mode,
      title: attempt.mode === "exam" ? "Exam simulation · offline" : attempt.mode === "topic" ? "Topic practice · offline" : "Quick drill · offline",
      subtitle: attempt.title,
      questions,
      initial: attempt.answers,
      deadline: attempt.deadlineAt ? Date.parse(attempt.deadlineAt) : null,
      negativeMark: attempt.negativeMark,
      instantFeedback: attempt.mode === "topic",
      offline: true,
      save: (qid, a) => {
        odb().offlineAttempts.where("clientId").equals(c).modify((row) => {
          row.answers[qid] = a;
        });
      },
      check: async (qid, choice) => {
        const q = map.get(qid)!;
        const correct = choice != null && choice === q.correctOption;
        return { correct, xp: choice == null ? 0 : 1 + (correct ? 2 : 0), question: { ...q } };
      },
      submit: async (auto) => {
        const fresh = (await odb().offlineAttempts.get(c))!;
        const end = auto && fresh.deadlineAt ? Date.parse(fresh.deadlineAt) : Date.now();
        const graded = gradeLocally(fresh, map);
        await odb().offlineAttempts.update(c, {
          submittedAt: new Date(end).toISOString(),
          timeTakenSec: Math.max(1, Math.round((end - Date.parse(fresh.startedAt)) / 1000)),
          provisional: { score: graded.score, maxScore: graded.maxScore },
        });
        syncAll().catch(() => {});
        return `/result?c=${c}`;
      },
      onLeave: () => router.push("/home"),
    };
  }, [attempt, map, c, router]);

  if (missing) {
    return (
      <Screen>
        <EmptyState glyph="alert" title="This session isn't on this phone">It may have been cleared with the browser&apos;s data.</EmptyState>
        <div className="p-5"><Button full onClick={() => router.push("/home")}>Go home</Button></div>
      </Screen>
    );
  }
  if (!driver) return <Screen className="items-center justify-center"><Spinner size={32} color="var(--accent)" /></Screen>;
  return (
    <Screen>
      <Runner d={driver} onDone={(url) => router.replace(url)} />
    </Screen>
  );
}
