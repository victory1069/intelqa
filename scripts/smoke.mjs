// End-to-end API smoke test against a local dev server with DEV_AUTH=1 and seeded data.
// Usage: node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3000/api";
const STUDENT = "00000000-0000-4000-8000-000000000001";
const CONTENT = "00000000-0000-4000-8000-000000000002";
const SUPER = "00000000-0000-4000-8000-000000000003";

let failures = 0;
async function call(user, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "x-dev-user": user, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  · " + detail : ""}`);
  if (!ok) failures++;
}

const health = await call(STUDENT, "GET", "/health");
check("health", health.status === 200);

const me = await call(STUDENT, "GET", "/me");
check("GET /me", me.status === 200 && me.json.displayName === "Aisha Bello", `level ${me.json.xp?.level?.name}, streak ${me.json.streak?.current}`);

const home = await call(STUDENT, "GET", "/me/home");
check("GET /me/home", home.status === 200 && home.json.courses?.length === 5, `${home.json.courses?.length} courses, daily ${home.json.daily?.courseCode}`);
const gst = home.json.courses.find((c) => c.code === "GST 111");
check("GST 111 rank shown", !!gst?.rank, JSON.stringify(gst?.rank));

const course = await call(STUDENT, "GET", `/catalog/courses/${gst.id}`);
check("GET course page", course.status === 200 && course.json.papers.length === 1, `${course.json.topics.length} topics`);
const paper = course.json.papers[0];

const start = await call(STUDENT, "POST", "/attempts", { mode: "exam", paperId: paper.id });
check("start exam", start.status === 201 && start.json.questions.length === 20, `deadline ${start.json.deadlineAt}`);
const leaked = JSON.stringify(start.json).includes("correctOption") || JSON.stringify(start.json).includes("explanation");
check("no answers leaked before submit", !leaked);

const review0 = await call(STUDENT, "GET", `/attempts/${start.json.id}/review`);
check("review blocked before submit", review0.status === 403);

// Answer every question with its first displayed option, flag one, skip two.
const answers = start.json.questions.slice(0, 18).map((q, i) => ({ questionId: q.id, choice: q.options[0].key, flagged: i === 3, timeSpentMs: 30000 }));
const save = await call(STUDENT, "PATCH", `/attempts/${start.json.id}`, { answers });
check("save answers", save.status === 200);

const resume = await call(STUDENT, "GET", `/attempts/${start.json.id}`);
check("resume keeps answers", resume.json.answers.length === 18);

const submit = await call(STUDENT, "POST", `/attempts/${start.json.id}/submit`);
check("submit", submit.status === 200, `score ${submit.json.score}/${submit.json.maxScore}, xp +${submit.json.xp?.earned}, flagged ${submit.json.flagged}`);
const again = await call(STUDENT, "POST", `/attempts/${start.json.id}/submit`);
check("double submit is idempotent", again.json.xp?.earned === submit.json.xp?.earned && again.json.score === submit.json.score);

const result = await call(STUDENT, "GET", `/attempts/${start.json.id}/result`);
check("result + breakdown", result.status === 200 && result.json.breakdown.length > 0, `${result.json.percent}% · ${result.json.breakdown.map((b) => `${b.name} ${b.correct}/${b.total}`).join(", ")}`);

const review = await call(STUDENT, "GET", `/attempts/${start.json.id}/review?filter=missed`);
check("review missed", review.status === 200 && review.json.items.every((i) => !i.correct), `${review.json.items.length} to review`);

const board = await call(STUDENT, "GET", `/leaderboard?board=course&course=${gst.id}`);
check("course board", board.status === 200 && board.json.top.length === 10, `${board.json.total} ranked; you need 3 ranked attempts to appear`);
const dept = await call(STUDENT, "GET", "/leaderboard?board=department&period=week");
check("department board", dept.status === 200, `me #${dept.json.me?.rank} of ${dept.json.total}`);
const friends = await call(STUDENT, "GET", "/leaderboard?board=friends");
check("friends board", friends.status === 200 && friends.json.total === 5, `${friends.json.total} people`);

