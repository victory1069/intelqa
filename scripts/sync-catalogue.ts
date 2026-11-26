/**
 * Brings a school's faculties and departments in line with content/catalogue/<school>.json.
 * Only adds and renames: nothing is deleted, so students keep their department.
 *
 *   npx tsx scripts/sync-catalogue.ts content/catalogue/unilorin.json            dry run
 *   npx tsx scripts/sync-catalogue.ts content/catalogue/unilorin.json --write    saves
 *
 * "renames" turns an old department name into a new one in place (same id, so students keep it).
 * "courseDepartments" pre-ticks those courses for that department during onboarding.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { z } from "zod";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const File = z.object({
  institution: z.string(),
  renames: z.record(z.string(), z.string()).default({}),
  faculties: z.record(z.string(), z.array(z.string().min(2)).min(1)),
  courseDepartments: z.record(z.string(), z.array(z.string())).default({}),
});

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Give the file, e.g. content/catalogue/unilorin.json");
  const write = process.argv.includes("--write");
  const d = File.parse(JSON.parse(readFileSync(file, "utf8")));
  const all = Object.values(d.faculties).flat();
  if (new Set(all).size !== all.length) throw new Error("A department is listed twice");

  const { db, schema: s } = await import("../src/server/db/client");
  const { and, eq, inArray } = await import("drizzle-orm");
  const [inst] = await db.select().from(s.institutions).where(eq(s.institutions.shortCode, d.institution));
  if (!inst) throw new Error(`${d.institution} isn't in the catalogue`);

  await db.transaction(async (tx) => {
    const facs = await tx.select().from(s.faculties).where(eq(s.faculties.institutionId, inst.id));
    const depts = facs.length ? await tx.select().from(s.departments).where(inArray(s.departments.facultyId, facs.map((f) => f.id))) : [];
    const log: string[] = [];

    for (const [from, to] of Object.entries(d.renames)) {
      const row = depts.find((x) => x.name === from);
      if (!row || depts.some((x) => x.name === to)) continue;
      log.push(`rename "${from}" → "${to}"`);
      row.name = to;
      if (write) await tx.update(s.departments).set({ name: to }).where(eq(s.departments.id, row.id));
    }

    for (const [facName, names] of Object.entries(d.faculties)) {
      let fac = facs.find((f) => f.name === facName);
      if (!fac) {
        log.push(`faculty "${facName}"`);
        fac = write ? (await tx.insert(s.faculties).values({ institutionId: inst.id, name: facName }).returning())[0] : { id: `new:${facName}`, institutionId: inst.id, name: facName };
        facs.push(fac);
      }
      for (const name of names) {
        // A department already filed under another faculty is left where it is.
        if (depts.some((x) => x.name === name)) continue;
        log.push(`  ${facName} › ${name}`);
        const row = write ? (await tx.insert(s.departments).values({ facultyId: fac.id, name }).returning())[0] : { id: `new:${name}`, facultyId: fac.id, name };
        depts.push(row);
      }
    }

    for (const [deptName, codes] of Object.entries(d.courseDepartments)) {
      const dept = depts.find((x) => x.name === deptName);
      if (!dept) throw new Error(`No department called ${deptName}`);
      const cs = await tx.select().from(s.courses).where(and(eq(s.courses.institutionId, inst.id), inArray(s.courses.code, codes)));
      const missing = codes.filter((c) => !cs.some((x) => x.code === c));
      if (missing.length) throw new Error(`Courses not in the catalogue: ${missing.join(", ")}`);
      log.push(`  ${deptName} takes ${codes.join(", ")}`);
      if (write) await tx.insert(s.courseDepartments).values(cs.map((c) => ({ courseId: c.id, departmentId: dept.id }))).onConflictDoNothing();
    }

    const extra = depts.filter((x) => !all.includes(x.name));
    console.log(log.length ? log.join("\n") : "Nothing to change.");
    if (extra.length) console.log(`\nIn the database but not in the file (kept): ${extra.map((x) => x.name).join(", ")}`);
    console.log(write ? "\nSaved." : "\nDry run. Add --write to save.");
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
