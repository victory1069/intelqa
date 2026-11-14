import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { env } from "../env";
import { localPath, verifyLocalToken } from "../lib/storage";
import type { AppEnv } from "../types";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** GET /api/files/:bucket/* — serves files when STORAGE_DRIVER resolves to "local". */
export const fileRoutes = new Hono<AppEnv>();

fileRoutes.get("/:bucket/*", async (c) => {
  if (env.storage !== "local") return c.json({ error: "Not found" }, 404);
  const bucket = c.req.param("bucket");
  const key = decodeURIComponent(c.req.path.split(`/files/${bucket}/`)[1] ?? "");
  if (!key) return c.json({ error: "Not found" }, 404);
  const isPublic = bucket === env.STORAGE_BUCKET_IMAGES;
  if (!isPublic && !verifyLocalToken(bucket, key, c.req.query("t"))) return c.json({ error: "This link has expired. Reload the page." }, 403);
  let bytes: Buffer;
  try {
    bytes = await readFile(localPath(bucket, key));
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
  return c.body(new Uint8Array(bytes), 200, {
    "content-type": TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream",
    "cache-control": isPublic ? "public, max-age=31536000, immutable" : "private, max-age=3600",
  });
});
