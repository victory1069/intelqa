/**
 * DOCX → text for question extraction. Unlike mammoth's raw text, this keeps what a
 * lecturer's formatting says:
 *   - Word's automatic numbering, which isn't part of the text: questions in a numbered
 *     list become "1.", "2."…; a nested list (the options) becomes "A.", "B."…; a list
 *     under a plain question paragraph becomes "1.", "2."… (the parser reads those as options).
 *   - Bold and underline, written as **text**, because the correct option is often bolded.
 *   - Table rows as lines (keys are often typed as a table), images as "[diagram]".
 */
import mammoth from "mammoth";
import { LETTERS } from "@/shared/game";

type Node = { tag: string; children: (Node | string)[] };

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const VOID = new Set(["br", "img", "hr"]);
const BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "blockquote"]);

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

function parseHtml(html: string): Node {
  const root: Node = { tag: "root", children: [] };
  const stack: Node[] = [root];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (m[4] != null) {
      stack.at(-1)!.children.push(decode(m[4]));
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const node: Node = { tag, children: [] };
    stack.at(-1)!.children.push(node);
    if (!VOID.has(tag) && !m[3].trim().endsWith("/")) stack.push(node);
  }
  return root;
}

const isList = (c: Node | string): c is Node => typeof c !== "string" && (c.tag === "ol" || c.tag === "ul");

/** Exported for tests; `marks: false` drops the ** bold marks (for showing the text to a person). */
export function htmlToText(html: string, { marks = true } = {}): string {
  const lines: string[] = [];
  let line = "";
  let questionNo = 0;
  let prev: "p" | "list" | null = null;
  const flush = () => {
    const t = line.replace(/\*\*\s*\*\*/g, "").replace(/\s+/g, " ").trim();
    if (t && t !== "**") lines.push(t);
    line = "";
  };

  const walk = (n: Node | string, depth: number) => {
    if (typeof n === "string") {
      line += n;
      return;
    }
    const kids = () => n.children.forEach((c) => walk(c, depth));
    if (n.tag === "strong" || n.tag === "b" || n.tag === "u") {
      if (marks) line += "**";
      kids();
      if (marks) line += "**";
    } else if (n.tag === "br") flush();
    else if (n.tag === "img") line += " [diagram] ";
    else if (n.tag === "td" || n.tag === "th") {
      kids();
      line += "  ";
    } else if (BLOCK.has(n.tag)) {
      flush();
      kids();
      flush();
      if (n.tag !== "tr") prev = "p";
    } else if (isList(n)) {
      flush();
      const items = n.children.filter((c): c is Node => typeof c !== "string" && c.tag === "li");
      const d = depth + 1;
      // A short top-level list straight under a paragraph is that question's options.
      const asOptions = n.tag === "ol" && d === 1 && prev === "p" && items.length >= 2 && items.length <= 6 && items.every((li) => !li.children.some(isList));
      items.forEach((li, i) => {
        const marker =
          n.tag === "ul"
            ? "•"
            : d === 1
              ? `${asOptions ? i + 1 : ++questionNo}.`
              : d === 2 && items.length <= LETTERS.length
                ? `${LETTERS[i]}.`
                : `${ROMAN[i] ?? i + 1}.`;
        flush();
        line = `${marker} `;
        for (const c of li.children) {
          if (isList(c)) flush();
          walk(c, d);
        }
        flush();
      });
      prev = "list";
    } else kids();
  };

  walk(parseHtml(html), 0);
  flush();
  return lines.join("\n");
}

export async function docxText(buffer: Buffer, opts?: { marks?: boolean }): Promise<string> {
  const { value } = await mammoth.convertToHtml(
    { buffer },
    { styleMap: ["u => u"], convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  return htmlToText(value, opts);
}
