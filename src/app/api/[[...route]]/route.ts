import { handle } from "hono/vercel";
import { app } from "@/server";

// Runs on the Node runtime (the default) and at request time: every request reads the
// request object, which Cache Components treats as dynamic. No segment config needed.

// Uploads run the extraction pipeline in the background of the request that started it.
export const maxDuration = 300;

const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
