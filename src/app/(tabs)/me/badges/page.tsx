"use client";
import { useAuth } from "@/lib/auth";
import { AppBar } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";

/** D14: earned badges in colour, the rest greyed with what they need. */
export default function Badges() {
  const { me } = useAuth();
  if (!me) return null;
  const sorted = [...me.badges].sort((a, b) => Number(b.earned) - Number(a.earned));
  return (
    <>
      <AppBar title="Badges" sub={`${me.badges.filter((b) => b.earned).length} of ${me.badges.length} earned`} />
      <main className="grid grid-cols-3 gap-3 px-4 pb-5">
        {sorted.map((b, i) => (
          <div key={b.key} className="flex flex-col items-center gap-1.5 rounded-[18px] border border-line bg-surface px-2 py-4 text-center">
            <span className={`flex h-[52px] w-[52px] items-center justify-center rounded-full ${b.earned ? (i % 2 ? "bg-accent" : "bg-highlighter") : "bg-raised"}`}>
              <Icon name={b.glyph} size={24} color={b.earned ? (i % 2 ? "var(--on-accent)" : "#15132B") : "var(--ink3)"} />
            </span>
            <strong className="text-[12.5px] leading-tight">{b.name}</strong>
            <span className="text-[11px] leading-snug text-ink3">{b.sub}</span>
            {!b.earned && <span className="sr-only">Not earned yet</span>}
          </div>
        ))}
      </main>
    </>
  );
}
