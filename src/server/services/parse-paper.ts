/**
 * Built-in parser for typed past-question papers (DOCX, TXT, PDFs with a text layer).
 * Used when no ANTHROPIC_API_KEY is set (or EXTRACTOR=local), so the whole upload →
 * review → publish flow can be tested on a laptop. Photos and scanned PDFs have no
 * text to read, so they need Claude.
 *
 * Questions: "1.", "1)", "(1)", "Q1.", "Question 1:", including Word's automatic numbering.
 *
 * Options, whatever the lecturer used (one per line, or several on a line):
 *   A. / a) / (a) / [A] / A:      letters
 *   i. / (ii) / iii)              roman numerals
 *   1. / 2) under a question      numbers
 *   • / - / – / * / ➢             bullets
 *   no marker at all              the lines under the question (flagged for a check)
 * Statements numbered i, ii, iii inside a question stay in the question when the
 * options themselves are lettered ("A. i and ii only").
 *
 * Answers, wherever they are:
 *   under the question            "Answer: B", "Ans - (b)", "Correct answer is Abuja", "… Ans: B" at a line end
 *   on the option                 "*B. Abuja", "B. Abuja *", "B. Abuja (correct)", ✓, or the one bold option (DOCX)
 *   in a key, anywhere            "ANSWERS" / "Answer key" / "Marking scheme" heading, usually on the last page,
 *                                 then "1. C", "2-B", "1C 2B 3A", "1–5: ABCDA", "1. Abuja", or a table
 *                                 (a row of numbers, then a row of letters). Lines like "1. C 2. D" are a key
 *                                 even without a heading.
 * Answers can be a letter, a roman numeral, a number or the option's text; they're matched
 * to the option by `resolveAnswer`, once the questions are known.
 */
import { LETTERS } from "@/shared/game";

export type ParsedQuestion = {
  number: number;
  page: number;
  text: string;
  options: string[];
  /** Index of the answer printed with the question (answer line or marked option), if any. */
  answer: number | null;
  explanation: string | null;
  issues: string[];
};

type Style = "letter" | "number" | "roman" | "bullet";
type Part = { style: Style | null; idx: number; text: string; raw: string; marked: boolean; bold: boolean };
type Draft = { number: number; page: number; stem: string; stemBold: boolean; parts: Part[]; answer: string | null; explanation: string | null };

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const R = "(?:viii|vii|iii|vi|iv|ix|ii|v|x|i)";

const Q_START = /^(?:Q(?:uestion)?\s*\.?\s*)?\(?(\d{1,3})\s*[.):\]](?!\d)\s*(.*)$/i;
const Q_LABEL = /^Q(?:uestion)?\s*\.?\s*(\d{1,3})\b\s*(?:[.):\-–]\s*)?(.*)$/i;

const LETTER_OPT = /^(?:\(([A-Ea-e])\)|\[([A-Ea-e])\]|([A-Ea-e])[.):\]]|([A-Ea-e])\s+[-–]\s)\s*(.*)$/;
const ROMAN_OPT = new RegExp(`^(?:\\((${R})\\)|\\[(${R})\\]|(${R})[.):\\]])\\s*(.*)$`, "i");
const BULLET = /^(?:[•●○◦▪■□◆◇➢➤►▸‣⁃∙·-]\s*|(?:[-–—]|\*(?!\*))\s+)(.*)$/;
const BULLET_CHARS = "•●○◦▪■□◆◇➢➤►▸‣⁃∙-";
const INLINE = {
  letter: /(^|\s)(?:\(([A-Ea-e])\)|([A-Ea-e])[.)])\s+/g,
  roman: new RegExp(`(^|\\s)(?:\\((${R})\\)|(${R})[.)])\\s+`, "gi"),
};

const LEAD_TICK = /^[✓✔√]\s*/;
const LEAD_STAR = /^\*(?!\*)\s*/;
const TRAIL_MARK = /\s*(?:[([](?:correct|ans(?:wer)?|right|key)[)\]]|(?<!\*)\*(?!\*)|[✓✔√])\s*$/i;