const daily = await call(STUDENT, "POST", "/attempts", { mode: "daily", courseId: gst.id });
check("start daily", daily.status === 201 && daily.json.questions.length === 10);
const dailyAgain = await call(STUDENT, "POST", "/attempts", { mode: "daily", courseId: gst.id });
check("daily is one per day", dailyAgain.status === 409);

const drill = await call(STUDENT, "POST", "/attempts", { mode: "drill", courseId: gst.id, size: 10 });
check("start drill", drill.status === 201 && drill.json.questions.length === 10);

const topicId = course.json.topics[0].id;
const topic = await call(STUDENT, "POST", "/attempts", { mode: "topic", topicId });
check("start topic practice", topic.status === 201 && topic.json.instantFeedback === true);
const q0 = topic.json.questions[0];
const checked = await call(STUDENT, "POST", `/attempts/${topic.json.id}/check`, { questionId: q0.id, choice: q0.options[0].key });
check("topic instant feedback", checked.status === 200 && typeof checked.json.correct === "boolean" && !!checked.json.question.explanation);
const examCheck = await call(STUDENT, "POST", `/attempts/${drill.json.id}/check`, { questionId: drill.json.questions[0].id, choice: 0 });
check("no instant feedback in drills", examCheck.status === 403);

const report = await call(STUDENT, "POST", `/questions/${q0.id}/report`, { reason: "typo", note: "smoke test" });
check("report a question", report.status === 201);

const bm = await call(STUDENT, "PUT", `/me/bookmarks/${q0.id}`);
const bms = await call(STUDENT, "GET", "/me/bookmarks");
check("bookmark", bm.status === 200 && bms.json.bookmarks.length === 1);

const ch = await call(STUDENT, "POST", "/challenges", { paperId: paper.id });
check("create challenge", ch.status === 201, `code ${ch.json.code}`);
const pub = await fetch(`${BASE}/public/challenges/${ch.json.code}`).then((r) => r.json());
check("public challenge (no auth)", pub.creator?.name === "Aisha Bello" && pub.target?.maxScore === 20);

// Admin
const blocked = await call(STUDENT, "GET", "/admin/dashboard");
check("students can't reach admin", blocked.status === 403);
const dash = await call(CONTENT, "GET", "/admin/dashboard");
check("content admin dashboard", dash.status === 200, JSON.stringify(dash.json.waiting));
const bank = await call(CONTENT, "GET", `/admin/questions?course=${gst.id}`);
check("question bank", bank.status === 200 && bank.json.total === 20);
const notMine = await call(CONTENT, "GET", `/admin/questions?course=${home.json.courses.find((c) => c.code === "MTH 101").id}`);
check("content admin scoped to own courses", notMine.status === 403);
const stats = await call(CONTENT, "GET", `/admin/questions/${q0.id}`);
check("question stats", stats.status === 200 && stats.json.optionStats.length === 4, `${stats.json.attempts} attempts, ${stats.json.reports.length} reports`);
const reports = await call(CONTENT, "GET", "/admin/questions/reports/queue");
check("reports queue", reports.status === 200 && reports.json.reports.length >= 1);
const superOnly = await call(CONTENT, "GET", "/admin/catalogue");
check("catalogue is super-only", superOnly.status === 403);
const cat = await call(SUPER, "GET", "/admin/catalogue");
check("super admin catalogue", cat.status === 200 && cat.json.institutions.length === 3);
const analytics = await call(SUPER, "GET", `/admin/analytics?course=${gst.id}`);
check("analytics", analytics.status === 200, `retention ${analytics.json.retention3Days}%`);
const mod = await call(SUPER, "GET", "/admin/moderation/sessions");
check("moderation queue", mod.status === 200);

