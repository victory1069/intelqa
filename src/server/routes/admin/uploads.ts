import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { env } from "../../env";
import { fail, parse } from "../../lib/http";
import { docxText } from "../../services/docx-text";
import { detectPaper } from "../../services/detect-paper";
import { getObject, putObject, signedUrl } from "../../lib/storage";
import { startExtraction } from "../../services/extraction";
import { adminCourseIds, assertCourseAccess } from "../../middleware/admin";
import type { AppEnv } from "../../types";

const { uploads, courses, papers, users } = schema;

export const adminUploadRoutes = new Hono<AppEnv>();

const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const ACCEPTED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

const BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain",
};

/** Browsers sometimes send DOCX/TXT with an empty or generic type; fall back to the extension. */
function mimeOf(f: File) {
  const t = f.type.split(";")[0].trim();
  if (t && t !== "application/octet-stream") return t;
  return BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? t;
}

function checkFiles(files: File[]) {
  if (!files.length) fail(422, "Add at least one file");
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (/heic|heif/i.test(f.type) || /\.hei[cf]$/i.test(f.name)) fail(422, `${f.name}: iPhone HEIC photos aren't supported. Set the camera to "Most Compatible" or export as JPG.`);
    if (!ACCEPTED.has(mimeOf(f))) fail(422, `${f.name}: use PDF, DOCX, TXT, JPG or PNG`);
    if (env.extractor === "local" && mimeOf(f).startsWith("image/")) fail(422, `${f.name}: photos need AI reading. Add ANTHROPIC_API_KEY to .env.local, or upload the typed DOCX/PDF.`);
  }
  if (total > MAX_TOTAL_BYTES) fail(422, "Uploads are limited to 40 MB in total");
}

