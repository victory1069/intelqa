"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { areaCls } from "./kit";

type Box = { x: number; y: number; w: number; h: number };

/**
 * F11: drag a box on the scanned page; the crop is sent to the server, which stores it as
 * a small greyscale WebP. For PDFs, attach a screenshot of the figure instead.
 */
export function CropModal({ src, onClose, onSave }: { src: string | null; onClose: () => void; onSave: (blob: Blob, alt: string) => Promise<void> }) {
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function rel(e: React.PointerEvent) {
    const r = img.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
  }

  async function cropBlob(): Promise<Blob> {
    if (file) return file;
    const el = img.current!;
    const sx = el.naturalWidth / el.clientWidth, sy = el.naturalHeight / el.clientHeight;
    const c = document.createElement("canvas");
    c.width = Math.round(box!.w * sx);
    c.height = Math.round(box!.h * sy);
    c.getContext("2d")!.drawImage(el, box!.x * sx, box!.y * sy, c.width, c.height, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't crop"))), "image/png"));
  }

  const canSave = (file || (box && box.w > 20 && box.h > 20)) && alt.trim().length > 3;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-scrim md:flex-row md:overflow-visible" role="dialog" aria-label="Attach a figure">
      <div className="flex min-h-[45vh] flex-none items-center justify-center overflow-auto bg-[#2A2838] p-6 md:min-h-0 md:flex-1 md:p-8">
        {src ? (
          <div className="relative select-none" style={{ touchAction: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={img}
              src={src}
              alt="Scanned page"
              crossOrigin="anonymous"
              draggable={false}
              className="max-h-[60vh] max-w-full bg-white md:max-h-[80vh]"
              onPointerDown={(e) => { const p = rel(e); setStart(p); setBox({ ...p, w: 0, h: 0 }); }}
              onPointerMove={(e) => { if (!start) return; const p = rel(e); setBox({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }); }}
              onPointerUp={() => setStart(null)}
            />
            {box && box.w > 0 && (
              <div className="pointer-events-none absolute border-2 border-highlighter" style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: "0 0 0 2000px rgba(21,19,43,0.45)" }} />
            )}
          </div>
        ) : (
          <span className="max-w-sm text-center text-sm text-white/80">This source is a PDF or document, so the figure can&apos;t be cut from it here. Attach a screenshot of the figure instead.</span>
        )}
      </div>
      <div className="flex w-full flex-none flex-col gap-6 bg-surface p-6 md:w-[380px] md:p-[22px]">
        <div className="flex items-center justify-between"><strong className="font-display text-xl">Attach a figure</strong><button onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button></div>
        <span className="text-sm text-ink2">{src ? "Drag a box around the figure on the scan." : "Choose an image file."} It&apos;s compressed to a small greyscale WebP and shown to students only when they tap it (Data saver).</span>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">{src ? "Or attach an image file" : "Image file"}</span>
          <input type="file" accept="image/*" className="max-w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Alt text</span>
          <textarea value={alt} onChange={(e) => setAlt(e.target.value)} rows={3} placeholder="Block on a ramp inclined at 30° to the horizontal." className={areaCls} />
          <span className="text-xs text-ink3">Describe what the figure shows, for screen readers.</span>
        </label>
        {err && <span className="text-sm text-bad-text">{err}</span>}
        <div className="mt-auto flex gap-2.5">
          <Button kind="outline" size="md" onClick={onClose}>Cancel</Button>
          <Button
            size="md"
            icon="crop"
            full
            disabled={!canSave}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onSave(await cropBlob(), alt.trim());
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Attach crop
          </Button>
        </div>
      </div>
    </div>
  );
}
