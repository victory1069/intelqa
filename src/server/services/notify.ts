import * as webpush from "web-push";
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";

const { notifications, pushSubscriptions, users } = schema;

export type Kind = "streak" | "paper" | "score_corrected" | "challenge" | "rank" | "name" | "daily";
export type Message = { kind: Kind; title: string; body: string; url?: string };

let configured: boolean | null = null;
function pushReady() {
  if (configured === null) {
    configured = !!(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    if (configured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  }
  return configured;
}

/** Which preference switches off which kind of push. Inbox entries are always kept. */
function wantsPush(u: { notifyStreak: boolean; notifyPapers: boolean; notifyDaily: boolean }, kind: Kind) {
  if (kind === "streak") return u.notifyStreak;
  if (kind === "daily") return u.notifyDaily;
  if (kind === "paper") return u.notifyPapers;
  return true;
}

/**
 * Stores the message in each student's inbox and sends it as a web push.
 * At most one push per student per day (the promise made on the A21 sheet); the inbox gets everything.
 */
export async function notify(userIds: string[], msg: Message) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return { stored: 0, pushed: 0 };
  await db.insert(notifications).values(ids.map((userId) => ({ userId, ...msg, url: msg.url ?? null })));
  if (!pushReady()) return { stored: ids.length, pushed: 0 };

  // Count inbox rows from the last 20 hours, including the one just written: 1 means this is today's first.
  const since = new Date(Date.now() - 20 * 3600 * 1000);
  const counts = new Map<string, number>();
  const rows = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    // The 8 am pop-quiz push sits outside the daily cap, so it never crowds out the 8 pm streak reminder.
    .where(and(inArray(notifications.userId, ids), gte(notifications.createdAt, since), ne(notifications.kind, "daily")));
  for (const r of rows) counts.set(r.userId, (counts.get(r.userId) ?? 0) + 1);

  const prefs = await db
    .select({ id: users.id, notifyStreak: users.notifyStreak, notifyPapers: users.notifyPapers, notifyDaily: users.notifyDaily })
    .from(users)
    .where(inArray(users.id, ids));
  // A corrected score and the morning pop quiz always get through; everything else is capped at one push a day.
  const uncapped = msg.kind === "score_corrected" || msg.kind === "daily";
  const targets = prefs
    .filter((u) => wantsPush(u, msg.kind) && (uncapped || (counts.get(u.id) ?? 0) <= 1))
    .map((u) => u.id);
  if (!targets.length) return { stored: ids.length, pushed: 0 };

  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, targets));
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? "/home", tag: msg.kind });
  let pushed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600, urgency: "normal" });
        pushed++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        else console.error("[push]", code, (e as Error).message);
      }
    }),
  );
  return { stored: ids.length, pushed };
}