async function store(uploadId: string, files: File[], prefix: string) {
  return Promise.all(
    files.map(async (f, i) => {
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${uploadId}/${prefix}-${String(i + 1).padStart(2, "0")}-${safe}`;
      await putObject(env.STORAGE_BUCKET_UPLOADS, path, await f.arrayBuffer(), mimeOf(f));
      return { path, mime: mimeOf(f), name: f.name };
    }),
  );
}

const Fields = z.object({
  courseId: z.string().uuid(),
  session: z.string().regex(/^\d{4}\/\d{4}$/, "Use the form 2023/2024"),
  semester: z.coerce.number().int().min(1).max(3).default(1),
  examType: z.enum(["exam", "test", "post_utme"]).default("exam"),
  timeLimitMin: z.coerce.number().int().min(1).max(300),
  optionCount: z.coerce.number().int().min(4).max(5).default(4),
  negativeMark: z.coerce.number().min(0).max(1).default(0),
});

/** POST /admin/uploads — multipart: files[] (in page order), answerKey?, and the tags. */
adminUploadRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody({ all: true });
  const fields = parse(Fields, body);
  await assertCourseAccess(user, fields.courseId);

  const raw = body["files"] ?? body["files[]"];
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  checkFiles(files);
  const key = body["answerKey"] instanceof File ? (body["answerKey"] as File) : null;
  if (key) checkFiles([key]);

  // The same paper twice would put duplicate questions on the boards. Point at the existing one.
  const [dupe] = await db
    .select({ id: uploads.id, status: uploads.status })
    .from(uploads)
    .where(and(eq(uploads.courseId, fields.courseId), eq(uploads.session, fields.session), eq(uploads.semester, fields.semester), eq(uploads.examType, fields.examType), ne(uploads.status, "failed")));
  if (dupe && body["replaceExisting"] !== "1") {
    return c.json({ error: `This paper is already uploaded (${dupe.status === "published" ? "published" : dupe.status === "in_review" ? "waiting for review" : "processing"}). Open it, or delete it first to upload again.`, existingId: dupe.id }, 409);
  }

  const [upload] = await db
    .insert(uploads)
    .values({ ...fields, files: [], uploadedBy: user.id, progress: { step: 0, total: 6, label: "Uploading" } })
    .returning();

  const stored = await store(upload.id, files, "page");
  const storedKey = key ? (await store(upload.id, [key], "key"))[0] : null;
  await db.update(uploads).set({ files: stored, answerKeyFile: storedKey }).where(eq(uploads.id, upload.id));

  startExtraction(upload.id); // runs in the background; the admin screen polls GET /admin/uploads/:id
  return c.json({ id: upload.id, status: "processing" }, 202);
});

/** GET /admin/uploads?status= — the admin's uploads with pipeline status. */
adminUploadRoutes.get("/", async (c) => {
  const user = c.get("user");
  const scope = await adminCourseIds(user);
  const status = c.req.query("status");
  const rows = await db
    .select({ u: uploads, code: courses.code, by: users.displayName, paperId: papers.id })
    .from(uploads)
    .innerJoin(courses, eq(courses.id, uploads.courseId))
    .innerJoin(users, eq(users.id, uploads.uploadedBy))
    .leftJoin(papers, eq(papers.uploadId, uploads.id))
    .where(scope === "all" ? undefined : inArray(uploads.courseId, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]))
    .orderBy(desc(uploads.createdAt))
    .limit(200);
  const list = rows
    .filter((r) => !status || r.u.status === status)
    .map((r) => ({
      id: r.u.id,
      courseCode: r.code,
      session: r.u.session,
      semester: r.u.semester,
      examType: r.u.examType,
      status: r.u.status,
      progress: r.u.progress,
      error: r.u.error,
      pages: r.u.files.length,
      source: r.u.files[0]?.mime ?? null,
      uploadedBy: r.by,
      createdAt: r.u.createdAt,
      updatedAt: r.u.updatedAt,
      paperId: r.paperId,
    }));
  const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.u.status] = (acc[r.u.status] ?? 0) + 1), acc), {});
  return c.json({ uploads: list, counts });
});

/** POST /admin/uploads/detect — multipart: file. Course code, session, semester and type read from the file name and header. */
adminUploadRoutes.post("/detect", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) fail(400, "Send the file as 'file'");
  if (file.size > 40 * 1024 * 1024) fail(422, "File too large");
  return c.json(await detectPaper(file));
});

/** GET /admin/uploads/config — which storage and reader this server uses, for the upload screens. */
adminUploadRoutes.get("/config", (c) =>
  c.json({
    storage: env.storage,
    extractor: env.extractor,
    accepts: env.extractor === "claude" ? ["pdf", "docx", "jpg", "png", "webp", "txt"] : ["pdf", "docx", "txt"],
  }),
);

/** GET /admin/uploads/:id — status, log, signed page URLs, and the draft paper id once ready. */
adminUploadRoutes.get("/:id", async (c) => {
  const [u] = await db.select().from(uploads).where(eq(uploads.id, c.req.param("id")));
  if (!u) fail(404, "Upload not found");
  await assertCourseAccess(c.get("user"), u.courseId);
  const [paper] = await db.select({ id: papers.id, status: papers.status }).from(papers).where(eq(papers.uploadId, u.id));
  const pages = await Promise.all(u.files.map(async (f) => ({ name: f.name, mime: f.mime, url: await signedUrl(env.STORAGE_BUCKET_UPLOADS, f.path).catch(() => null) })));
  return c.json({ upload: { ...u, files: undefined }, pages, paper: paper ?? null });
});

/** GET /admin/uploads/:id/text/:n — plain text of file n (DOCX/TXT), for the side-by-side review. */
adminUploadRoutes.get("/:id/text/:n", async (c) => {
  const [u] = await db.select().from(uploads).where(eq(uploads.id, c.req.param("id")));
  if (!u) fail(404, "Upload not found");
  await assertCourseAccess(c.get("user"), u.courseId);
  const f = u.files[Number(c.req.param("n"))];
  if (!f) fail(404, "No such file");
  const bytes = await getObject(env.STORAGE_BUCKET_UPLOADS, f.path);
  if (f.mime === "text/plain") return c.json({ text: bytes.toString("utf8") });
  if (f.mime.includes("wordprocessingml")) {
    return c.json({ text: await docxText(bytes, { marks: false }) });
  }
  fail(422, "Only DOCX and TXT files have a text view");
});

/** POST /admin/uploads/:id/pages — replace some pages (multipart: files[], replace=3,4) and re-run. */
adminUploadRoutes.post("/:id/pages", async (c) => {
  const [u] = await db.select().from(uploads).where(eq(uploads.id, c.req.param("id")));
  if (!u) fail(404, "Upload not found");
  await assertCourseAccess(c.get("user"), u.courseId);
  const body = await c.req.parseBody({ all: true });
  const raw = body["files"] ?? body["files[]"];
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  checkFiles(files);
  const replace = String(body["replace"] ?? "").split(",").map((n) => Number(n.trim()) - 1).filter((n) => n >= 0);
  const stored = await store(u.id, files, `re${Date.now()}`);
  const next = [...u.files];
  stored.forEach((s, i) => (replace[i] != null && replace[i] < next.length ? (next[replace[i]] = s) : next.push(s)));
  await db.update(uploads).set({ files: next, status: "processing", error: null }).where(eq(uploads.id, u.id));
  startExtraction(u.id);
  return c.json({ id: u.id, status: "processing" }, 202);
});

/** POST /admin/uploads/:id/retry — re-run the pipeline on the same files. */
adminUploadRoutes.post("/:id/retry", async (c) => {
  const [u] = await db.select().from(uploads).where(eq(uploads.id, c.req.param("id")));
  if (!u) fail(404, "Upload not found");
  await assertCourseAccess(c.get("user"), u.courseId);
  if (u.status === "published") fail(409, "This paper is already published");
  startExtraction(u.id);
  return c.json({ id: u.id, status: "processing" }, 202);
});

/** DELETE /admin/uploads/:id — removes the upload and its unpublished drafts. */
adminUploadRoutes.delete("/:id", async (c) => {
  const [u] = await db.select().from(uploads).where(eq(uploads.id, c.req.param("id")));
  if (!u) fail(404, "Upload not found");
  await assertCourseAccess(c.get("user"), u.courseId);
  if (u.status === "published") fail(409, "Unpublish the paper before deleting its upload");
  await db.delete(schema.questions).where(eq(schema.questions.sourceUploadId, u.id));
  await db.delete(uploads).where(eq(uploads.id, u.id));
  return c.json({ ok: true });
});