// Key change regrades past attempts
const before = await call(STUDENT, "GET", `/attempts/${start.json.id}/result`);
const qFull = (await call(CONTENT, "GET", `/admin/questions/${start.json.questions[0].id}`)).json.question;
// Make the option the student picked the right one (or, if it already was, a wrong one) so the score must move.
const picked = start.json.questions[0].options[0].key;
const newKey = picked === qFull.correctOption ? (picked + 1) % qFull.options.length : picked;
const edit = await call(CONTENT, "PATCH", `/admin/questions/${qFull.id}`, { correctOption: newKey });
const after = await call(STUDENT, "GET", `/attempts/${start.json.id}/result`);
check("changing a key regrades attempts", edit.status === 200 && edit.json.regrade?.attempts >= 1, `score ${before.json.score} → ${after.json.score}`);
await call(CONTENT, "PATCH", `/admin/questions/${qFull.id}`, { correctOption: qFull.correctOption });

// Notifications: the regrade above told the student, and the inbox can be cleared
const inbox = await call(STUDENT, "GET", "/me/notifications");
check("score correction lands in the inbox", inbox.status === 200 && inbox.json.notifications.some((n) => n.kind === "score_corrected"), `${inbox.json.notifications?.length} notifications`);
await call(STUDENT, "POST", "/me/notifications/read");
const me2 = await call(STUDENT, "GET", "/me");
check("mark all read", me2.json.unread === 0);
const badSub = await call(STUDENT, "POST", "/me/push", { endpoint: "not a url" });
check("push subscription is validated", badSub.status === 422);
const week = await call(STUDENT, "GET", "/me/week");
check("weekly share card", week.status === 200 && week.json.xp > 0, `week ${week.json.week}, best ${week.json.best?.code} #${week.json.best?.rank}`);
const prefs = await call(STUDENT, "PATCH", "/me/profile", { notifyStreak: false });
check("notification preferences", prefs.status === 200 && prefs.json.notify?.streak === false);
await call(STUDENT, "PATCH", "/me/profile", { notifyStreak: true });

