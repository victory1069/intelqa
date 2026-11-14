/**
 * Layout tests for the built-in paper parser: `npx tsx scripts/parser-cases.ts`.
 * Each case is a paper typed a different way; the check lists what must come out.
 */
import { parsePaper, parseAnswerKey, resolveAnswer } from "../src/server/services/parse-paper";
import { htmlToText } from "../src/server/services/docx-text";

type Want = { n: number; options?: string[]; answer?: number | null; textHas?: string };
const cases: { name: string; pages: string[]; want: Want[]; optionCount?: number }[] = [];
const add = (name: string, text: string | string[], want: Want[], optionCount = 4) =>
  cases.push({ name, pages: Array.isArray(text) ? text : [text], want, optionCount });

add(
  "letters, inline answer",
  `1. Which of these is a vowel?
A. b
B. c
C. a
D. d
Answer: C`,
  [{ n: 1, options: ["b", "c", "a", "d"], answer: 2 }],
);

add(
  "answer key on the last page (PDF pages)",
  [
    `1. Capital of Nigeria is
(a) Lagos (b) Abuja (c) Kano (d) Ibadan
2. The plural of child is
a) childs
b) children
c) childrens
d) child`,
    `3. 2 + 2 =
A. 3 B. 4 C. 5 D. 6`,
    `ANSWERS
1. B
2. B
3. B`,
  ],
  [{ n: 1, options: ["Lagos", "Abuja", "Kano", "Ibadan"] }, { n: 2, options: ["childs", "children", "childrens", "child"] }, { n: 3 }],
);

add(
  "key with no heading, several per line",
  `1. One?
A. x B. y C. z D. w
2. Two?
A. x B. y C. z D. w
1. C 2. D`,
  [{ n: 1 }, { n: 2 }],
);

add(
  "roman numeral options",
  `1. Which is a noun?
i. run
ii. table
iii. quickly
iv. blue
Ans: ii`,
  [{ n: 1, options: ["run", "table", "quickly", "blue"], answer: 1 }],
);

add(
  "numbered options under a question",
  `5. Which planet is largest?
1. Mars
2. Jupiter
3. Venus
4. Earth
6. Next question?
A. a B. b C. c D. d`,
  [{ n: 5, options: ["Mars", "Jupiter", "Venus", "Earth"] }, { n: 6, options: ["a", "b", "c", "d"] }],
);

add(
  "bullet options, starred answer",
  `1. Pick the mammal
• Shark
• Whale *
• Trout
• Eel`,
  [{ n: 1, options: ["Shark", "Whale", "Trout", "Eel"], answer: 1 }],
);

add(
  "dash options",
  `1) Pick the colour
- Red
- Table
- Chair
- Spoon
Answer: Red`,
  [{ n: 1, options: ["Red", "Table", "Chair", "Spoon"], answer: 0 }],
);

add(
  "roman statements inside, lettered options",
  `1. Which of the following are true?
i. The sun is a star
ii. The moon is a planet
iii. Water boils at 100°C
A. i and ii only
B. i and iii only
C. ii and iii only
D. i, ii and iii
Answer: B`,
  [{ n: 1, options: ["i and ii only", "i and iii only", "ii and iii only", "i, ii and iii"], answer: 1, textHas: "\ni. The sun is a star" }],
);

add(
  "no option markers",
  `1. The capital of Kwara State is?
Ilorin
Offa
Jebba
Omu-Aran`,
  [{ n: 1, options: ["Ilorin", "Offa", "Jebba", "Omu-Aran"] }],
);

add(
  "answer at the end of the option line, ticked option",
  `Q1. Largest ocean?
A. Atlantic
B. Indian
C. Pacific
D. Arctic      Ans: C
Q2. Smallest prime?
A. 0
✓ B. 2
C. 1
D. 3`,
  [{ n: 1, answer: 2 }, { n: 2, answer: 1, options: ["0", "2", "1", "3"] }],
);