const EXPLAIN = /^[-–*]?\s*(?:explanation|reason|solution|working|rationale)\s*[:.\-–]\s*(.*)$/i;
const ANSWER_LINE = /^(?:the\s+)?(?:correct\s+)?(?:answer|ans|key|correct\s+option)\b\.?\s*(?:is\s+)?([:=\-–])?\s*(.+)$/i;
const TRAIL_ANS = /\s+[([]?(?:correct\s+)?(?:answer|ans)\.?\s*[:=\-–]\s*([^()[\]]+?)[)\]]?\s*$/i;
const SHORT_TOKEN = new RegExp(`^[([]?(?:[A-Ea-e]|${R}|\\d{1,2})[)\\]]?\\.?$`, "i");

const KEY_HEADING =
  /^(?:the\s+)?(?:answer\s*keys?|answers?(?:\s+(?:to|for)\b[^:]*)?|marking\s+(?:scheme|guide)|solutions?|keys?|correct\s+(?:answers?|options?))\s*[:.\-–]?\s*(.*)$/i;
// Credits and footers after a key ("Answered by: …", "GNS111 | 30 Questions", a phone number, an all-caps line).
const CREDITS = (l: string) =>
  /^(?:answered|prepared|compiled|typed|written|edited|set)\s+by/i.test(l) ||
  /\s\|\s/.test(l) ||
  /(?:\+?234|0)[789][01]\d{8}/.test(l) ||
  (l.split(/\s+/).length >= 3 && (l.match(/[A-Z]/g) ?? []).length >= 0.8 * (l.match(/[A-Za-z]/g) ?? []).length);
const KEY_HEADING_STRONG = /^(?:the\s+)?(?:answer\s*keys?|answers|marking\s+(?:scheme|guide)|solutions|correct\s+answers)\b/i;
const KEY_PAIR = new RegExp(`(?:Q\\s*)?(\\d{1,3})\\s*[.):=\\-–]?\\s*[([]?(${R}|[A-Ea-e])[)\\]]?(?![\\p{L}\\p{N}])`, "giu");
// Inside a key section only: "5. 2" means option 2.
const KEY_PAIR_NUM = /(?:Q\s*)?(\d{1,3})\s*[.):=\-–]\s*\(?([1-9])\)?(?!\d)/g;
const KEY_RANGE = /(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*[.):=]?\s*([A-Ea-e](?:[\s,]*[A-Ea-e])*)(?![\p{L}\p{N}])/giu;
const NUM_ROW = /^(?:(?:questions?|q|no\.?|s\/n)\s*(?:no\.?)?\s*[:.]?\s*)?\d{1,3}(?:[\s,|]+\d{1,3}){2,}$/i;
const KEY_ROW_LABEL = /^(?:ans(?:wers?)?|keys?|options?)\s*[:.]?\s*/i;
const ANS_TOKEN = new RegExp(`^(?:[A-Ea-e]|${R})$`, "i");

const letterIdx = (l: string) => LETTERS.indexOf(l.toUpperCase() as (typeof LETTERS)[number]);
const unbold = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Share of a line's letters inside **bold** (the DOCX reader marks bold and underline that way). */
function boldShare(s: string) {
  let bold = 0;
  let all = 0;
  s.split("**").forEach((seg, i) => {
    const n = (seg.match(/[\p{L}\p{N}]/gu) ?? []).length;
    all += n;
    if (i % 2) bold += n;
  });
  return all ? bold / all : 0;
}

/** "**A. Lagos**" → "A. **Lagos**", so the marker is at the start for the patterns below. */
function moveLeadingBold(line: string) {
  const marker = /^\*\*((?:Q(?:uestion)?\s*)?[([]?[A-Za-z0-9]{1,4}[)\]]?\s*[.):\]]?)/i;
  return line
    .replace(/\*{4}/g, "")
    .replace(new RegExp(marker.source + /\*\*/.source, "i"), "$1")
    .replace(new RegExp(marker.source + /(\s+|$)/.source, "i"), "$1$2**");
}

