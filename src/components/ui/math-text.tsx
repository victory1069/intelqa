"use client";
import katex from "katex";
import { Fragment, useMemo } from "react";

/**
 * Renders text with inline LaTeX between $...$ (what the extraction pipeline produces).
 * KaTeX runs locally, so maths works offline.
 */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: { math: boolean; s: string }[] = [];
    const re = /\$([^$]+)\$/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ math: false, s: text.slice(last, m.index) });
      out.push({ math: true, s: m[1] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ math: false, s: text.slice(last) });
    return out;
  }, [text]);

  return (
    <span className={`whitespace-pre-line ${className ?? ""}`}>
      {parts.map((p, i) =>
        p.math ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(p.s, { throwOnError: false, output: "html" }) }} />
        ) : (
          <Fragment key={i}>{p.s}</Fragment>
        ),
      )}
    </span>
  );
}
