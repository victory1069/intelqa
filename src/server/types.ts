import type { schema } from "./db/client";

export type User = typeof schema.users.$inferSelect;

export type AppEnv = {
  Variables: {
    user: User;
  };
};
