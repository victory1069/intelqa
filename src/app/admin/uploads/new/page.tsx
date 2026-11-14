"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Field, Header, Panel, inputCls, useMyCourses } from "@/components/admin/kit";
import { Banner } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Page = { id: string; file: File; url: string | null; hash: string; blur: number | null };

const ACCEPT = ".pdf,.docx,.txt,image/jpeg,image/png,image/webp";

type Config = { storage: "supabase" | "local"; extractor: "claude" | "local" };
const isImage = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|hei[cf])$/i.test(f.name);
const MAX = 40 * 1024 * 1024;

function sessions(extra?: string) {
  const y = new Date().getFullYear();
  const list = Array.from({ length: 12 }, (_, i) => `${y - i}/${y - i + 1}`);
  return extra && !list.includes(extra) ? [...list, extra].sort().reverse() : list;
}

type Detected = { courseCodes: string[]; session: string | null; semester: 1 | 2 | null; examType: "exam" | "test" | "post_utme" | null };
const code = (s: string) => s.replace(/\s+/g, "").toUpperCase();

async function sha(file: File) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Variance of the Laplacian on a small greyscale copy. Low values mean a blurry photo. */
async function blurScore(file: File): Promise<number | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const w = 320, h = Math.round((bmp.height / bmp.width) * 320);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        sum += v; sum2 += v * v; n++;
      }
    const mean = sum / n;
    return sum2 / n - mean * mean;
  } catch {
    return null;
  }
}

const BLURRY = 35;

