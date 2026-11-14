"use client";
import { useState } from "react";
import { useApi } from "@/lib/use-api";
import { AppBar, EmptyState } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/ui/logo";

type Week = {
  name: string | null;
  school: string;
  week: number;
  best: { code: string; score: number; rank: number; total: number; moved: number | null } | null;
  xp: number;
  streak: number;
  inviteCode: string | null;
};

const W = 1080, H = 1920;

function font(varName: string, fallback: string) {
  const v = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return v || fallback;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws the card at story size (9:16). Same layout as the preview below. */
async function renderCard(w: Week, site: string): Promise<Blob> {
  await document.fonts.ready;
  const display = font("--font-shoulders", "sans-serif");
  const sans = font("--font-instrument", "sans-serif");
  const mono = font("--font-jetbrains", "monospace");
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = "#5B3DF5";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#6A4FF6";
  ctx.lineWidth = 3;
  for (let x = 0; x < W; x += 95) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 95) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const pad = 90;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `800 64px ${display}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("IntelQA", pad, 190);
  ctx.font = `700 34px ${mono}`;
  ctx.textAlign = "right";
  ctx.fillText(`WEEK ${w.week}`, W - pad, 180);
  ctx.textAlign = "left";

  const b = w.best;
  ctx.font = `500 48px ${sans}`;
  ctx.fillText(`${w.name ?? "I"} ${b ? (w.name ? "is" : "am") : "earned"}`, pad, 720);
  ctx.font = `800 330px ${display}`;
  ctx.fillText(b ? `#${b.rank}` : w.xp.toLocaleString(), pad - 12, 1010);
  ctx.font = `500 48px ${sans}`;
  ctx.fillText(b ? `in ${b.code}${w.school ? ` at ${w.school}` : ""}` : "XP this week", pad, 1090);
  if (b?.moved && b.moved > 0) {
    const label = `↑ ${b.moved} THIS WEEK`;
    ctx.font = `700 40px ${mono}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "#FFD43B";
    roundRect(ctx, pad, 1130, tw + 60, 76, 38);
    ctx.fill();
    ctx.fillStyle = "#15132B";
    ctx.fillText(label, pad + 30, 1182);
  }

  // Stats panel
  const top = 1330, ph = 330;
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, pad, top, W - pad * 2, ph, 50);
  ctx.fill();
  const rows: [string, string][] = [
    ["XP this week", w.xp.toLocaleString()],
    ["Streak", `${w.streak} day${w.streak === 1 ? "" : "s"}`],
    ["Best", b ? `${b.code} · ${b.score}%` : "—"],
  ];
  rows.forEach(([k, v], i) => {
    const y = top + 85 + i * 105;
    ctx.fillStyle = "#15132B";
    ctx.font = `500 42px ${sans}`;
    ctx.textAlign = "left";
    ctx.fillText(k, pad + 50, y);
    ctx.font = `700 42px ${mono}`;
    ctx.textAlign = "right";
    ctx.fillText(v, W - pad - 50, y);
    if (i < rows.length - 1) {
      ctx.fillStyle = "#EEEBE3";
      ctx.fillRect(pad + 50, y + 40, W - pad * 2 - 100, 3);
    }
  });
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `500 40px ${sans}`;
  ctx.fillText("Think you can beat me?", W / 2, 1790);
  ctx.font = `700 40px ${sans}`;
  ctx.fillText(site, W / 2, 1850);

  return new Promise((res, rej) => c.toBlob((bl) => (bl ? res(bl) : rej(new Error("Couldn't draw the card"))), "image/png"));
}

/** D12: the weekly card students post to WhatsApp status, the main way new students find the app. */
export default function WeekCard() {
  const { data } = useApi<Week>("/me/week");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (!data) return <AppBar title="Your week" />;
  if (!data.best && !data.xp) {
    return (
      <>
        <AppBar title="Your week" />
        <EmptyState glyph="calendar" tone="hl" title="Nothing to share yet">Practise this week and your card fills in: your rank, XP and streak, ready for your status.</EmptyState>
      </>
    );
  }
  const site = `${window.location.host}${data.inviteCode ? `/join/${data.inviteCode}` : ""}`;
  const b = data.best;

  async function share(target: "share" | "save") {
    setBusy(target);
    setMsg(null);
    try {
      const blob = await renderCard(data!, site);
      const file = new File([blob], `intelqa-week-${data!.week}.png`, { type: "image/png" });
      const text = `My IntelQA week. Think you can beat me? ${window.location.origin}${data!.inviteCode ? `/join/${data!.inviteCode}` : ""}`;
      if (target === "share" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setMsg("Saved to your phone. Post it from your gallery.");
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <AppBar title="Your week" sub="Share to your status" />
      <div className="flex flex-1 flex-col px-[34px] pt-2">
        <div
          className="flex aspect-[9/16] w-full flex-col justify-between rounded-[22px] bg-violet p-7 text-white"
          style={{ backgroundImage: "linear-gradient(#6A4FF6 1px,transparent 1px),linear-gradient(90deg,#6A4FF6 1px,transparent 1px)", backgroundSize: "22px 22px" }}
          aria-label="Preview of your weekly card"
        >
          <div className="flex items-center justify-between"><Logo size={18} variant="violet" tag={false} /><span className="font-mono text-[10px]">WEEK {data.week}</span></div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{data.name} {b ? "is" : "earned"}</span>
            <span className="font-display text-[84px] leading-[0.85] font-extrabold tracking-[-0.05em]">{b ? `#${b.rank}` : data.xp.toLocaleString()}</span>
            <span className="text-[13px] font-medium">{b ? `in ${b.code}${data.school ? ` at ${data.school}` : ""}` : "XP this week"}</span>
            {b?.moved && b.moved > 0 ? <span className="mt-1 self-start rounded-full bg-highlighter px-2 py-1 font-mono text-[11px] font-bold text-exam-ink">↑ {b.moved} THIS WEEK</span> : null}
          </div>
          <div className="flex flex-col rounded-[14px] bg-white px-3 py-0.5 text-exam-ink">
            {[["XP this week", data.xp.toLocaleString()], ["Streak", `${data.streak} day${data.streak === 1 ? "" : "s"}`], ["Best", b ? `${b.code} · ${b.score}%` : "—"]].map(([k, v], i) => (
              <div key={k} className={`flex justify-between py-2 text-xs ${i < 2 ? "border-b border-[#EEEBE3]" : ""}`}><span>{k}</span><strong className="font-mono">{v}</strong></div>
            ))}
          </div>
          <span className="text-center text-[11px]">Think you can beat me? <strong>{site}</strong></span>
        </div>
      </div>
      {msg && <p className="px-6 pt-3 text-center text-sm text-ink2">{msg}</p>}
      <div className="flex justify-center gap-10 px-5 pt-4 pb-6 text-xs font-semibold text-ink">
        <button onClick={() => share("share")} disabled={!!busy} className="flex flex-col items-center gap-1.5">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#18A058]"><Icon name="share" size={22} color="#FFFFFF" /></span>
          {busy === "share" ? "Preparing…" : "Status / Story"}
        </button>
        <button onClick={() => share("save")} disabled={!!busy} className="flex flex-col items-center gap-1.5">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-exam-ink"><Icon name="download" size={22} color="#FFFFFF" /></span>
          {busy === "save" ? "Saving…" : "Save image"}
        </button>
      </div>
    </div>
  );
}