function matchMarker(line: string): { style: Exclude<Style, "number">; idx: number; body: string } | null {
  let m = line.match(LETTER_OPT);
  if (m) return { style: "letter", idx: letterIdx(m[1] ?? m[2] ?? m[3] ?? m[4]), body: m[5] };
  m = line.match(ROMAN_OPT);
  if (m) return { style: "roman", idx: ROMAN.indexOf((m[1] ?? m[2] ?? m[3]).toLowerCase()), body: m[4] };
  m = line.match(BULLET);
  if (m && m[1].trim()) return { style: "bullet", idx: -1, body: m[1] };
  return null;
}

/** Splits "A. foo B. bar C. baz" (or "(i) … (ii) …") into options, when a line carries several in order. */
function splitInline(text: string, style: "letter" | "roman", from: number, allowPrefix: boolean) {
  const marks = [...text.matchAll(INLINE[style])];
  const idxOf = (m: RegExpMatchArray) => {
    const k = m[2] ?? m[3];
    return style === "letter" ? letterIdx(k) : ROMAN.indexOf(k.toLowerCase());
  };
  const first = marks.findIndex((m) => idxOf(m) === from);
  if (first < 0) return null;
  const run = [marks[first]];
  for (const m of marks.slice(first + 1)) if (idxOf(m) === from + run.length) run.push(m);
  if (run.length < 2) return null;
  const at = (m: RegExpMatchArray) => m.index! + m[1].length;
  const prefix = text.slice(0, at(run[0])).trim();
  if (prefix && !allowPrefix) return null;
  return {
    style,
    prefix,
    items: run.map((m, i) => {
      const end = i + 1 < run.length ? at(run[i + 1]) : text.length;
      return { idx: from + i, raw: text.slice(at(m), end).trim(), body: text.slice(m.index! + m[0].length, end).trim() };
    }),
  };
}

function makePart(style: Style | null, idx: number, raw: string, body: string, lead = false): Part {
  let t = body.trim();
  let marked = lead;
  const tm = t.match(TRAIL_MARK);
  if (tm) {
    marked = true;
    t = t.slice(0, tm.index).trim();
  }
  return { style, idx, text: unbold(t), raw: unbold(raw).replace(TRAIL_MARK, "").trim(), marked, bold: boldShare(t) >= 0.8 };
}

/** Pairs on a line that is nothing but an answer key ("1. C 2. D", "1C 2B", "1–5: ABCDA"), else null. */
function keyLine(s: string, numbers = false): [number, string][] | null {
  const out: [number, string][] = [];
  let rest = s.replace(KEY_RANGE, (all, a: string, b: string, letters: string) => {
    const ls = letters.replace(/[\s,]/g, "");
    if (Number(b) - Number(a) + 1 !== ls.length) return all;
    for (let i = 0; i < ls.length; i++) out.push([Number(a) + i, ls[i]]);
    return " ";
  });
  if (numbers)
    rest = rest.replace(KEY_PAIR_NUM, (_all, n: string, a: string) => {
      out.push([Number(n), a]);
      return " ";
    });
  rest = rest.replace(KEY_PAIR, (_all, n: string, a: string) => {
    out.push([Number(n), a]);
    return " ";
  });
  if (!out.length || !/^[\s,;|/.:\-–]*$/.test(rest.replace(/\b(?:q|no|ans)\b/gi, ""))) return null;
  return out;
}

function answerLine(plain: string): { token: string; explanation: string | null } | null {
  const m = plain.match(ANSWER_LINE);
  if (!m) return null;
  const [token, ...ex] = m[2].trim().split(/\s+(?:explanation|reason)\s*[:\-–]\s*/i);
  if (!m[1] && !SHORT_TOKEN.test(token.trim())) return null;
  return { token: token.trim(), explanation: ex.length ? ex.join(" ").trim() : null };
}

/**
 * Matches a printed answer to an option index: a letter ("B", "(b)"), roman numeral ("ii"),
 * number ("2"), "B. Abuja", or the option's text ("Abuja"). Null when it can't tell.
 */
