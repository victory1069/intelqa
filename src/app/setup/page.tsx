"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { takeNext } from "@/lib/next-url";
import { useApi } from "@/lib/use-api";
import { AppBar, Bar, EmptyState, Screen, Skeleton, Avatar } from "@/components/ui/kit";
import { contentLine } from "@/components/quiz-card";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icon";
import { Splash } from "@/components/gate";
import type { Me } from "@/lib/types";

type Inst = { id: string; name: string; shortCode: string; status: "live" | "draft"; liveCourses: number };
type Faculty = { id: string; name: string; departments: { id: string; name: string }[] };
type Course = { id: string; code: string; title: string; status: string; papers: number; quizzes: number; suggested: boolean };

const STEPS = ["Your school", "Faculty & department", "This semester's courses", "Your name"];

export default function Setup() {
  const { status, me } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "signedOut") router.replace("/welcome");
    if (me?.onboarded) router.replace("/home");
  }, [status, me, router]);
  if (status !== "signedIn" || !me || me.onboarded) return <Splash />;
  return <SetupForm me={me} />;
}

function SetupForm({ me }: { me: Me }) {
  const { refresh } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [instId, setInstId] = useState<string | null>(me.institution?.id ?? null);
  // A14: named in the error states, so the student knows their pick is kept.
  const [instName, setInstName] = useState<string | null>(me.institution?.name ?? null);
  const [deptId, setDeptId] = useState<string | null>(me.department?.id ?? null);
  const [picked, setCourseIds] = useState<Set<string> | null>(null);
  const [first, setFirst] = useState(me.firstName ?? "");
  const [last, setLast] = useState(me.surname ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Courses load from step 3 on; the department's courses start ticked until the student changes them.
  const coursesPath = step >= 2 && instId ? `/catalog/courses?institutionId=${instId}${deptId ? `&departmentId=${deptId}` : ""}&level=100` : null;
  const { data: courseData, error: courseError, reload: reloadCourses } = useApi<{ courses: Course[] }>(coursesPath);
  const courseIds = picked ?? (courseData ? new Set(courseData.courses.filter((c) => c.suggested).map((c) => c.id)) : null);

  async function next() {
    setError(null);
    setBusy(true);
    try {
      if (step === 0) await api("/me/profile", { method: "PATCH", body: { institutionId: instId } });
      if (step === 1) await api("/me/profile", { method: "PATCH", body: { departmentId: deptId, level: 100 } });
      if (step === 2) await api("/me/profile", { method: "PATCH", body: { courseIds: [...(courseIds ?? [])] } });
      if (step === 3) {
        await api("/me/profile", { method: "PATCH", body: { firstName: first.trim(), surname: last.trim() } });
        await refresh();
        router.replace(takeNext("/home"));
        return;
      }
      setStep(step + 1);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const canContinue = [!!instId, !!deptId, (courseIds?.size ?? 0) > 0, first.trim().length > 1 && last.trim().length > 1][step];
  const label = step === 2 ? `Continue with ${courseIds?.size ?? 0} course${courseIds?.size === 1 ? "" : "s"}` : step === 3 ? "Finish setup" : "Continue";

  return (
    <Screen>
      <AppBar title={STEPS[step]} sub={`Step ${step + 1} of 4${me.institution && step > 0 ? ` · ${me.institution.shortCode}` : ""}`} lead={step === 0 ? "none" : "back"} onLead={() => setStep(step - 1)} />
      <div className="px-[22px]">
        <Bar pct={((step + 1) / 4) * 100} height={4} />
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-[22px] pt-4">
        {step === 0 && <SchoolStep value={instId} selectedName={instName} onChange={(i) => { setInstId(i.id); setInstName(i.name); }} />}
        {step === 1 && instId && <DeptStep institutionId={instId} schoolName={instName} value={deptId} onChange={setDeptId} />}
        {step === 2 && instId && (courseError && !courseData ? (
          <NetworkError what="courses" schoolName={instName} onRetry={reloadCourses} />
        ) : (
          <CourseStep courses={courseData?.courses ?? null} value={courseIds} onChange={setCourseIds} />
        ))}
        {step === 3 && <NameStep first={first} last={last} setFirst={setFirst} setLast={setLast} dept={me.department?.name ?? ""} />}
      </div>
      <div className="flex flex-col gap-2 px-[22px] pt-3 pb-5">
        {error && <span className="text-sm text-bad-text" role="alert">{error}</span>}
        <Button full disabled={!canContinue} loading={busy} onClick={next}>{label}</Button>
      </div>
    </Screen>
  );
}

/** A14: a failed fetch during onboarding. The step and the picks already made are kept. */
function NetworkError({ what, schoolName, onRetry }: { what: string; schoolName: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState glyph="offline" title={`Couldn't load ${what}`}>
        Your connection dropped. {schoolName ? `${schoolName} is still selected. ` : ""}Try again when you have signal.
      </EmptyState>
      <Button full icon="refresh" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function SchoolStep({ value, selectedName, onChange }: { value: string | null; selectedName: string | null; onChange: (i: Inst) => void }) {
  const [q, setQ] = useState("");
  const [requested, setRequested] = useState(false);
  const { data, loading, error, reload } = useApi<{ institutions: Inst[] }>(`/catalog/institutions${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  const live = data?.institutions.filter((i) => i.status === "live") ?? [];
  const soon = data?.institutions.filter((i) => i.status !== "live") ?? [];
  // A09: schools this student already asked to be told about.
  const { data: waiting } = useApi<{ institutionIds: string[] }>(soon.length ? "/me/waitlist" : null);
  const [joinedNow, setJoinedNow] = useState<Set<string>>(() => new Set());
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joined = (id: string) => joinedNow.has(id) || !!waiting?.institutionIds.includes(id);

  async function join(id: string) {
    setJoining(id);
    setJoinError(null);
    try {
      await api("/me/waitlist", { method: "POST", body: { institutionId: id } });
      setJoinedNow((s) => new Set(s).add(id));
    } catch (e) {
      setJoinError((e as ApiError).message);
    } finally {
      setJoining(null);
    }
  }

  if (error && !data) return <NetworkError what="schools" schoolName={selectedName} onRetry={reload} />;

  return (
    <div className="flex flex-col gap-3.5">
      <label className="flex h-[52px] items-center gap-2.5 rounded-[14px] border-2 border-line bg-surface px-3.5 focus-within:border-accent">
        <Icon name="search" size={20} color="var(--ink3)" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setRequested(false); }} placeholder="Search universities" className="flex-1 bg-transparent text-[15px] outline-none" />
        {q && <button aria-label="Clear" onClick={() => setQ("")}><Icon name="close" size={18} color="var(--ink3)" /></button>}
      </label>
      {loading && !data && <Skeleton className="h-20 rounded-2xl" />}
      {data && !data.institutions.length && q.trim() && (
        <div className="flex flex-col gap-3">
          <EmptyState glyph="building" title="We're not there yet">
            Ask for your school and we&apos;ll text you when its past questions are live. The more requests a school gets, the sooner it&apos;s added.
          </EmptyState>
          <div className="flex flex-col gap-2">
            <Button full disabled={requested} onClick={async () => { await api("/catalog/institution-requests", { method: "POST", body: { name: q.trim() } }); setRequested(true); }}>
              {requested ? "Requested. We'll let you know." : `Request ${q.trim()}`}
            </Button>
            <Button full kind="ghost" onClick={() => { setQ(""); setRequested(false); }}>Back to the list</Button>
          </div>
        </div>
      )}
      {live.length > 0 && <span className="label">Available now</span>}
      {live.map((i) => {
        const on = value === i.id;
        return (
          <button key={i.id} onClick={() => onChange(i)} className={`flex items-center gap-3 rounded-2xl p-3.5 text-left ${on ? "border-2 border-accent bg-accent-tint" : "border border-line bg-surface"}`}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface font-mono text-[11px] font-bold text-accent-text">{i.shortCode.slice(0, 4)}</span>
            <span className="flex flex-1 flex-col gap-0.5">
              <strong className="text-[15px]">{i.name}</strong>
              <span className="text-[13px] text-ink2">{i.shortCode} · {i.liveCourses} course{i.liveCourses === 1 ? "" : "s"} live</span>
            </span>
            {on && <Icon name="check" size={22} color="var(--accent-text)" weight={2.6} />}
          </button>
        );
      })}
      {soon.length > 0 && <span className="label pt-1.5">Coming soon</span>}
      {soon.length > 0 && (
        <div className="flex flex-col rounded-2xl border border-line bg-surface">
          {soon.map((i, n) => {
            const on = joined(i.id);
            return (
              <button
                key={i.id}
                disabled={on || joining === i.id}
                onClick={() => join(i.id)}
                aria-label={on ? `${i.name}: on the waitlist` : `Join the waitlist for ${i.name}`}
                className={`flex items-center gap-3 px-3.5 py-3 text-left ${n ? "border-t border-line2" : ""}`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-raised font-mono text-[10px] font-bold text-ink3">{i.shortCode.slice(0, 4)}</span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] text-ink2">{i.name}</span>
                  <span className={`text-xs ${on ? "font-semibold text-ok-text" : "text-accent-text"}`}>{on ? "On the waitlist. We'll text you when it opens." : "Join the waitlist"}</span>
                </span>
                {joining === i.id ? <Spinner size={18} color="var(--accent)" /> : on ? <Icon name="check" size={18} color="var(--ok-text)" weight={2.6} /> : <Icon name="plus" size={18} color="var(--accent-text)" />}
              </button>
            );
          })}
        </div>
      )}
      {joinError && <span className="text-sm text-bad-text" role="alert">{joinError}</span>}
    </div>
  );
}

function DeptStep({ institutionId, schoolName, value, onChange }: { institutionId: string; schoolName: string | null; value: string | null; onChange: (id: string) => void }) {
  const { data, error, reload } = useApi<{ faculties: Faculty[] }>(`/catalog/institutions/${institutionId}/faculties`);
  const [openPick, setOpen] = useState<string | null | undefined>(undefined);
  // Starts with the student's faculty expanded.
  const open = openPick !== undefined ? openPick : (data?.faculties.find((f) => f.departments.some((d) => d.id === value))?.id ?? null);

  if (error && !data) return <NetworkError what="departments" schoolName={schoolName ?? "Your school"} onRetry={reload} />;
  if (!data) return <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[52px] rounded-[14px]" />)}</div>;

  return (
    <div className="flex flex-col gap-2">
      {data.faculties.map((f) => {
        const expanded = open === f.id;
        return (
          <div key={f.id} className={`overflow-hidden rounded-2xl bg-surface ${expanded ? "border-2 border-accent" : "border border-line"}`}>
            <button className="flex h-[52px] w-full items-center gap-3 px-3.5 text-left" onClick={() => setOpen(expanded ? null : f.id)} aria-expanded={expanded}>
              <span className={`flex-1 text-[15px] ${expanded ? "font-bold" : ""}`}>{f.name}</span>
              <Icon name={expanded ? "chevU" : "chevD"} size={18} color={expanded ? "var(--accent-text)" : "var(--ink3)"} />
            </button>
            {expanded && (
              <div className="flex flex-col px-2 pb-2" role="radiogroup">
                {f.departments.map((d) => {
                  const on = value === d.id;
                  return (
                    <button key={d.id} role="radio" aria-checked={on} onClick={() => onChange(d.id)} className={`flex h-[46px] items-center gap-3 rounded-[10px] px-2.5 text-left ${on ? "bg-accent-tint" : ""}`}>
                      <span className={`h-5 w-5 flex-none rounded-full ${on ? "border-[6px] border-accent" : "border-2 border-line"}`} />
                      <span className={`flex-1 text-[15px] ${on ? "font-semibold" : ""}`}>{d.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CourseStep({ courses, value, onChange }: { courses: Course[] | null; value: Set<string> | null; onChange: (s: Set<string>) => void }) {
  const sorted = useMemo(() => [...(courses ?? [])].sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.code.localeCompare(b.code)), [courses]);

  if (!courses) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="mb-2 h-3.5 w-3/5" />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[62px] rounded-[14px]" />)}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="pb-1 text-sm text-ink2">{value?.size ?? 0} selected. You can change these any time.</span>
      {sorted.map((c) => {
        const on = value?.has(c.id) ?? false;
        return (
          <button
            key={c.id}
            role="checkbox"
            aria-checked={on}
            onClick={() => { const s = new Set(value); if (on) s.delete(c.id); else s.add(c.id); onChange(s); }}
            className={`flex items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-left ${on ? "border-2 border-accent bg-accent-tint" : "border-[1.5px] border-line bg-surface"}`}
          >
            <span className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] ${on ? "bg-accent" : "border-2 border-line"}`}>
              {on && <Icon name="check" size={15} color="var(--on-accent)" weight={3} />}
            </span>
            <span className="flex flex-1 flex-col gap-px">
              <span className="font-mono text-[13px] font-bold">{c.code}</span>
              <span className="text-[13px] text-ink2">{c.title}</span>
            </span>
            {contentLine(c) ? (
              <span className="text-right text-xs text-ink2">{contentLine(c)}</span>
            ) : (
              <span className="rounded-md bg-flag-tint px-1.5 py-0.5 font-mono text-[11px] font-bold text-flag-text">SOON</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NameStep({ first, last, setFirst, setLast, dept }: { first: string; last: string; setFirst: (s: string) => void; setLast: (s: string) => void; dept: string }) {
  const full = `${first.trim()} ${last.trim()}`.trim() || "Your name";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] leading-relaxed text-ink2">Use your real name. It&apos;s what your coursemates will see on the leaderboard.</p>
      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">First name</span>
        <input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" className="h-[54px] rounded-[14px] border-2 border-line bg-surface px-3.5 text-base outline-none focus:border-accent" />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Surname</span>
        <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" className="h-[54px] rounded-[14px] border-2 border-line bg-surface px-3.5 text-base outline-none focus:border-accent" />
      </label>
      <span className="label pt-1.5">Preview</span>
      <div className="flex items-center gap-3 rounded-[14px] bg-accent-tint px-3.5 py-3">
        <span className="w-[34px] font-mono text-sm font-bold text-accent-text">#38</span>
        <Avatar name={full} size={36} me />
        <span className="flex flex-1 flex-col">
          <strong className="text-[15px]">{full}</strong>
          <span className="text-xs text-ink2">{dept ? `${dept} · 100L` : "100L"}</span>
        </span>
        <span className="font-mono text-sm font-bold">74%</span>
      </div>
    </div>
  );
}