add(
  "key as a range and as text",
  `1. a?
A. x B. y C. z D. w
2. b?
A. x B. y C. z D. w
3. c?
A. x B. y C. z D. w
Answer key
1-3: BCA`,
  [{ n: 1 }, { n: 2 }, { n: 3 }],
);

add(
  "key written as the option's text",
  `1. Capital of Nigeria?
A. Lagos
B. Abuja
C. Kano
D. Ibadan
2. Largest planet?
A. Mars
B. Earth
C. Jupiter
D. Venus
MARKING SCHEME
1. Abuja
2. Jupiter`,
  [{ n: 1 }, { n: 2 }],
);

add(
  "key as a table (numbers row, letters row)",
  `1. a?
A. x B. y C. z D. w
2. b?
A. x B. y C. z D. w
3. c?
A. x B. y C. z D. w
Question 1 2 3
Answer D A C`,
  [{ n: 1 }, { n: 2 }, { n: 3 }],
);

add(
  "Question N label, options in brackets [A]",
  `Question 1: What is H2O?
[A] Salt
[B] Water
[C] Acid
[D] Base
Correct answer is (b)`,
  [{ n: 1, options: ["Salt", "Water", "Acid", "Base"], answer: 1 }],
);

add(
  "bold option from DOCX",
  htmlToText(`<p>1. Pick the verb</p><p>A. table</p><p><strong>B. run</strong></p><p>C. chair</p><p>D. blue</p>`),
  [{ n: 1, options: ["table", "run", "chair", "blue"], answer: 1 }],
);

add(
  "Word auto-numbered list with nested option list",
  htmlToText(
    `<ol><li>Capital of Nigeria?<ol><li>Lagos</li><li><strong>Abuja</strong></li><li>Kano</li><li>Ibadan</li></ol></li><li>2 + 2?<ol><li>3</li><li>4</li><li>5</li><li>6</li></ol></li></ol>`,
  ),
  [{ n: 1, options: ["Lagos", "Abuja", "Kano", "Ibadan"], answer: 1 }, { n: 2, options: ["3", "4", "5", "6"] }],
);

add(
  "plain question paragraphs, options as an auto list",
  htmlToText(`<p>1. Pick the fruit</p><ol><li>Mango</li><li>Stone</li><li>Brick</li><li>Sand</li></ol><p>2. Pick the metal</p><ol><li>Wood</li><li>Iron</li><li>Glass</li><li>Paper</li></ol>`),
  [{ n: 1, options: ["Mango", "Stone", "Brick", "Sand"] }, { n: 2, options: ["Wood", "Iron", "Glass", "Paper"] }],
);

add(
  "short question after the key heading is not swallowed",
  `1. a?
A. x B. y C. z D. w
ANSWERS
1. A
2. Define osmosis
A. one
B. two
C. three
D. four`,
  [{ n: 1 }, { n: 2, options: ["one", "two", "three", "four"] }],
);

add(
  "key gives option numbers",
  `1. One?
1. x
2. y
3. z
4. w
2. Two?
A. x B. y C. z D. w
Answer key
1. 3   2. 2`,
  [{ n: 1, options: ["x", "y", "z", "w"] }, { n: 2 }],
);

add(
  "bulleted lettered options, watermark, key with explanations (class PQ handout)",
  [
    `GNS111 CA PQs - Questions and Answers
Questions
1. Which of the following is part of a lexical class?
○ A. Quickly
○ B. Can
○ C. And
○ D. But
THE AUREONS MBBS '31`,
    `2. Number of vowel sounds in American English?
○ A. 16
○ B. 18
○ C. 14
○ D. 12
THE AUREONS MBBS '31`,
    `3. Which of the following is a low front vowel?
○ A. /u/
○ B. /ɔ/
○ C. /i/
○ D. /æ/
ANSWER KEY WITH DETAILED EXPLANATIONS
1. A - Quickly
○ Explanation: "Quickly" is an adverb, which is a lexical class.
THE AUREONS MBBS '31`,
    `2. 2. C - 14
○ -Explanation: The common value given is 14.
3. D /æ/
○ Explanation: /æ/ is a low front vowel.
GNS111 | 30 Questions | 15 Minutes
Answered by: A Student (08000000000)
THE AUREONS MBBS '31`,
  ],
  [{ n: 1, options: ["Quickly", "Can", "And", "But"] }, { n: 2, options: ["16", "18", "14", "12"] }, { n: 3, options: ["/u/", "/ɔ/", "/i/", "/æ/"] }],
);

