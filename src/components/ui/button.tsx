"use client";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, Spinner, type Glyph } from "./icon";

/** Button kinds from Btn.dc.html. */
const KINDS = {
  primary: "bg-accent text-on-accent",
  secondary: "bg-surface text-ink border-[1.5px] border-ink",
  outline: "bg-transparent text-ink border-[1.5px] border-line",
  tonal: "bg-accent-tint text-accent-text",
  ghost: "bg-transparent text-accent-text",
  danger: "bg-bad text-white",
  dangerGhost: "bg-transparent text-bad-text",
  highlight: "bg-highlighter text-exam-ink",
  inverse: "bg-chip text-on-chip",
  onAccent: "bg-white text-violet-deep",
} as const;

const SIZES = {
  lg: "h-[54px] min-h-[54px] rounded-[8px] text-[18px] px-6",
  md: "h-11 min-h-11 rounded-[7px] text-[16px] px-4",
  sm: "h-9 min-h-9 rounded-[6px] text-[14px] px-3",
} as const;

type Common = {
  kind?: keyof typeof KINDS;
  size?: keyof typeof SIZES;
  icon?: Glyph;
  iconRight?: Glyph;
  full?: boolean;
  loading?: boolean;
  children: ReactNode;
  className?: string;
};

function classes({ kind = "primary", size = "lg", full, className }: Common, disabled?: boolean) {
  return [
    "caps nudge inline-flex items-center justify-center gap-2 whitespace-nowrap select-none transition-[filter,opacity,transform] active:scale-[0.98] active:brightness-95",
    SIZES[size],
    disabled ? "bg-raised text-ink3 border-0" : KINDS[kind],
    full ? "w-full flex-1" : "",
    className ?? "",
  ].join(" ");
}

function Inner({ icon, iconRight, loading, children, size = "lg" }: Common) {
  const s = size === "sm" ? 16 : 18;
  return (
    <>
      {loading ? <Spinner size={s} /> : icon ? <Icon name={icon} size={s} /> : null}
      <span className="truncate">{children}</span>
      {iconRight && <Icon name={iconRight} size={s} />}
    </>
  );
}

export function Button(props: Common & Omit<ComponentProps<"button">, "children" | "className">) {
  const { kind, size, icon, iconRight, full, loading, children, className, disabled, ...rest } = props;
  return (
    <button {...rest} disabled={disabled || loading} className={classes({ kind, size, full, className, children }, disabled)} style={{ opacity: loading ? 0.8 : 1 }}>
      <Inner {...{ icon, iconRight, loading, children, size }} />
    </button>
  );
}

export function ButtonLink(props: Common & { href: string; replace?: boolean }) {
  const { kind, size, icon, iconRight, full, children, className, href, replace } = props;
  return (
    <Link href={href} replace={replace} className={classes({ kind, size, full, className, children })}>
      <Inner {...{ icon, iconRight, children, size }} />
    </Link>
  );
}