export function resolveAnswer(token: string | null | undefined, options: string[]): number | null {
  if (!token) return null;
  const t = unbold(token)
    .replace(/^(?:option|opt\.?)\s+/i, "")
    .replace(/^\d{1,3}\s*[.)]\s*(?=[([]?[A-Ea-e][)\]]?(?:\s|[.):\-–]|$))/, "") // "102. D - 14" → "D - 14"
    .replace(/[.;,*]+$/, "")
    .trim();
  if (!t) return null;
  const ok = (i: number) => (i >= 0 && (options.length === 0 || i < options.length) ? i : null);
  let m = t.match(/^[([]?([A-Ea-e])[)\]]?$/);
  if (m) return ok(letterIdx(m[1]));
  m = t.match(new RegExp(`^[([]?(${R})[)\\]]?$`, "i"));
  if (m) return ok(ROMAN.indexOf(m[1].toLowerCase()));
  m = t.match(/^[([]?(\d{1,2})[)\]]?$/);
  if (m) return ok(Number(m[1]) - 1);
  const n = normalise(t);
  const exact = options.findIndex((o) => normalise(o) === n);
  if (n && exact >= 0) return exact;
  m = t.match(/^(?:\(([A-Ea-e])\)|([A-Ea-e])\s*[.):\-–])\s*/);
  if (m) return ok(letterIdx(m[1] ?? m[2]));
  m = t.match(new RegExp(`^(?:\\((${R})\\)|(${R})\\s*[.):])\\s*`, "i"));
  if (m) return ok(ROMAN.indexOf((m[1] ?? m[2]).toLowerCase()));
  m = t.match(/^([A-E])\s+\S/); // "D /æ/"
  if (m) return ok(letterIdx(m[1]));
  if (n.length >= 3) {
    const hits = options.map((o, i) => [normalise(o), i] as const).filter(([o]) => o && (o.includes(n) || n.includes(o)));
    if (hits.length === 1) return hits[0][1];
  }
  return null;
}

/** Reads a separate answer-key file. Values are raw answers; match them with `resolveAnswer`. */
export function parseAnswerKey(text: string): Map<number, string> {
  return parsePaper([`ANSWER KEY\n${text}`], 4).key;
}

/** Decides which marked lines are the options, and what the answer is. */
function finish(d: Draft, optionCount: number): ParsedQuestion {
  const issues: string[] = [];
  let parts = d.parts;
  let stem = d.stem;
  if (!stem && parts[0] && parts[0].style == null) {
    stem = parts[0].text;
    parts = parts.slice(1);
  }
  const count = (s: Style) => parts.filter((p) => p.style === s).length;
  const style = (["letter", "number", "roman", "bullet"] as const).find((s) => count(s) >= 2 && parts.find((p) => p.style === s)!.idx === 0) ?? null;

  type Opt = { text: string; marked: boolean; bold: boolean };
  const options: Opt[] = [];
  const add = (p: Part) => options.push({ text: p.text, marked: p.marked, bold: p.bold });
  const append = (p: Part) => {
    const o = options.at(-1)!;
    if (!o.text) Object.assign(o, { marked: o.marked || p.marked, bold: p.bold });
    o.text = `${o.text} ${p.style === style ? p.raw : p.style ? p.raw : p.text}`.trim();
  };

  if (style) {
    for (const p of parts) {
      const at = style === "bullet" ? options.length : p.idx;
      if (p.style === style && at === options.length) add(p);
      else if (p.style === style && at === options.length + 1 && options.length) {
        issues.push(`Option ${LETTERS[options.length]} looks missing`);
        options.push({ text: "", marked: false, bold: false });
        add(p);
      } else if (!options.length) stem += p.style ? `\n${p.raw}` : ` ${p.text}`;
      else append(p);
    }
  } else if (parts.length >= 2) {
    // No markers: the lines under the question are the options. A stem that wrapped onto
    // extra lines is the most likely mistake, so keep the last `optionCount` lines.
    let opts = parts;
    const endsQuestion = /(?:[?:]|_{2,}|\.{3}|…)$/.test(stem);
    if (parts.length > optionCount && (!endsQuestion || parts.length > 6)) {
      stem += parts.slice(0, parts.length - optionCount).map((p) => ` ${p.raw}`).join("");
      opts = parts.slice(-optionCount);
    }
    opts.forEach((p) => options.push({ text: p.raw, marked: p.marked, bold: p.bold }));
    issues.push("Options had no letters or numbers; check where each one starts");
  } else {
    for (const p of parts) stem += ` ${p.raw}`;
  }

  const texts = options.map((o) => o.text);
  let answer = d.answer != null ? resolveAnswer(d.answer, texts) : null;
  if (d.answer != null && answer == null) issues.push(`Couldn't match the printed answer "${d.answer}" to an option`);
  const marked = options.flatMap((o, i) => (o.marked ? [i] : []));
  const bold = options.flatMap((o, i) => (o.bold ? [i] : []));
  if (marked.length > 1) issues.push("Several options are marked as the answer");
  const visual = marked.length === 1 ? marked[0] : bold.length === 1 && options.length >= 2 && !d.stemBold ? bold[0] : null;
  if (answer == null) answer = visual;
  else if (visual != null && visual !== answer) issues.push(`The answer line says ${LETTERS[answer]}, but option ${LETTERS[visual]} is marked`);

  if (options.length === 0) issues.push("No options found under this question");
  else if (options.length > optionCount) issues.push(`More than ${optionCount} options; a line may have been read as an option`);
  if (texts.some((o) => !o)) issues.push("An option is empty");

  return { number: d.number, page: d.page, text: stem.trim(), options: texts, answer, explanation: d.explanation, issues };
}

