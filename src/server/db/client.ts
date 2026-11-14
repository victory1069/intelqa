import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

// Reuse one pool across hot reloads in dev.
const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };

const sql =
  g.__pg ??
  postgres(
    env.DATABASE_URL,
    env.DATABASE_LOCAL
      ? // Local PGlite server (`npm run db:local`): one connection, and skip the connect-time
        // type discovery it can't handle (it breaks binding enum parameters).
        { max: 1, fetch_types: false, onnotice: () => {} }
      : // Supabase's transaction pooler (port 6543) doesn't support prepared statements.
        { max: env.DATABASE_POOL_MAX, prepare: false, onnotice: () => {} },
  );

if (env.NODE_ENV !== "production") g.__pg = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export { schema };
