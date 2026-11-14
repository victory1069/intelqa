import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

export function fail(status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 503, message: string): never {
  throw new HTTPException(status, { message });
}

/** Parse a request body or query against a zod schema; 422 with the first issue on failure. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    fail(422, `${issue.path.join(".") || "input"}: ${issue.message}`);
  }
  return r.data;
}