/**
 * `pages` is the document's text, one entry per page (DOCX/TXT are a single page).
 * `key` holds every answer found in a key section or key line, as printed (resolve with `resolveAnswer`).
 */
export function parsePaper(pages: string[], optionCount: number): { questions: ParsedQuestion[]; key: Map<number, string> } {
  const drafts: Draft[] = [];
  const key = new Map<number, string>();
  const s = {
    cur: null as Draft | null,
    inKey: false,
    inExplain: false,
    pendingKey: null as { n: number; text: string; page: number } | null,
    pendingNums: null as number[] | null,
    keyN: null as number | null, // the key entry explanations below belong to
    keyExplain: false,
  };
  const keyExplanations = new Map<number, string>();

  // Lines on most pages (running headers, footers, a watermark such as "THE AUREONS MBBS '31") aren't content.
  const furniture = new Set<string>();
  if (pages.length >= 3) {
    const seen = new Map<string, number>();
    // Only a page's first two and last three lines can be furniture, and never a question, option or answer
    // line: "Answer: A" or "B. True" repeat on most pages of a long paper.
    for (const pg of pages) {
      const lines = pg.split("\n").map((x) => unbold(x).toLowerCase()).filter(Boolean);
      for (const l of new Set([...lines.slice(0, 2), ...lines.slice(-3)]))
        if (!Q_START.test(l) && !matchMarker(l) && !ANSWER_LINE.test(l) && !EXPLAIN.test(l)) seen.set(l, (seen.get(l) ?? 0) + 1);
    }
    for (const [l, n] of seen) if (n >= Math.max(3, pages.length * 0.5)) furniture.add(l);
  }
  const count = (d: Draft, style: Style) => d.parts.filter((p) => p.style === style).length;

  const close = () => {
    if (s.cur) drafts.push(s.cur);
    s.cur = null;
    s.inExplain = false;
  };
  const start = (n: number, text: string, page: number) => {
    close();
    const d: Draft = { number: n, page, stem: "", stemBold: false, parts: [], answer: null, explanation: null };
    // Options can sit on the question's own line: "1. Capital? A. Lagos B. Abuja C. Kano".
    const sp = splitInline(text, "letter", 0, true) ?? splitInline(text, "roman", 0, true);
    const stemText = sp ? sp.prefix : text;
    d.stemBold = boldShare(stemText) >= 0.8;
    d.stem = unbold(stemText);
    if (sp) for (const it of sp.items) d.parts.push(makePart(sp.style, it.idx, it.raw, it.body));
    s.cur = d;
  };
  // Numbered lines under a question are options when they count up from 1 ("1. Lagos 2. Abuja").
  const isNumberOption = (d: Draft, n: number, body: string) => {
    if (count(d, "letter") >= 2 || /\?\s*$/.test(body)) return false;
    const k = count(d, "number");
    // After two or more unmarked lines, a "1." is more likely a new section's first question.
    if (k === 0) return n === 1 && d.parts.filter((p) => p.style == null).length < 2;
    return n === k + 1 && n <= 8;
  };

  pages.forEach((pageText, p) => {
    for (const raw of pageText.replace(/\r/g, "").split("\n")) {
      let line = moveLeadingBold(raw.replace(/\s+/g, " ").trim());
      if (furniture.has(unbold(line).toLowerCase())) continue;
      // "○ A. Quickly": a bullet in front of a real marker is decoration.
      const deco = line.match(BULLET);
      if (deco && ((matchMarker(deco[1]) && matchMarker(deco[1])!.style !== "bullet") || Q_START.test(deco[1]))) line = deco[1];
      const plain = unbold(line);
      if (!plain) continue;

      // A key laid out as a table: a row of question numbers, then a row of answers.
      if (s.pendingNums) {
        const nums = s.pendingNums;
        s.pendingNums = null;
        const toks = plain.replace(KEY_ROW_LABEL, "").split(/[\s,|]+/).filter(Boolean);
        if (toks.length === nums.length && toks.every((t) => ANS_TOKEN.test(t))) {
          nums.forEach((n, i) => key.set(n, toks[i]));
          continue;
        }
      }
      if (NUM_ROW.test(plain)) {
        const nums = plain.match(/\d{1,3}/g)!.map(Number);
        if (nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) {
          s.pendingNums = nums;
          continue;
        }
      }

      // Answer-key heading ("ANSWERS", "Answer key:", "Marking scheme"), maybe with the key on the same line.
      const h = plain.match(KEY_HEADING);
      if (h) {
        const rest = h[1].trim();
        const titled = KEY_HEADING_STRONG.test(plain) && rest.split(/\s+/).length <= 6 && !rest.includes("?") && !SHORT_TOKEN.test(rest);
        const pairs = rest ? (keyLine(rest, true) ?? (titled ? [] : null)) : [];
        if (pairs) {
          close();
          s.inKey = true;
          s.pendingKey = null;
          for (const [n, a] of pairs) key.set(n, a);
          continue;
        }
      }
      // A lone "1. x" right under a question is more likely its first numbered option.
      const pairs = keyLine(plain, s.inKey);
      if (pairs && (s.inKey || pairs.length >= 2 || !s.cur || s.cur.parts.length > 0)) {
        for (const [n, a] of pairs) key.set(n, a);
        continue;
      }

      if (s.inKey) {
        // In a key, "12. Abuja" or "1. A - Quickly" is an answer. Only an option line straight after it
        // ("A. …") shows it was really a question, and that the questions have resumed.
        const q = plain.match(Q_START);
        const body = q?.[2].trim() ?? "";
        if (q && body) {
          key.set(Number(q[1]), body);
          s.pendingKey = { n: Number(q[1]), text: body, page: p + 1 };
          s.keyN = Number(q[1]);
          s.keyExplain = false;
          continue;
        }
        // "○ Explanation: …" under a key entry, and the lines that continue it.
        const exLine = (deco ? unbold(deco[1]) : plain).match(EXPLAIN);
        if (s.keyN != null && exLine) {
          keyExplanations.set(s.keyN, exLine[1].trim());
          s.keyExplain = true;
          continue;
        }
        if (s.keyExplain && CREDITS(plain)) {
          s.keyExplain = false;
          s.keyN = null;
          continue;
        }
        if (s.keyN != null && s.keyExplain && !q) {
          keyExplanations.set(s.keyN, `${keyExplanations.get(s.keyN)} ${plain}`.trim());
          continue;
        }
        const mk = matchMarker(line);
        if (s.pendingKey && mk && mk.style !== "bullet" && mk.idx === 0) {
          // That "answer" was a short question: an option follows it.
          const pk = s.pendingKey;
          key.delete(pk.n);
          s.inKey = false;
          s.pendingKey = null;
          s.keyN = null;
          start(pk.n, pk.text, pk.page);
        } else if (q && body) {
          s.inKey = false;
          s.pendingKey = null;
          s.keyN = null;
        } else continue;
      }

      const cur = s.cur;
      if (cur) {
        const ex = plain.match(EXPLAIN);
        if (ex) {
          cur.explanation = ex[1].trim();
          s.inExplain = true;
          continue;
        }
        const a = answerLine(plain);
        if (a) {
          cur.answer = a.token;
          if (a.explanation) cur.explanation = a.explanation;
          s.inExplain = !!a.explanation;
          continue;
        }
      }

      // "D. Ibadan      Ans: B"
      let trail: string | null = null;
      const ta = line.match(TRAIL_ANS);
      if (ta && ta.index! > 0) {
        trail = unbold(ta[1]);
        line = line.slice(0, ta.index).trim();
      }

      // "✓ B. Abuja" or "*B. Abuja" marks the answer; "* Abuja" on its own is a bullet.
      let lead = false;
      const tick = line.match(LEAD_TICK);
      if (tick) {
        lead = true;
        line = line.slice(tick[0].length);
      } else {
        const star = line.match(LEAD_STAR);
        const rest = star ? line.slice(star[0].length) : "";
        if (star && ((matchMarker(rest) && matchMarker(rest)!.style !== "bullet") || Q_START.test(rest))) {
          lead = true;
          line = rest;
        }
      }

      const q = line.match(Q_START) ?? line.match(Q_LABEL);
      if (q) {
        const n = Number(q[1]);
        if (cur && isNumberOption(cur, n, unbold(q[2]))) {
          cur.parts.push(makePart("number", n - 1, line, q[2], lead));
          s.inExplain = false;
        } else if (!cur || n > cur.number || cur.parts.length > 0) start(n, q[2], p + 1);
        else cur.parts.push(makePart(null, -1, line, line, lead));
        if (trail && s.cur) s.cur.answer = trail;
        continue;
      }
      if (!cur) continue;
      if (trail) cur.answer = trail;

      const mk = matchMarker(line);
      if (mk && mk.style !== "bullet") {
        const sp = splitInline(line, mk.style, count(cur, mk.style), false);
        if (sp) {
          sp.items.forEach((it, i) => cur.parts.push(makePart(sp.style, it.idx, it.raw, it.body, lead && i === 0)));
          s.inExplain = false;
          continue;
        }
        cur.parts.push(makePart(mk.style, mk.idx, line, mk.body, lead));
        s.inExplain = false;
        continue;
      }
      if (mk) {
        // "• Lagos • Abuja • Kano" on one line, or one bullet.
        const bits = line.split(new RegExp(`\\s+(?=[${BULLET_CHARS}]\\s)`));
        for (const bit of bits) {
          const b = matchMarker(bit);
          if (b) cur.parts.push(makePart("bullet", count(cur, "bullet"), bit, b.body, lead));
        }
        s.inExplain = false;
        continue;
      }
      if (s.inExplain) {
        cur.explanation = `${cur.explanation ?? ""} ${unbold(line)}`.trim();
        continue;
      }
      cur.parts.push(makePart(null, -1, line, line, lead));
    }
  });
  close();

  // A numbered list after the questions that repeats their numbers with no options is a key ("1. Abuja").
  const withOptions = new Set<number>();
  const questions: ParsedQuestion[] = [];
  for (const q of drafts.map((d) => finish(d, optionCount))) {
    if (q.options.length === 0 && withOptions.has(q.number)) {
      if (!key.has(q.number) && q.text) key.set(q.number, q.text);
      continue;
    }
    if (q.options.length) withOptions.add(q.number);
    if (!q.explanation && keyExplanations.has(q.number)) q.explanation = keyExplanations.get(q.number)!;
    questions.push(q);
  }
  return { questions, key };
}
