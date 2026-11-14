import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { claude, MODEL } from "../lib/claude";
import { lagosDate } from "../lib/time";
import { LETTERS } from "@/shared/game";

const { askMessages, questions, courses } = schema;

/** Lagos midnight today as a UTC instant. */
function startOfLagosDay() {
  return new Date(`${lagosDate()}T00:00:00+01:00`);
}

export async function askUsedToday(userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(askMessages)
    .where(and(eq(askMessages.userId, userId), eq(askMessages.role, "assistant"), gte(askMessages.createdAt, startOfLagosDay())));
  return n;
}

export function askRemaining(used: number) {
  return Math.max(0, env.ASK_DAILY_LIMIT - used);
}

export async function askHistory(userId: string, questionId: string) {
  return db
    .select({ role: askMessages.role, content: askMessages.content, createdAt: askMessages.createdAt })
    .from(askMessages)
    .where(and(eq(askMessages.userId, userId), eq(askMessages.questionId, questionId)))
    .orderBy(asc(askMessages.createdAt));
}

/**
 * Streams a reply about one question. Messages are stored only once the reply
 * completes, so a dropped connection doesn't use up one of the day's questions.
 */
export async function streamAsk(opts: {
  userId: string;
  questionId: string;
  message: string;
  chosenOption: number | null;
  onText: (delta: string) => Promise<void> | void;
}) {
  const [q] = await db
    .select({ q: questions, course: courses })
    .from(questions)
    .innerJoin(courses, eq(courses.id, questions.courseId))
    .where(eq(questions.id, opts.questionId));
  if (!q) throw new Error("Question not found");

  const history = await askHistory(opts.userId, opts.questionId);
  const key = q.q.correctOption;
  const system = `You are a calm, friendly tutor helping a first-year Nigerian university student with ONE past question from ${q.course.code} (${q.course.title}).

The question:
${q.q.text}
${q.q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n")}

Correct answer: ${key != null ? `${LETTERS[key]}. ${q.q.options[key]}` : "not confirmed"}${q.q.answerVerified ? "" : " (this key has not been checked by a tutor yet; say so if it matters)"}
The student picked: ${opts.chosenOption != null ? `${LETTERS[opts.chosenOption]}. ${q.q.options[opts.chosenOption]}` : "nothing (skipped)"}
Checked explanation: ${q.q.explanation ?? "none yet"}

Stay on this question and the idea behind it. If the student asks about something unrelated, say briefly that you can only help with this question and suggest they practise the topic. Keep replies short: a few sentences, plain English, with an example where it helps. Use $...$ for maths.`;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
    { role: "user", content: opts.message },
  ];

  const stream = claude().messages.stream({
    model: MODEL,
    max_tokens: 8000,
    system,
    output_config: { effort: "medium" },
    messages,
  });
  stream.on("text", (delta) => void opts.onText(delta));
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("I can't help with that one. Try asking about the question itself.");

  const reply = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const now = Date.now();
  await db.insert(askMessages).values([
    { userId: opts.userId, questionId: opts.questionId, role: "user", content: opts.message, createdAt: new Date(now) },
    { userId: opts.userId, questionId: opts.questionId, role: "assistant", content: reply, createdAt: new Date(now + 1) },
  ]);
  return reply;
}
