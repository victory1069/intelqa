import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { fail } from "./http";

let client: Anthropic | null = null;

export function claude(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) fail(503, "The AI service is not configured");
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const MODEL = env.ANTHROPIC_MODEL;
