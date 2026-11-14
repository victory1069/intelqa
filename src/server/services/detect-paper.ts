/**
 * Reads the course code, session, semester and exam type from a paper's file name and
 * header ("GST 111: Communication in English · 2019/2020 First Semester Examination"),
 * so the upload form can fill them in. Only typed files have a header to read; for photos
 * the file name is all there is.
 */
import { docxText } from "./docx-text";

export type Detected = {
  courseCodes: string[];
  session: string | null;
  semester: 1 | 2 | null;
  examType: "exam" | "test" | "post_utme" | null;
};

async function headerText(bytes: Buffer, mime: string, name: string): Promise<string> {
  try {
    if (mime === "text/plain" || name.endsWith(".txt")) return bytes.toString("utf8");
    if (mime.includes("wordprocessingml") || name.endsWith(".docx")) return docxText(bytes, { marks: false });
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: false });
      return text[0] ?? "";
    }
  } catch {
    // An unreadable file just means nothing is detected.
  }
  return "";
}

/** "2019/2020", "2019-20", "2019_2020" → "2019/2020" (the second year must follow the first). */
function findSession(s: string): string | null {
  for (const m of s.matchAll(/\b((?:19|20)\d{2})\s*[/\-–_ ]\s*(\d{4}|\d{2})\b/g)) {
    const a = Number(m[1]);
    const b = m[2].length === 2 ? Math.floor(a / 100) * 100 + Number(m[2]) : Number(m[2]);
    if (b === a + 1) return `${a}/${b}`;
  }
  return null;
}

export function detectFromText(name: string, text: string): Detected {
  // The header is the top of the paper; questions further down can mention other courses or years.
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const firstQ = lines.findIndex((l) => /^\s*(?:Q(?:uestion)?\s*)?\(?1\s*[.):]/i.test(l));
  const header = lines.slice(0, firstQ >= 0 ? Math.min(firstQ, 12) : 12).join("\n");
  const top = `${name.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ")}\n${header}`;
  const courseCodes = [...new Set([...top.toUpperCase().matchAll(/\b([A-Z]{3})\s*-?\s*(\d{3})\b/g)].map((m) => `${m[1]} ${m[2]}`))];
  const semester = /\b(?:first|1st|harmattan)\s+semester\b|\bsemester\s*(?:1|one|i)\b/i.test(top)
    ? 1
    : /\b(?:second|2nd|rain)\s+semester\b|\bsemester\s*(?:2|two|ii)\b/i.test(top)
      ? 2
      : null;
  const examType = /\bpost[\s-]?utme\b/i.test(top)
    ? "post_utme"
    : /\b(?:test|c\.\s?a\.?|continuous\s+assessment)\b/i.test(top) || /\bCA\b/.test(top)
      ? "test"
      : /\bexam(?:ination)?\b/i.test(top)
        ? "exam"
        : null;
  return { courseCodes, session: findSession(top), semester, examType };
}

export async function detectPaper(file: File): Promise<Detected> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return detectFromText(file.name, await headerText(bytes, file.type, file.name));
}
