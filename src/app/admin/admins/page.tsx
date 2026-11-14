"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { Gate } from "@/components/gate";
import { Field, Header, ago, inputCls, useMyCourses } from "@/components/admin/kit";
import { Dialog } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";

type Admin = { id: string; name: string | null; phone: string | null; email: string | null; role: "content_admin" | "super_admin"; courses: { id: string; code: string }[]; lastActive: string | null };
type Invite = { id: string; contact: string; role: string; courseIds: string[]; createdAt: string };

export default function AdminsPage() {
  return (
    <Gate need="super">
      <Admins />
    </Gate>
  );
}

/** G03: three roles only. Content admins are limited to the courses listed. */
function Admins() {
  const { me } = useAuth();
  const { data, reload } = useApi<{ admins: Admin[]; invites: Invite[] }>("/admin/admins");
  const { data: courses } = useMyCourses();
  const [open, setOpen] = useState(false);
  const code = (id: string) => courses?.courses.find((c) => c.id === id)?.code ?? "?";
  const ROLE = { super_admin: ["bg-chip", "text-on-chip", "SUPER"], content_admin: ["bg-accent-tint", "text-accent-text", "CONTENT"] } as const;

  return (
    <>
      <Header title="Admins"><Button size="md" icon="plus" onClick={() => setOpen(true)}>Invite admin</Button></Header>
      <main className="px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[2fr_1.2fr_2fr_1fr_120px] gap-5 border-b border-line px-6 py-4 font-mono text-[11px] tracking-wider text-ink3"><span>NAME</span><span>ROLE</span><span>COURSES</span><span>LAST UPLOAD</span><span /></div>
            {data?.admins.map((a) => (
              <div key={a.id} className="grid grid-cols-[2fr_1.2fr_2fr_1fr_120px] items-center gap-5 border-b border-line2 px-6 py-4 text-sm">
                <div className="flex flex-col"><strong>{a.name ?? "Not set up yet"}</strong><span className="text-xs text-ink3">{a.email ?? a.phone}</span></div>
                <span className={`justify-self-start rounded-md px-2 py-1 font-mono text-[11px] font-bold ${ROLE[a.role][0]} ${ROLE[a.role][1]}`}>{ROLE[a.role][2]}</span>
                <span className="text-[13px] text-ink2">{a.role === "super_admin" ? "All" : a.courses.map((c) => c.code).join(", ") || "None"}</span>
                <span className="text-[13px] text-ink2">{a.lastActive ? ago(a.lastActive) : "—"}</span>
                {a.id !== me?.id ? (
                  <Button kind="dangerGhost" size="sm" onClick={async () => { if (confirm(`Remove ${a.name ?? "this admin"}'s admin access?`)) { await api(`/admin/admins/${a.id}`, { method: "PATCH", body: { role: "student", courseIds: [] } }); reload(); } }}>Remove</Button>
                ) : <span />}
              </div>
            ))}
            {data?.invites.map((i) => (
              <div key={i.id} className="grid grid-cols-[2fr_1.2fr_2fr_1fr_120px] items-center gap-5 border-b border-line2 px-6 py-4 text-sm last:border-0">
                <div className="flex flex-col"><strong className="font-mono">{i.contact}</strong><span className="text-xs text-ink3">Invite sent {ago(i.createdAt)}</span></div>
                <span className="justify-self-start rounded-md bg-flag-tint px-2 py-1 font-mono text-[11px] font-bold text-flag-text">INVITED</span>
                <span className="text-[13px] text-ink2">{i.role === "super_admin" ? "All" : i.courseIds.map(code).join(", ")}</span>
                <span className="text-[13px] text-ink2">—</span>
                <Button kind="ghost" size="sm" onClick={async () => { await api(`/admin/invites/${i.id}`, { method: "DELETE" }); reload(); }}>Cancel</Button>
              </div>
            ))}
          </div>
        </div>
      </main>
      {open && <InviteDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: courses } = useMyCourses();
  const [contact, setContact] = useState("");
  const [role, setRole] = useState<"content_admin" | "super_admin">("content_admin");
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} label="Invite an admin">
      <strong className="font-display text-2xl">Invite an admin</strong>
      <Field label="Phone or email" hint="They sign in with the usual one-time code; the role applies on first sign-in.">
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+234 806 221 0934" className={inputCls} />
      </Field>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Role">
        {([["content_admin", "Content admin", "Upload, review and publish for chosen courses. Sees per-question stats."], ["super_admin", "Super admin", "Everything, including catalogue, admins, moderation and bans."]] as const).map(([k, t, d]) => (
          <button key={k} role="radio" aria-checked={role === k} onClick={() => setRole(k)} className={`flex gap-3 rounded-xl p-4 text-left ${role === k ? "border-2 border-accent bg-accent-tint" : "border-[1.5px] border-line"}`}>
            <span className={`mt-px h-5 w-5 flex-none rounded-full ${role === k ? "border-[6px] border-accent" : "border-2 border-line"}`} />
            <span className="flex flex-col gap-0.5"><strong className="text-sm">{t}</strong><span className="text-[12.5px] text-ink2">{d}</span></span>
          </button>
        ))}
      </div>
      {role === "content_admin" && (
        <Field label="Courses">
          <select multiple value={sel} onChange={(e) => setSel(Array.from(e.target.selectedOptions).map((o) => o.value))} className={`${inputCls} h-28 py-1 font-mono`}>
            {courses?.courses.map((c) => <option key={c.id} value={c.id}>{c.institution} · {c.code}</option>)}
          </select>
        </Field>
      )}
      {err && <span className="text-sm text-bad-text">{err}</span>}
      <div className="flex justify-end gap-2.5">
        <Button kind="outline" size="md" onClick={onClose}>Cancel</Button>
        <Button size="md" loading={busy} disabled={contact.trim().length < 5} onClick={async () => { setBusy(true); setErr(null); try { await api("/admin/admins/invite", { method: "POST", body: { contact, role, courseIds: sel } }); onDone(); } catch (e) { setErr((e as ApiError).message); setBusy(false); } }}>Send invite</Button>
      </div>
    </Dialog>
  );
}
