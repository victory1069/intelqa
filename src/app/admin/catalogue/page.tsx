"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Gate } from "@/components/gate";
import { Field, Header, Panel, Status, inputCls } from "@/components/admin/kit";
import { Dialog } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Dept = { id: string; name: string };
type Faculty = { id: string; name: string; departments: Dept[] };
type Course = { id: string; code: string; title: string; level: number; semester: number; optionCount: number; negativeMark: number; status: string; questions: number; papers: number; students: number; departmentIds: string[] };
type Inst = { id: string; name: string; shortCode: string; status: string; faculties: Faculty[]; courses: Course[] };
type Topic = { id: string; name: string; position: number };

export default function CataloguePage() {
  return (
    <Gate need="super">
      <Catalogue />
    </Gate>
  );
}

/** G01 / G02 */
function Catalogue() {
  const { data, reload } = useApi<{ institutions: Inst[] }>("/admin/catalogue");
  const [instId, setInstId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "institution" | "faculty" | "department" | "course">(null);
  const inst = data?.institutions.find((i) => i.id === instId) ?? data?.institutions[0];
  const course = inst?.courses.find((c) => c.id === courseId) ?? null;

  return (
    <div className="flex flex-col lg:h-dvh">
      <Header title="Catalogue">
        <Button kind="outline" size="md" icon="plus" onClick={() => setDialog("institution")}>Add institution</Button>
      </Header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_1fr]">
        <aside className="flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto border-b border-line bg-surface px-3 py-5 lg:max-h-none lg:border-r lg:border-b-0">
          {data?.institutions.map((i) => {
            const open = i.id === inst?.id;
            return (
              <div key={i.id} className="flex flex-col gap-0.5">
                <button onClick={() => { setInstId(i.id); setCourseId(null); }} className="flex h-9 items-center gap-2 rounded-[9px] px-2.5 text-left text-[13.5px] font-bold">
                  <Icon name={open ? "chevD" : "chevR"} size={14} color="var(--ink3)" />
                  <span className="flex-1 truncate">{i.name}</span>
                  <span className="font-mono text-[11px] text-ink3">{i.status === "live" ? i.courses.length : "draft"}</span>
                </button>
                {open && (
                  <>
                    {i.courses.map((c) => (
                      <button key={c.id} onClick={() => setCourseId(c.id)} className={`flex h-9 items-center gap-2 rounded-[9px] pr-2.5 pl-8 text-left text-[13.5px] ${c.id === courseId ? "bg-accent-tint font-bold text-accent-text" : "font-medium"}`}>
                        <Icon name="book" size={14} color="var(--ink3)" />
                        <span className="flex-1 truncate">{c.code} · {c.title}</span>
                        <span className="font-mono text-[11px] text-ink3">{c.questions}</span>
                      </button>
                    ))}
                    <button onClick={() => setDialog("course")} className="h-8 pl-8 text-left text-[13px] font-semibold text-accent-text">+ Add course</button>
                    <span className="label px-2.5 pt-3">Faculties &amp; departments</span>
                    {i.faculties.map((f) => (
                      <div key={f.id} className="flex flex-col pl-3 text-[13px]">
                        <span className="py-1 font-semibold">{f.name}</span>
                        {f.departments.map((d) => <span key={d.id} className="py-0.5 pl-3 text-ink2">{d.name}</span>)}
                      </div>
                    ))}
                    <div className="flex gap-3 px-3 py-2">
                      <button onClick={() => setDialog("faculty")} className="text-[13px] font-semibold text-accent-text">+ Faculty</button>
                      <button onClick={() => setDialog("department")} className="text-[13px] font-semibold text-accent-text">+ Department</button>
                    </div>
                    {i.status !== "live" && (
                      <Button size="sm" kind="tonal" onClick={async () => { await api(`/admin/institutions/${i.id}`, { method: "PATCH", body: { status: "live" } }); reload(); }}>Open {i.shortCode} to students</Button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </aside>
        <section className="overflow-y-auto px-5 py-8 sm:px-8 lg:px-10">
          {course && inst ? <CourseDetail key={course.id} inst={inst} course={course} onChanged={reload} /> : <span className="text-sm text-ink2">Pick a course on the left to manage its topics and format.</span>}
        </section>
      </div>
      {dialog && inst && <AddDialog kind={dialog} inst={inst} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
    </div>
  );
}

function CourseDetail({ inst, course, onChanged }: { inst: Inst; course: Course; onChanged: () => void }) {
  const { data, reload } = useApi<{ topics: Topic[] }>(`/catalog/courses/${course.id}/topics`);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-[11px] tracking-wide text-ink3">{inst.shortCode} · {course.level}L · {course.semester === 1 ? "FIRST" : "SECOND"} SEMESTER</span>
          <strong className="font-display text-[26px]">{course.code} · {course.title}</strong>
        </div>
        <Status s={course.status === "live" ? "live" : "draft"} />
      </div>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        {[["Papers", course.papers], ["Questions", course.questions], ["Students", course.students], ["Format", `${course.optionCount === 5 ? "A–E" : "A–D"}${course.negativeMark ? ` −${course.negativeMark}` : ""}`]].map(([l, v]) => (
          <Panel key={l} className="flex flex-col gap-0.5 p-5"><span className="text-xs text-ink2">{l}</span><strong className="font-display text-2xl">{v}</strong></Panel>
        ))}
      </div>
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-4">
          <strong className="flex-1 basis-full text-[15px] sm:basis-auto">Topics · {data?.topics.length ?? 0}</strong>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New topic" className={`${inputCls} h-9 min-w-0 flex-1 sm:flex-none`} />
          <Button size="sm" kind="ghost" icon="plus" disabled={name.trim().length < 2} onClick={async () => { await api(`/admin/courses/${course.id}/topics`, { method: "POST", body: { name: name.trim() } }); setName(""); reload(); onChanged(); }}>Add topic</Button>
        </div>
        {data?.topics.map((t, i) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-line2 px-4 py-2.5 text-sm last:border-0">
            <span className="w-6 font-mono text-xs text-ink3">{i + 1}</span>
            {editing === t.id ? (
              <>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${inputCls} h-9 min-w-0 flex-1`} autoFocus />
                <Button size="sm" onClick={async () => { await api(`/admin/topics/${t.id}`, { method: "PATCH", body: { name: editName.trim() } }); setEditing(null); reload(); }}>Save</Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 break-words">{t.name}</span>
                <button aria-label={`Rename ${t.name}`} onClick={() => { setEditing(t.id); setEditName(t.name); }}><Icon name="edit" size={16} color="var(--ink3)" /></button>
                <button aria-label={`Delete ${t.name}`} onClick={async () => { if (confirm(`Delete "${t.name}"? Its questions become untagged.`)) { await api(`/admin/topics/${t.id}`, { method: "DELETE" }); reload(); } }}><Icon name="trash" size={16} color="var(--ink3)" /></button>
              </>
            )}
          </div>
        ))}
      </Panel>
      <span className="text-xs text-ink3">Topics drive tagging, topic practice and the breakdown on results.</span>
    </div>
  );
}

function AddDialog({ kind, inst, onClose, onDone }: { kind: "institution" | "faculty" | "department" | "course"; inst: Inst; onClose: () => void; onDone: () => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [facultyId, setFacultyId] = useState(inst.faculties[0]?.id ?? "");
  const [depts, setDepts] = useState<string[]>([]);
  const [format, setFormat] = useState<"ad" | "ae">("ad");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allDepts = inst.faculties.flatMap((f) => f.departments);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (kind === "institution") await api("/admin/institutions", { method: "POST", body: { name: a, shortCode: b } });
      if (kind === "faculty") await api("/admin/faculties", { method: "POST", body: { institutionId: inst.id, name: a } });
      if (kind === "department") await api("/admin/departments", { method: "POST", body: { facultyId, name: a } });
      if (kind === "course")
        await api("/admin/courses", { method: "POST", body: { institutionId: inst.id, code: a, title: b, departmentIds: depts, optionCount: format === "ae" ? 5 : 4, negativeMark: format === "ae" ? 0.25 : 0 } });
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} label={`Add ${kind}`}>
      <strong className="font-display text-2xl capitalize">Add {kind === "course" ? "a course" : `a ${kind}`}</strong>
      {kind === "institution" && (<><Field label="Name"><input value={a} onChange={(e) => setA(e.target.value)} className={inputCls} /></Field><Field label="Short code" hint="UNILORIN, UI, OAU…"><input value={b} onChange={(e) => setB(e.target.value)} className={`${inputCls} font-mono`} /></Field></>)}
      {kind === "faculty" && <Field label="Faculty name"><input value={a} onChange={(e) => setA(e.target.value)} className={inputCls} /></Field>}
      {kind === "department" && (
        <>
          <Field label="Faculty"><select value={facultyId} onChange={(e) => setFacultyId(e.target.value)} className={inputCls}>{inst.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
          <Field label="Department name"><input value={a} onChange={(e) => setA(e.target.value)} className={inputCls} /></Field>
        </>
      )}
      {kind === "course" && (
        <>
          <div className="grid gap-5 sm:grid-cols-[1fr_2fr]">
            <Field label="Code"><input value={a} onChange={(e) => setA(e.target.value)} placeholder="STA 111" className={`${inputCls} font-mono`} /></Field>
            <Field label="Title"><input value={b} onChange={(e) => setB(e.target.value)} placeholder="Descriptive Statistics" className={inputCls} /></Field>
          </div>
          <Field label="Taken by" hint="These departments get it pre-ticked during setup.">
            <select multiple value={depts} onChange={(e) => setDepts(Array.from(e.target.selectedOptions).map((o) => o.value))} className={`${inputCls} h-28 py-1`}>
              {allDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Default exam format">
            <div className="flex gap-2">
              {([["ad", "A–D · no penalty"], ["ae", "A–E · −0.25"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFormat(k)} className={`h-[42px] flex-1 rounded-[10px] text-[13px] ${format === k ? "border-2 border-accent bg-accent-tint font-semibold" : "border-[1.5px] border-line"}`}>{l}</button>
              ))}
            </div>
          </Field>
          <span className="text-[13px] text-ink3">Saved as a draft. Students won&apos;t see it until a paper is published.</span>
        </>
      )}
      {err && <span className="text-sm text-bad-text">{err}</span>}
      <div className="flex justify-end gap-2.5">
        <Button kind="outline" size="md" onClick={onClose}>Cancel</Button>
        <Button size="md" loading={busy} disabled={!a.trim()} onClick={save}>Add</Button>
      </div>
    </Dialog>
  );
}
