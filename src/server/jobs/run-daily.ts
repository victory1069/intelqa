import { config } from "dotenv";
config({ path: ".env.local" });
config();

// Run a job by hand: `npm run job:daily`, `npm run job:morning` or `npm run job:evening`.
const which = process.argv[2] === "evening" ? "evening" : process.argv[2] === "morning" ? "morning" : "daily";
import("./daily").then(async ({ runDaily, runMorning, runEvening }) => {
  console.log(which === "evening" ? await runEvening() : which === "morning" ? await runMorning() : await runDaily());
  process.exit(0);
});
