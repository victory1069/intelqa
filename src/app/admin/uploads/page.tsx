"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApi } from "@/lib/use-api";
import { Header, Status, ago } from "@/components/admin/kit";
import { ButtonLink } from "@/components/ui/button";
import { Pill } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";

type Upload = { id: string; courseCode: string; session: string; semester: number; examType: string; status: string; progress: { step: number; total: number; label: string } | null; error: string | null; pages: number; source: string | null; uploadedBy: string; createdAt: string; paperId: string | null };

const SOURCE = (mime: string | null, n: number) =>
  !mime ? "—" : mime === "application/pdf" ? "PDF" : mime.includes("word") ? "DOCX" : mime.startsWith("image/") ? `${n} photo${n === 1 ? "" : "s"}` : "Text";

export default function UploadsPage() {
  return (
    <Suspense>
      <Uploads />
    </Suspense>
  );
}

/** F04: every upload with its pipeline status. */
function Uploads() {
  const initial = useSearchParams().get("status") ?? "";
  const [status, setStatus] = useState(initial);
  const { data } = useApi<{ uploads: Upload[]; counts: Record<string, number> }>("/admin/uploads");
  const all = data?.uploads ?? [];
  const list = all.filter((u) => !status || u.status === status);
  const c = data?.counts ?? {};

  return (
    <>
      <Header title={status === "in_review" ? "Review queue" : "Uploads"}>
        <ButtonLink href="/admin/uploads/new" icon="upload" size="md">New upload</ButtonLink>
      </Header>
      <div className="flex flex-wrap gap-1.5 px-5 pt-8 sm:px-8 lg:px-12">
        <Pill on={!status} onClick={() => setStatus("")}>All {all.length}</Pill>
        <Pill on={status === "processing"} onClick={() => setStatus("processing")}>Processing {c.processing ?? 0}</Pill>
        <Pill on={status === "in_review"} onClick={() => setStatus("in_review")}>In review {c.in_review ?? 0}</Pill>
        <Pill on={status === "published"} onClick={() => setStatus("published")}>Published {c.published ?? 0}</Pill>
        <Pill on={status === "failed"} onClick={() => setStatus("failed")}>Failed {c.failed ?? 0}</Pill>
      </div>
      <main className="px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="hidden grid-cols-[2.2fr_1fr_1fr_1.4fr_1fr_40px] gap-5 border-b md:grid border-line px-6 py-4 font-mono text-[11px] tracking-wider text-ink3">
            <span>PAPER</span><span>TYPE</span><span>SOURCE</span><span>STATUS</span><span>UPLOADED</span><span />
          </div>
          {list.map((u) => (
            <Link
              key={u.id}
              href={u.status === "in_review" && u.paperId ? `/admin/review?paper=${u.paperId}` : `/admin/uploads/view?id=${u.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line2 px-4 py-4 text-sm last:border-0 hover:bg-bg md:grid md:grid-cols-[2.2fr_1fr_1fr_1.4fr_1fr_40px] md:gap-y-3 md:px-7"
            >
              <div className="flex w-full flex-col gap-0.5 md:w-auto"><strong>{u.courseCode} · {u.session}</strong><span className="text-xs text-ink3">{["First", "Second", "Third"][u.semester - 1]} semester · by {u.uploadedBy}</span></div>
              <span className="text-ink2 capitalize">{u.examType.replace("_", "-")}</span>
              <span className="text-ink2">{SOURCE(u.source, u.pages)}</span>
              <div className="order-last flex w-full flex-col items-start gap-1 md:order-none md:w-auto">
                <Status s={u.status} />
                <span className="text-[11.5px] text-ink3">{u.status === "processing" ? (u.progress ? `Step ${u.progress.step} of ${u.progress.total} · ${u.progress.label}` : "Starting") : u.error ?? ""}</span>
              </div>
              <span className="text-[13px] text-ink2">{ago(u.createdAt)}</span>
              <Icon name="chevR" size={18} color="var(--ink3)" />
            </Link>
          ))}
          {!list.length && <span className="block p-6 text-sm text-ink2">{data ? "Nothing here." : "Loading…"}</span>}
        </div>
      </main>
    </>
  );
}