// Admin upload pipeline (typed TXT sample; works without ANTHROPIC_API_KEY via the built-in parser)
{
  const { readFile } = await import("node:fs/promises");
  const config = (await call(CONTENT, "GET", "/admin/uploads/config")).json;
  check("upload config", !!config.storage && !!config.extractor, `storage ${config.storage}, reader ${config.extractor}`);
  const mine = (await call(CONTENT, "GET", "/admin/my-courses")).json.courses;
  const gst112 = mine.find((c) => c.code === "GST 112");
  const upload = async (file, type, session) => {
    const fd = new FormData();
    fd.append("courseId", gst112.id);
    fd.append("session", session);
    fd.append("timeLimitMin", "10");
    fd.append("files", new Blob([await readFile(new URL(`../samples/${file}`, import.meta.url))], { type }), file);
    const res = await fetch(BASE + "/admin/uploads", { method: "POST", headers: { "x-dev-user": CONTENT }, body: fd });
    return { status: res.status, json: await res.json() };
  };
  const up = await upload("GST111-2020-2021-with-problems.txt", "text/plain", "2015/2016");
  check("upload a typed paper", up.status === 202, up.json.error ?? "");
  let view;
  for (let i = 0; i < 60; i++) {
    view = (await call(CONTENT, "GET", `/admin/uploads/${up.json.id}`)).json;
    if (view.upload?.status !== "processing") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  check("upload reaches review", view.upload?.status === "in_review" && !!view.paper, view.upload?.log?.join(" | "));
  const draft = (await call(CONTENT, "GET", `/admin/papers/${view.paper.id}`)).json;
  const q2 = draft.questions.find((q) => q.sourceNumber === 2);
  check("drafts are flagged, not published", draft.counts.total === 4 && draft.counts.flagged >= 2 && q2?.flags.some((f) => /3 options/.test(f)), JSON.stringify(draft.counts));
  const dupe = await upload("GST111-2020-2021-with-problems.txt", "text/plain", "2015/2016");
  check("same paper twice is refused", dupe.status === 409);
  if (config.extractor === "local") {
    const photo = await upload("GST112-2022-2023-answer-key.txt", "image/png", "2014/2015");
    check("photos refused without an API key", photo.status === 422);
  }
  const del = await call(CONTENT, "DELETE", `/admin/uploads/${up.json.id}`);
  check("delete an unpublished upload", del.status === 200);

  // Options marked with letters, roman numerals, numbers, bullets, dashes and nothing; the key is on the last page.
  const mixed = await upload("GST111-2019-2020-mixed-formats.pdf", "application/pdf", "2013/2014");
  check("upload a mixed-format PDF", mixed.status === 202, mixed.json.error ?? "");
  let mv;
  for (let i = 0; i < 60; i++) {
    mv = (await call(CONTENT, "GET", `/admin/uploads/${mixed.json.id}`)).json;
    if (mv.upload?.status !== "processing") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const md = mv.paper ? (await call(CONTENT, "GET", `/admin/papers/${mv.paper.id}`)).json : { questions: [] };
  const keys = Object.fromEntries(md.questions.map((q) => [q.sourceNumber, q.correctOption]));
  const want = [1, 1, 1, 2, 1, 1, 2, 1, 0, 1, 0, 1];
  check(
    "every option style read, key from the last page",
    md.questions.length === 12 && md.questions.every((q) => q.options.length === 4) && want.every((k, i) => keys[i + 1] === k),
    `${md.questions.length} questions, keys ${JSON.stringify(keys)}`,
  );
  await call(CONTENT, "DELETE", `/admin/uploads/${mixed.json.id}`);
}

// Practice tests: an admin sets the rules, the questions are drawn at random, students sit it.
{
  const big = await call(CONTENT, "POST", "/admin/quizzes", { courseId: gst.id, title: "Too big", questionCount: 26, timeLimitMin: 20 });
  check("practice test capped at 25 questions", big.status === 422);
  const made = await call(CONTENT, "POST", "/admin/quizzes", { courseId: gst.id, title: "Smoke practice test", questionCount: 10, timeLimitMin: 10 });
  check("draw a practice test", made.status === 201, made.json.error ?? "");
  const qid = made.json.id;
  const hidden = await call(STUDENT, "GET", `/quizzes?course=${gst.id}`);
  check("drafts are hidden from students", !hidden.json.quizzes.some((q) => q.id === qid));
  const view = await call(CONTENT, "GET", `/admin/quizzes/${qid}`);
  const topicsDrawn = new Set(view.json.questions.map((q) => q.topicName)).size;
  check("draw spreads across topics", view.json.questions.length === 10 && topicsDrawn > 1, `${topicsDrawn} topics`);
  const swap = await call(CONTENT, "POST", `/admin/quizzes/${qid}/swap`, { questionId: view.json.questions[0].id });
  check("swap one question", swap.status === 200 && swap.json.questionId !== view.json.questions[0].id);
  await call(CONTENT, "PATCH", `/admin/quizzes/${qid}`, { status: "live" });
  const listed = await call(STUDENT, "GET", "/quizzes");
  check("live test shows for students", listed.json.quizzes.some((q) => q.id === qid));
  const sit = await call(STUDENT, "POST", "/attempts", { mode: "quiz", quizId: qid });
  check("sit the test", sit.status === 201 && sit.json.questions.length === 10 && sit.json.quiz?.title === "Smoke practice test" && !JSON.stringify(sit.json).includes("correctOption"));
  const graded = await call(STUDENT, "POST", `/attempts/${sit.json.id}/submit`);
  check("submit the test", graded.status === 200 && graded.json.maxScore === 10 && !graded.json.countsForBoard);
  const redraw = await call(CONTENT, "POST", `/admin/quizzes/${qid}/redraw`);
  check("questions fixed once sat", redraw.status === 409);
  await call(CONTENT, "PATCH", `/admin/quizzes/${qid}`, { status: "closed" });
  const late = await call(STUDENT, "POST", "/attempts", { mode: "quiz", quizId: qid });
  check("closed test can't be sat", late.status === 410);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