add(
  "answer lines repeated at the foot of every page are kept",
  [1, 2, 3, 4].map((n) => `${n}. Question ${n}?\nA. x\nB. y\nC. z\nD. w\nAnswer: A`),
  [1, 2, 3, 4].map((n) => ({ n, answer: 0 })),
);

// Expected key answers per case (after resolveAnswer).
const keyWant: Record<string, Record<number, number>> = {
  "answer key on the last page (PDF pages)": { 1: 1, 2: 1, 3: 1 },
  "key with no heading, several per line": { 1: 2, 2: 3 },
  "key as a range and as text": { 1: 1, 2: 2, 3: 0 },
  "key written as the option's text": { 1: 1, 2: 2 },
  "key as a table (numbers row, letters row)": { 1: 3, 2: 0, 3: 2 },
  "short question after the key heading is not swallowed": { 1: 0 },
  "key gives option numbers": { 1: 2, 2: 1 },
  "bulleted lettered options, watermark, key with explanations (class PQ handout)": { 1: 0, 2: 2, 3: 3 },
};

let failed = 0;
for (const c of cases) {
  const { questions, key } = parsePaper(c.pages, c.optionCount ?? 4);
  const problems: string[] = [];
  if (questions.length !== c.want.length) problems.push(`expected ${c.want.length} questions, got ${questions.length} (${questions.map((q) => q.number).join(",")})`);
  for (const w of c.want) {
    const q = questions.find((x) => x.number === w.n);
    if (!q) {
      problems.push(`Q${w.n} missing`);
      continue;
    }
    if (w.options && JSON.stringify(q.options) !== JSON.stringify(w.options)) problems.push(`Q${w.n} options ${JSON.stringify(q.options)}`);
    if (w.answer !== undefined && q.answer !== w.answer) problems.push(`Q${w.n} answer ${q.answer}, want ${w.answer}`);
    if (w.textHas && !q.text.includes(w.textHas)) problems.push(`Q${w.n} text ${JSON.stringify(q.text)}`);
  }
  for (const [n, want] of Object.entries(keyWant[c.name] ?? {})) {
    const q = questions.find((x) => x.number === Number(n));
    const got = resolveAnswer(key.get(Number(n)), q?.options ?? []);
    if (got !== want) problems.push(`key Q${n} = ${JSON.stringify(key.get(Number(n)))} → ${got}, want ${want}`);
  }
  if (problems.length) {
    failed++;
    console.log(`✕ ${c.name}\n   ${problems.join("\n   ")}`);
    for (const q of questions) console.log(`     Q${q.number} ${JSON.stringify(q.text)} ${JSON.stringify(q.options)} ans=${q.answer} ${q.issues.join("; ")}`);
  } else console.log(`✓ ${c.name}`);
}

const fileKey = parseAnswerKey("1. B\n2-C\n3) d\n4 (a)\n5. Abuja");
const fk = JSON.stringify([...fileKey]);
if (fk !== JSON.stringify([[1, "B"], [2, "C"], [3, "d"], [4, "a"], [5, "Abuja"]])) {
  failed++;
  console.log(`✕ separate key file ${fk}`);
} else console.log("✓ separate key file");

console.log(failed ? `\n${failed} failed` : "\nAll layouts read");
process.exit(failed ? 1 : 0);