/** F05 / F06 */
export default function NewUpload() {
  const router = useRouter();
  const { data: mine } = useMyCourses();
  const { data: config } = useApi<Config>("/admin/uploads/config");
  const aiOff = config?.extractor === "local";
  const [pages, setPages] = useState<Page[]>([]);
  const [key, setKey] = useState<File | null>(null);
  const [courseId, setCourseId] = useState("");
  const [session, setSession] = useState("");
  const [semester, setSemester] = useState("1");
  const [examType, setExamType] = useState("exam");
  const [timeLimit, setTimeLimit] = useState("60");
  const [optionCount, setOptionCount] = useState(4);
  const [penalty, setPenalty] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [filled, setFilled] = useState<string[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLDivElement>(null);

  /** Fills empty fields from the paper's name and header ("GST 111 … 2019/2020 First Semester"). */
  async function detect(f: File) {
    const fd = new FormData();
    fd.append("file", f);
    const d = await api<Detected>("/admin/uploads/detect", { method: "POST", body: fd }).catch(() => null);
    if (!d) return;
    const got: string[] = [];
    const course = mine?.courses.find((c) => d.courseCodes.some((k) => code(k) === code(c.code)));
    if (course && !courseId) {
      pickCourse(course.id);
      got.push(`course ${course.code}`);
    }
    setNotFound(!course && d.courseCodes.length ? d.courseCodes[0] : null);
    if (d.session && !session) {
      setSession(d.session);
      got.push(`session ${d.session}`);
    }
    if (d.semester) {
      setSemester(String(d.semester));
      got.push(d.semester === 1 ? "first semester" : "second semester");
    }
    if (d.examType && d.examType !== "exam") {
      setExamType(d.examType);
      got.push(d.examType === "test" ? "test (CA)" : "Post-UTME");
    }
    setFilled(got);
  }

  function pickCourse(id: string) {
    setCourseId(id);
    const c = mine?.courses.find((x) => x.id === id);
    if (c) {
      setOptionCount(c.optionCount);
      setPenalty(String(c.negativeMark));
    }
  }

  function goToForm() {
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const first = !courseId ? "f-course" : !session ? "f-session" : "f-time";
    setTimeout(() => document.getElementById(first)?.focus({ preventScroll: true }), 350);
  }

  useEffect(() => () => pages.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [pages]);

  async function add(files: FileList | File[]) {
    const next: Page[] = [];
    for (const f of Array.from(files)) {
      next.push({ id: `${f.name}-${f.size}-${Math.random()}`, file: f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null, hash: await sha(f), blur: await blurScore(f) });
    }
    const firstFile = pages.length === 0 ? next[0]?.file : undefined;
    setPages((p) => [...p, ...next]);
    if (firstFile) void detect(firstFile);
  }

  const problems = useMemo(() => {
    const out: { page?: number; msg: string }[] = [];
    const seen = new Map<string, number>();
    let size = 0;
    pages.forEach((p, i) => {
      size += p.file.size;
      if (/heic|heif/i.test(p.file.type) || /\.hei[cf]$/i.test(p.file.name)) out.push({ page: i, msg: `Page ${i + 1} · iPhone HEIC isn't supported. Export it as JPG.` });
      if (aiOff && isImage(p.file)) out.push({ page: i, msg: `Page ${i + 1} · photos need AI reading (ANTHROPIC_API_KEY). Upload the typed DOCX/PDF instead.` });
      if (p.blur != null && p.blur < BLURRY) out.push({ page: i, msg: `Page ${i + 1} · too blurry to read. Retake it.` });
      if (seen.has(p.hash)) out.push({ page: i, msg: `Page ${i + 1} · same as page ${seen.get(p.hash)! + 1}. Remove it?` });
      else seen.set(p.hash, i);
    });
    if (size + (key?.size ?? 0) > MAX) out.push({ msg: "Uploads are limited to 40 MB in total." });
    if (aiOff && key && isImage(key)) out.push({ msg: "The answer key is a photo; without ANTHROPIC_API_KEY, add it as a typed file or put the answers in the paper." });
    return out;
  }, [pages, key, aiOff]);
  const missing = [!courseId && "Course", !session && "Session", !(Number(timeLimit) > 0) && "Time limit"].filter(Boolean) as string[];
  const ready = pages.length > 0 && !problems.length && !missing.length;

  async function start() {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    pages.forEach((p) => fd.append("files", p.file));
    if (key) fd.append("answerKey", key);
    Object.entries({ courseId, session, semester, examType, timeLimitMin: timeLimit, optionCount: String(optionCount), negativeMark: penalty }).forEach(([k, v]) => fd.append(k, v));
    try {
      const r = await api<{ id: string }>("/admin/uploads", { method: "POST", body: fd });
      router.push(`/admin/uploads/view?id=${r.id}`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  function move(from: number, to: number) {
    setPages((p) => {
      const a = [...p];
      const [x] = a.splice(from, 1);
      a.splice(to, 0, x);
      return a;
    });
  }

  return (
    <>
      <Header eyebrow="Uploads / New" title="Upload a past paper">
        <ButtonLink href="/admin/uploads" kind="outline" size="md">Cancel</ButtonLink>
        <Button size="md" disabled={!ready} loading={busy} onClick={start}>Start processing</Button>
      </Header>
      {(problems.length > 0 || (pages.length > 0 && missing.length > 0)) && (
        <div className="mx-5 mt-8 flex items-start sm:mx-8 lg:mx-12 gap-3 rounded-[14px] bg-bad-tint px-4 py-5 text-sm text-bad-text" role="alert">
          <Icon name="alert" size={20} />
          <div className="flex flex-col gap-1">
            <strong>{problems.length + (missing.length ? 1 : 0)} thing{problems.length + (missing.length ? 1 : 0) === 1 ? "" : "s"} to fix before processing</strong>
            <span>{problems.map((p) => p.msg).join(" · ")}</span>
            {missing.length > 0 && (
              <span>
                Choose the {missing.join(" and ").toLowerCase()} in the paper details{" "}
                <button type="button" onClick={goToForm} className="font-semibold underline underline-offset-2">
                  <span className="lg:hidden">below</span><span className="hidden lg:inline">on the right</span>
                </button>
                .
              </span>
            )}
          </div>
        </div>
      )}
      {err && (
        <div className="mx-5 mt-6 sm:mx-8 lg:mx-12">
          <Banner tone="bad" icon="alert" action={/already uploaded/.test(err) ? <ButtonLink href="/admin/uploads" kind="outline" size="sm">See uploads</ButtonLink> : undefined}>{err}</Banner>
        </div>
      )}
      {config && (aiOff || config.storage === "local") && (
        <div className="mx-5 mt-6 sm:mx-8 lg:mx-12">
          <Banner
            tone="warn"
            icon="info"
            action={<button type="button" onClick={() => setNoteOpen((v) => !v)} aria-expanded={noteOpen} className="font-semibold whitespace-nowrap underline underline-offset-2">{noteOpen ? "Hide" : "Details"}</button>}
          >
            <strong>Testing mode</strong>
            {!noteOpen && <> · {aiOff ? "typed papers only, read on this computer" : "files saved on this computer"}</>}
            {noteOpen && <span className="mt-2 block">
            {aiOff && <>No ANTHROPIC_API_KEY, so typed papers (DOCX, TXT, PDF with selectable text) are read by the built-in parser: numbered questions, options marked with letters, roman numerals, numbers, bullets or nothing, and answers under each question, marked on an option, or in an answer key anywhere in the paper. No explanations or topics are drafted, and photos can&apos;t be read. </>}
            {config.storage === "local" && <>Files are saved on this computer in .local-storage, not Supabase.</>}
            </span>}
          </Banner>
        </div>
      )}
      <main className="grid gap-8 lg:grid-cols-[1.1fr_1fr] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <div className="flex min-w-0 flex-col gap-5">
          <button
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
            className={`flex h-[150px] flex-col items-center justify-center gap-3 rounded-[18px] px-4 text-center border-2 border-dashed ${over ? "border-accent bg-accent-tint" : "border-accent/60 bg-accent-tint/60"}`}
          >
            <Icon name="upload" size={28} color="var(--accent-text)" />
            <strong className="text-[15px] text-accent-text">Drop files or browse</strong>
            <span className="text-[13px] text-ink2">{aiOff ? "Typed PDF, DOCX or TXT · up to 40 MB" : "PDF, DOCX, or several JPG/PNG pages · up to 40 MB"}</span>
          </button>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && add(e.target.files)} />

          {pages.length > 0 && (
            <>
              <span className="label">Question paper · {pages.length} file{pages.length === 1 ? "" : "s"} · drag to reorder</span>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {pages.map((p, i) => {
                  const bad = problems.some((x) => x.page === i);
                  return (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={() => setDrag(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (drag != null && drag !== i) move(drag, i); setDrag(null); }}
                      className="group relative flex cursor-grab flex-col gap-1.5"
                    >
                      <div className={`relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-[#FBFAF6] ${bad ? "border-2 border-bad" : "border border-line"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.url ? <img src={p.url} alt="" className="h-full w-full object-cover" /> : <Icon name="file" size={24} color="#6B6980" />}
                        <span className="absolute right-1 bottom-1 rounded bg-white/80 px-1 font-mono text-[9px] text-[#6B6980]">{i + 1}</span>
                      </div>
                      <button onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))} className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md bg-chip md:hidden md:group-hover:flex" aria-label={`Remove page ${i + 1}`}>
                        <Icon name="close" size={14} color="#FFFFFF" />
                      </button>
                      <span className="truncate text-center font-mono text-[10px] text-ink3">{p.file.name}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <span className="label pt-1.5">Answer key · optional</span>
          {key ? (
            <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-line bg-surface px-5 py-4">
              <Icon name="image" size={20} color="var(--ink2)" />
              <div className="flex min-w-0 flex-1 flex-col"><span className="truncate text-sm font-semibold">{key.name}</span><span className="text-xs text-ink3">{(key.size / 1024 / 1024).toFixed(1)} MB</span></div>
              <button onClick={() => setKey(null)} aria-label="Remove answer key"><Icon name="trash" size={18} color="var(--ink3)" /></button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-line px-5 py-4 text-sm text-ink2">
              <Icon name="plus" size={18} />Add a separate answer key, if the answers aren&apos;t in the paper
              <input type="file" accept={ACCEPT} hidden onChange={(e) => setKey(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        <div ref={form} className="min-w-0 scroll-mt-20 self-start">
        <Panel className="flex min-w-0 flex-col gap-5 p-6 lg:p-8">
          <span className="label">Paper details</span>
          {filled.length > 0 && (
            <span className="flex items-start gap-2 rounded-[10px] bg-ok-tint px-3 py-2 text-[13px] text-ok-text">
              <Icon name="check" size={16} weight={2.6} />Filled in from the paper: {filled.join(", ")}. Check they&apos;re right.
            </span>
          )}
          {notFound && !courseId && (
            <span className="rounded-[10px] bg-flag-tint px-3 py-2 text-[13px] text-flag-text">
              The paper says {notFound}, which isn&apos;t one of your courses. Pick the course, or ask a super admin to add it.
            </span>
          )}
          <Field label="Course" error={pages.length && !courseId ? "Required" : null}>
            <select id="f-course" value={courseId} onChange={(e) => pickCourse(e.target.value)} className={inputCls}>
              <option value="">Choose a course</option>
              {mine?.courses.map((c) => <option key={c.id} value={c.id}>{c.institution} · {c.code} · {c.title}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Session" hint='Shown as "2023/2024" to students' error={pages.length && !session ? "Required" : null}>
              <select id="f-session" value={session} onChange={(e) => setSession(e.target.value)} className={inputCls}>
                <option value="">Choose a session</option>
                {sessions(session).map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Semester">
              <select value={semester} onChange={(e) => setSemester(e.target.value)} className={inputCls}><option value="1">First</option><option value="2">Second</option></select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Exam type">
              <select value={examType} onChange={(e) => setExamType(e.target.value)} className={inputCls}><option value="exam">Exam</option><option value="test">Test (CA)</option><option value="post_utme">Post-UTME</option></select>
            </Field>
            <Field label="Time limit (minutes)">
              <input id="f-time" type="number" min={1} max={300} value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} className={`${inputCls} font-mono`} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Options">
              <div className="flex rounded-[10px] bg-raised p-[3px]">
                {[4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setOptionCount(n)} className={`h-9 flex-1 rounded-lg text-[13px] ${optionCount === n ? "bg-surface font-semibold shadow-card" : "text-ink2"}`}>{n === 4 ? "A–D" : "A–E"}</button>
                ))}
              </div>
            </Field>
            <Field label="Wrong answer penalty">
              <select value={penalty} onChange={(e) => setPenalty(e.target.value)} className={`${inputCls} font-mono`}>
                <option value="0">0 (none)</option><option value="0.25">−0.25</option><option value="0.33">−0.33</option><option value="0.5">−0.5</option><option value="1">−1</option>
              </select>
            </Field>
          </div>
        </Panel>
        </div>
      </main>
    </>
  );
}
