"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDownloads } from "@/lib/use-downloads";
import { useOnline } from "@/lib/use-online";
import { downloadCourse } from "@/lib/start";
import { odb } from "@/lib/offline";
import { AppBar, Banner, Card, Sheet } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icon";

/** E01 / E03: every course with its real size. Text only; figures load on tap. */
export default function Downloads() {
  const { me } = useAuth();
  const online = useOnline();
  const { courses, reload } = useDownloads();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const total = (courses ?? []).reduce((s, c) => s + c.bytes, 0);
  const missing = (me?.courses ?? []).filter((c) => c.status === "live" && !courses?.some((d) => d.courseId === c.id));

  async function get(id: string) {
    setBusy(id);
    setFailed(null);
    try {
      await downloadCourse(id);
      await reload();
    } catch (e) {
      setFailed((e as Error).name === "QuotaExceededError" ? "storage" : "network");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AppBar title="Downloads" sub={`${Math.round(total / 1024)} KB on this phone`} />
      <main className="flex flex-col gap-4 px-5 pb-5">
        {!online && <Banner icon="offline">Offline. You can use what&apos;s saved; new downloads need data.</Banner>}
        {failed === "network" && <Banner tone="bad" icon="alert">The download stopped. Try again when your connection is steadier.</Banner>}
        <Card className="flex flex-col rounded-[18px]">
          {(me?.courses ?? []).map((c, i) => {
            const d = courses?.find((x) => x.courseId === c.id);
            return (
              <div key={c.id} className={`flex items-center gap-3 px-5 py-4 ${i ? "border-t border-line2" : ""}`}>
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="font-mono text-sm font-bold">{c.code}</span>
                  <span className="text-xs text-ink2">
                    {d
                      ? `${d.data.papers.length} paper${d.data.papers.length === 1 ? "" : "s"} · ${d.data.papers.reduce((s, p) => s + p.questions.length, 0)} questions · ${Math.round(d.bytes / 1024)} KB · ${new Date(d.at).toLocaleDateString()}`
                      : c.status === "live" ? "Not downloaded" : "No papers yet"}
                  </span>
                </div>
                {d ? (
                  <button onClick={() => setRemove(c.id)} className="flex h-[34px] items-center gap-1.5 rounded-[10px] bg-ok-tint px-2.5 text-xs font-bold text-ok-text" aria-label={`${c.code} saved. Remove?`}>
                    <Icon name="check" size={16} weight={2.4} />Saved
                  </button>
                ) : c.status === "live" ? (
                  <button disabled={!online || !!busy} onClick={() => get(c.id)} className="flex h-[34px] items-center gap-1.5 rounded-[10px] bg-accent-tint px-2.5 text-xs font-bold text-accent-text disabled:opacity-50">
                    {busy === c.id ? <Spinner size={16} /> : <Icon name="download" size={16} weight={2.4} />}Get
                  </button>
                ) : (
                  <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-raised"><Icon name="minus" size={16} color="var(--ink3)" /></span>
                )}
              </div>
            );
          })}
        </Card>
        <span className="text-xs leading-snug text-ink3">Downloads are text only. Diagrams load the first time you tap them and are kept after that.</span>
        {missing.length > 0 && online && (
          <Button kind="tonal" icon="download" full loading={!!busy} onClick={async () => { for (const c of missing) await get(c.id); }}>
            Download remaining · {missing.length} course{missing.length === 1 ? "" : "s"}
          </Button>
        )}
      </main>

      {/* E03 */}
      <Sheet open={failed === "storage"} onClose={() => setFailed(null)} label="Out of space">
        <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-bad-tint"><Icon name="storage" size={28} color="var(--bad-text)" /></span>
        <strong className="font-display text-2xl leading-tight">Your phone is out of space</strong>
        <span className="text-[15px] leading-relaxed text-ink2">Free up a little space, or remove a course you&apos;ve finished with, then try again.</span>
        <Button full kind="ghost" onClick={() => setFailed(null)}>OK</Button>
      </Sheet>
      <Sheet open={!!remove} onClose={() => setRemove(null)} label="Remove download">
        <strong className="font-display text-[22px]">Remove this download?</strong>
        <span className="text-[15px] text-ink2">You&apos;ll need data to open the course again. Results already saved aren&apos;t affected.</span>
        <Button full kind="danger" onClick={async () => { await odb().courses.delete(remove!); await reload(); setRemove(null); }}>Remove</Button>
        <Button full kind="ghost" onClick={() => setRemove(null)}>Keep it</Button>
      </Sheet>
    </>
  );
}
