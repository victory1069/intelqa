"use client";
import { Icon } from "./icon";
import { MathText } from "./math-text";

export type OptionState = "default" | "selected" | "correct" | "wrong" | "picked" | "dim";

/** Answer option row from Option.dc.html. Every state pairs colour with an icon or label. */
const S: Record<OptionState, { row: string; badge: string; weight: number; icon?: "check" | "cross"; tag?: string; tagColor?: string }> = {
  default: { row: "bg-surface border-[1.5px] border-line", badge: "bg-raised text-ink", weight: 400 },
  selected: { row: "bg-accent-tint border-2 border-accent", badge: "bg-accent text-on-accent", weight: 600 },
  correct: { row: "bg-ok-tint border-2 border-ok", badge: "bg-ok text-white", weight: 600, icon: "check", tag: "CORRECT ANSWER", tagColor: "var(--ok-text)" },
  wrong: { row: "bg-bad-tint border-2 border-bad", badge: "bg-bad text-white", weight: 600, icon: "cross", tag: "YOUR ANSWER", tagColor: "var(--bad-text)" },
  picked: { row: "bg-ok-tint border-2 border-ok", badge: "bg-ok text-white", weight: 600, icon: "check", tag: "YOUR ANSWER · CORRECT", tagColor: "var(--ok-text)" },
  dim: { row: "bg-surface border-[1.5px] border-line opacity-60", badge: "bg-raised text-ink3", weight: 400 },
};

export function Option({
  letter,
  text,
  state = "default",
  tag,
  onClick,
  disabled,
}: {
  letter: string;
  text: string;
  state?: OptionState;
  tag?: string | null;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const s = S[state];
  const label = tag === undefined ? s.tag : tag;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      aria-pressed={onClick ? state === "selected" : undefined}
      className={`flex w-full min-h-14 items-center gap-3 rounded-[14px] py-2 pr-3.5 pl-2 text-left transition-colors ${s.row}`}
    >
      <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] font-mono text-sm font-bold ${s.badge}`}>{letter}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base leading-snug text-ink" style={{ fontWeight: s.weight, textWrap: "pretty" }}>
          <MathText text={text} />
        </span>
        {label && (
          <span className="font-mono text-[11px] font-bold tracking-wide" style={{ color: s.tagColor ?? "var(--ink3)" }}>
            {label}
          </span>
        )}
      </span>
      {s.icon && <Icon name={s.icon} size={20} weight={2.4} color={s.tagColor} />}
    </Tag>
  );
}
