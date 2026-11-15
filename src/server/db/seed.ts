/**
 * Starting data: UNILORIN, 100L courses, topics, checked questions and a published paper per course.
 * `npm run db:seed` loads only that: no accounts. It clears the catalogue first, and refuses to run
 * on a database that already has real accounts.
 *
 * `npm run db:seed:demo` (laptop database only) also adds demo accounts and a leaderboard for the
 * API smoke test. Their ids, for DEV_AUTH=1:
 *   student      00000000-0000-4000-8000-000000000001  Aisha Bello
 *   content admin 00000000-0000-4000-8000-000000000002  Kunle Adebayo (GST 111, GST 112)
 *   super admin  00000000-0000-4000-8000-000000000003  Tochukwu B.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

const DEV = {
  student: "00000000-0000-4000-8000-000000000001",
  content: "00000000-0000-4000-8000-000000000002",
  super: "00000000-0000-4000-8000-000000000003",
};

type Q = [text: string, options: string[], key: number, topic: string, explanation: string, trap?: string | null, steps?: string[] | null, difficulty?: "easy" | "medium" | "hard"];

const GST111: Q[] = [
  ["The study of the meaning of words and sentences in a language is called", ["Phonology", "Morphology", "Semantics", "Syntax"], 2, "Lexis & structure",
    "Semantics is the branch of linguistics concerned with meaning. Phonology studies sound patterns, morphology studies how words are built, and syntax studies how words combine into sentences.",
    "Morphology looks close because it deals with words, but it is about their structure, not their meaning.", null, "easy"],
  ["Neither the lecturer nor the students ___ in the hall.", ["is", "are", "was", "has been"], 1, "Concord & agreement",
    "With \"neither… nor\", the verb agrees with the noun closest to it. \"Students\" is plural, so the verb is \"are\".",
    "\"Is\" agrees with \"lecturer\", but that noun is further from the verb.", null, "medium"],
  ["The committee ___ divided over the new hostel rules.", ["is", "are", "be", "has"], 1, "Concord & agreement",
    "\"Divided\" tells us the members disagree with each other, so the committee is thought of as several people, not one unit. A collective noun used this way takes a plural verb.",
    "\"Committee\" looks singular, so \"is\" feels right. That only works when the group acts together.", null, "hard"],
  ["Choose the word opposite in meaning to \"frugal\".", ["extravagant", "thrifty", "careful", "modest"], 0, "Lexis & structure",
    "Frugal means careful not to waste money. Its opposite is extravagant, which means spending much more than is sensible.",
    "\"Thrifty\" is a synonym of frugal, not an antonym.", null, "medium"],
  ["Identify the figure of speech in \"The wind whispered through the trees.\"", ["Simile", "Personification", "Hyperbole", "Metaphor"], 1, "Figures of speech",
    "Whispering is a human action. Giving a human quality to something that isn't human, here the wind, is personification.",
    "There is no \"like\" or \"as\", so it isn't a simile.", null, "easy"],
  ["The plural of \"criterion\" is", ["criterions", "criterias", "criteria", "criterion's"], 2, "Lexis & structure",
    "Criterion is borrowed from Greek and keeps its Greek plural, criteria. \"Criterias\" adds a second plural ending to a word that is already plural.",
    "\"Criteria\" is often wrongly used as a singular, which makes \"criterias\" look natural.", null, "medium"],
  ["Which of these is a compound sentence?", ["I came because she called.", "She sang, and the crowd cheered.", "Running late, he took a bike.", "The man who called is here."], 1, "Sentence types",
    "A compound sentence joins two independent clauses with a coordinating conjunction such as and, but or or. \"She sang\" and \"the crowd cheered\" can each stand alone.",
    "\"I came because she called\" has a dependent clause, so it is complex, not compound.", null, "medium"],
  ["Which of the following is NOT a feature of a good summary?", ["Brevity", "Use of the writer's own words", "Inclusion of examples and illustrations", "Logical order of ideas"], 2, "Summary writing",
    "A summary keeps only the main points. Examples and illustrations are supporting detail, so they are the first thing to cut.", null, null, "easy"],
  ["\"To bury the hatchet\" means to", ["hide a weapon", "make peace", "dig a grave", "start a fight"], 1, "Idioms",
    "This idiom means to end a quarrel and become friendly again. Idioms are read as a whole, not word by word.", "\"Hide a weapon\" is the literal reading.", null, "easy"],
  ["Choose the correctly spelt word.", ["accomodate", "acommodate", "accommodate", "acomodate"], 2, "Spelling",
    "Accommodate has a double c and a double m. A common way to remember it: it is big enough to accommodate two c's and two m's.", null, null, "easy"],
  ["Pick the word that is closest in meaning to \"candid\".", ["Frank", "Careful", "Sweet", "Hidden"], 0, "Lexis & structure",
    "Candid means honest and direct, which is what frank means.", "\"Hidden\" is close to the opposite.", null, "easy"],
  ["The plural of \"datum\" is", ["datums", "data", "dati", "datae"], 1, "Lexis & structure",
    "Datum is a Latin neuter noun; its plural is data. Words like this keep their Latin plural in formal English.", null, null, "easy"],
  ["A word that means the same as another word is a", ["synonym", "antonym", "homonym", "acronym"], 0, "Lexis & structure",
    "A synonym has the same or nearly the same meaning as another word. An antonym has the opposite meaning, and a homonym sounds or looks the same but means something different.", null, null, "easy"],
  ["Each of the students ___ a laptop.", ["have", "has", "are having", "were having"], 1, "Concord & agreement",
    "The subject is \"each\", which is singular, so the verb is singular: has. \"Of the students\" is a prepositional phrase and does not change the subject.",
    "\"Students\" sits right before the verb, which pulls people towards \"have\".", null, "medium"],
  ["Which of these is a complex sentence?", ["Although it rained, we played.", "We played and won.", "Stop!", "She and I came."], 0, "Sentence types",
    "A complex sentence has one independent clause and at least one dependent clause. \"Although it rained\" can't stand alone, while \"we played\" can.", null, null, "medium"],
  ["\"He is as busy as a bee\" is an example of", ["metaphor", "simile", "irony", "oxymoron"], 1, "Figures of speech",
    "A simile compares two things using \"like\" or \"as\". Here a busy person is compared to a bee with \"as… as\".", "A metaphor makes the comparison without \"like\" or \"as\".", null, "easy"],
  ["Choose the option nearest in meaning to \"ubiquitous\".", ["hidden", "rare", "everywhere", "ancient"], 2, "Lexis & structure",
    "Ubiquitous means found everywhere, present in many places at once.", "\"Rare\" is its opposite.", null, "medium"],
  ["One of the boys ___ absent today.", ["are", "were", "is", "have been"], 2, "Concord & agreement",
    "The subject is \"one\", which is singular, so the verb is \"is\". \"Of the boys\" only describes which one.", "\"Boys\" is closest to the verb, so a plural verb feels natural.", null, "medium"],
  ["In the SQ3R reading method, the letters stand for Survey, Question, Read, Recite and", ["Rewrite", "Review", "Repeat", "Record"], 1, "Library & study skills",
    "SQ3R is Survey, Question, Read, Recite, Review. The final step is going back over the material to fix it in memory.", null, null, "easy"],
  ["The main idea of a paragraph is usually expressed in its", ["topic sentence", "concluding clause", "footnote", "title page"], 0, "Comprehension",
    "The topic sentence states what the paragraph is about, and the other sentences support it. It is often, but not always, the first sentence.", null, null, "easy"],
];

const MTH101: Q[] = [
  ["If $\\log_2(x - 1) = 3$, find $x$.", ["7", "8", "9", "10"], 2, "Logarithms", "Rewrite the logarithm as a power of 2, then solve for x.",
    "8 is $2^3$, which is the value of $x - 1$, not $x$. Always finish the last step.", ["Rewrite the log as a power: $x - 1 = 2^3$", "$2^3 = 8$, so $x - 1 = 8$", "Add 1 to both sides: $x = 9$"], "medium"],
  ["Find the sum of the first 20 terms of $3, 7, 11, \\dots$", ["820", "800", "860", "780"], 0, "Sequences & series", "It is an arithmetic progression with $a = 3$ and $d = 4$, so use $S_n = \\frac{n}{2}(2a + (n-1)d)$.", null,
    ["$a = 3$, $d = 4$, $n = 20$", "$S_{20} = 10(6 + 19 \\times 4) = 10 \\times 82$", "$S_{20} = 820$"], "medium"],
  ["Solve $2x + 5 = 17$.", ["5", "6", "7", "11"], 1, "Algebra", "Subtract 5 from both sides to get $2x = 12$, then divide by 2 to get $x = 6$.", "11 comes from dividing 22 instead of 12 by 2: it adds 5 instead of subtracting.", null, "easy"],
  ["If $A = \\{1, 2, 3\\}$ and $B = \\{2, 3, 4\\}$, find $A \\cap B$.", ["{1, 4}", "{2, 3}", "{1, 2, 3, 4}", "{ }"], 1, "Sets", "The intersection holds the elements that are in both sets. Only 2 and 3 are in both.", "{1, 2, 3, 4} is the union, not the intersection.", null, "easy"],
  ["How many subsets does a set with 4 elements have?", ["4", "8", "16", "24"], 2, "Sets", "A set with $n$ elements has $2^n$ subsets, including the empty set and the set itself. $2^4 = 16$.", null, null, "easy"],
  ["Find the roots of $x^2 - 5x + 6 = 0$.", ["2 and 3", "−2 and −3", "1 and 6", "−1 and 6"], 0, "Quadratic equations", "Factorise: two numbers that multiply to 6 and add to −5 are −2 and −3, so $(x - 2)(x - 3) = 0$ and $x = 2$ or $x = 3$.",
    "−2 and −3 are the numbers in the factors, not the roots.", ["$x^2 - 5x + 6 = (x - 2)(x - 3)$", "$x - 2 = 0$ or $x - 3 = 0$", "$x = 2$ or $x = 3$"], "easy"],
  ["Find the 5th term of the G.P. $2, 6, 18, \\dots$", ["54", "162", "486", "108"], 1, "Sequences & series", "In a geometric progression $T_n = ar^{n-1}$. Here $a = 2$ and $r = 3$, so $T_5 = 2 \\times 3^4 = 162$.", "54 is the 4th term.", null, "medium"],
  ["Simplify $8^{2/3}$.", ["4", "16", "2", "6"], 0, "Indices", "Take the cube root first, then square: $\\sqrt[3]{8} = 2$ and $2^2 = 4$.", null, null, "easy"],
  ["Evaluate $\\log_{10} 1000$.", ["2", "3", "30", "100"], 1, "Logarithms", "$\\log_{10} 1000$ asks what power of 10 gives 1000. Since $10^3 = 1000$, the answer is 3.", null, null, "easy"],
  ["What is the sum of the interior angles of a hexagon?", ["540°", "720°", "900°", "360°"], 1, "Geometry", "The interior angles of an $n$-sided polygon add up to $(n - 2) \\times 180°$. For a hexagon, $4 \\times 180° = 720°$.", "540° is the pentagon.", null, "easy"],
  ["If $f(x) = 3x^2 - 2$, find $f(-2)$.", ["10", "−14", "14", "−10"], 0, "Functions", "Substitute $x = -2$: $3(-2)^2 - 2 = 3 \\times 4 - 2 = 10$.", "−14 comes from squaring after multiplying by 3 with the wrong sign.", null, "easy"],
  ["In how many ways can the letters of the word MATH be arranged?", ["12", "16", "24", "4"], 2, "Permutations", "There are 4 different letters, so the number of arrangements is $4! = 24$.", null, null, "easy"],
];

const PHY101: Q[] = [
  ["A body of mass 2 kg moves with a speed of 4 m/s. What is its kinetic energy?", ["8 J", "16 J", "32 J", "4 J", "64 J"], 1, "Work, energy & power",
    "Kinetic energy is $\\frac{1}{2}mv^2$.", "32 J forgets the ½.", ["$KE = \\frac{1}{2} \\times 2 \\times 4^2$", "$= 1 \\times 16 = 16\\,\\text{J}$"], "easy"],
  ["A block slides from rest down a frictionless incline at $\\theta = 30°$. Find its acceleration. Take $g = 10\\,\\text{m s}^{-2}$.", ["5.0 m s⁻²", "8.7 m s⁻²", "10 m s⁻²", "2.5 m s⁻²", "0 m s⁻²"], 0, "Motion",
    "On a frictionless incline only the component of gravity along the slope accelerates the block: $a = g\\sin\\theta$.", "8.7 uses $\\cos\\theta$, which is the component into the slope.", ["$a = g \\sin 30°$", "$a = 10 \\times 0.5 = 5.0\\,\\text{m s}^{-2}$"], "medium"],
  ["The SI unit of force is the", ["joule", "newton", "watt", "pascal", "coulomb"], 1, "Units & measurement", "Force is measured in newtons. One newton gives a 1 kg mass an acceleration of 1 m/s².", null, null, "easy"],
  ["A car accelerates uniformly from rest to 20 m/s in 5 s. What is its acceleration?", ["2 m/s²", "4 m/s²", "5 m/s²", "10 m/s²", "100 m/s²"], 1, "Motion",
    "Acceleration is the change in velocity divided by time: $a = \\frac{20 - 0}{5} = 4\\,\\text{m/s}^2$.", "100 multiplies instead of dividing.", null, "easy"],
  ["Which of these is a scalar quantity?", ["Velocity", "Force", "Mass", "Momentum", "Acceleration"], 2, "Units & measurement", "A scalar has size only. Mass has no direction, while velocity, force, momentum and acceleration all do.", null, null, "easy"],
  ["What is the weight of a 5 kg mass? Take $g = 10\\,\\text{m s}^{-2}$.", ["0.5 N", "5 N", "15 N", "50 N", "500 N"], 3, "Forces", "Weight is $W = mg = 5 \\times 10 = 50\\,\\text{N}$.", "5 N confuses mass with weight.", null, "easy"],
  ["A machine does 600 J of work in 30 s. What is its power?", ["20 W", "18000 W", "570 W", "630 W", "2 W"], 0, "Work, energy & power", "Power is work done per unit time: $P = \\frac{600}{30} = 20\\,\\text{W}$.", null, null, "easy"],
  ["What is the momentum of a 3 kg body moving at 5 m/s?", ["15 kg m/s", "8 kg m/s", "1.67 kg m/s", "45 kg m/s", "0.6 kg m/s"], 0, "Forces", "Momentum is mass times velocity: $p = 3 \\times 5 = 15\\,\\text{kg m/s}$.", null, null, "easy"],
  ["A wave has a frequency of 50 Hz. What is its period?", ["0.02 s", "50 s", "0.2 s", "2 s", "0.5 s"], 0, "Waves", "Period is the inverse of frequency: $T = \\frac{1}{f} = \\frac{1}{50} = 0.02\\,\\text{s}$.", null, null, "easy"],
  ["An object of mass 2 kg has a volume of 0.001 m³. What is its density?", ["2000 kg/m³", "200 kg/m³", "0.002 kg/m³", "20 kg/m³", "2 kg/m³"], 0, "Units & measurement", "Density is mass divided by volume: $\\rho = \\frac{2}{0.001} = 2000\\,\\text{kg/m}^3$.", "0.002 multiplies instead of dividing.", null, "medium"],
];

const STUDENTS = [
  "Fatimah Yusuf", "Mariam Abdulkadir", "Daniel Okonkwo", "Ibrahim Lawal", "Blessing Udo", "Oluwaseun Afolabi", "Zainab Olanrewaju", "Tunde Ajayi",
  "Samuel Oyelade", "Halimah Bakare", "Victor Adebisi", "Rukayat Ibrahim", "Esther Ogunleye", "Abdulrahman Salihu", "Precious Eze", "Ifeoluwa Adeyemi",
  "Kehinde Akanbi", "Chiamaka Nwosu", "Ayomide Fashola", "Yusuf Garba", "Emeka Obi", "Sadiq Bello", "Ngozi Eze", "Aliyu Musa",
];

const DEMO = process.argv.includes("--demo");

async function main() {
  const { db, schema: s } = await import("./client");
  const { sql } = await import("drizzle-orm");
  const { env } = await import("../env");

  // Clearing wipes accounts too, so never on a database where real people have signed up.
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from users`);
  if (Number(n) > 0 && !process.argv.includes("--wipe")) {
    console.error(`This database has ${n} account(s). Seeding clears everything, including them. Re-run with --wipe if you really mean it.`);
    process.exit(1);
  }
  if (DEMO && !env.DATABASE_LOCAL) {
    console.error("Demo accounts are for the laptop database only (DATABASE_LOCAL=1).");
    process.exit(1);
  }

  console.log("Clearing…");
  await db.execute(sql`truncate institutions, users, admin_invites, institution_requests restart identity cascade`);

  console.log("Catalogue…");
  const [uil] = await db.insert(s.institutions).values({ name: "University of Ilorin", shortCode: "UNILORIN", status: "live" }).returning();
  await db.insert(s.institutions).values([
    { name: "Kwara State University", shortCode: "KWASU", status: "draft" },
    { name: "University of Ibadan", shortCode: "UI", status: "draft" },
  ]);

  const facultyNames: Record<string, string[]> = {
    Agriculture: ["Agricultural Economics", "Animal Production"],
    Arts: ["English", "History & International Studies"],
    "Communication & Information Sciences": ["Computer Science", "Information & Comm. Science", "Library & Information Science", "Mass Communication", "Telecommunication Science"],
    Education: ["Educational Management"],
    "Engineering & Technology": ["Mechanical Engineering", "Electrical Engineering"],
    "Physical Sciences": ["Physics", "Industrial Chemistry", "Mathematics"],
  };
  const deptIds: Record<string, string> = {};
  for (const [fac, depts] of Object.entries(facultyNames)) {
    const [f] = await db.insert(s.faculties).values({ institutionId: uil.id, name: fac }).returning();
    for (const d of depts) {
      const [row] = await db.insert(s.departments).values({ facultyId: f.id, name: d }).returning();
      deptIds[d] = row.id;
    }
  }
  const cs = deptIds["Computer Science"];

  const courseDefs = [
    { code: "GST 111", title: "Communication in English", optionCount: 4, negativeMark: 0, status: "live" as const },
    { code: "GST 112", title: "Nigerian Peoples & Culture", optionCount: 4, negativeMark: 0, status: "draft" as const },
    { code: "MTH 101", title: "Elementary Mathematics I", optionCount: 4, negativeMark: 0, status: "live" as const },
    { code: "PHY 101", title: "General Physics I", optionCount: 5, negativeMark: 0.25, status: "live" as const },
    { code: "CHM 101", title: "General Chemistry I", optionCount: 4, negativeMark: 0, status: "draft" as const },
    { code: "CSC 111", title: "Introduction to Computing", optionCount: 4, negativeMark: 0, status: "draft" as const },
    { code: "BIO 101", title: "General Biology I", optionCount: 4, negativeMark: 0, status: "draft" as const },
  ];
  const courseIds: Record<string, string> = {};
  for (const c of courseDefs) {
    const [row] = await db.insert(s.courses).values({ ...c, institutionId: uil.id, level: 100, semester: 1 }).returning();
    courseIds[c.code] = row.id;
    if (c.code !== "GST 112" && c.code !== "BIO 101") await db.insert(s.courseDepartments).values({ courseId: row.id, departmentId: cs });
  }

  if (DEMO) {
    console.log("Demo accounts…");
    await db.insert(s.users).values([
      { id: DEV.student, phone: "2348034127781", firstName: "Aisha", surname: "Bello", displayName: "Aisha Bello", institutionId: uil.id, departmentId: cs, level: 100, onboarded: true, inviteCode: "aisha01" },
      { id: DEV.content, email: "kunle.adebayo@intelqa.app", firstName: "Kunle", surname: "Adebayo", displayName: "Kunle Adebayo", role: "content_admin", institutionId: uil.id, onboarded: true, inviteCode: "kunle01" },
      { id: DEV.super, email: "tochukwu@intelqa.app", firstName: "Tochukwu", surname: "B.", displayName: "Tochukwu B.", role: "super_admin", institutionId: uil.id, onboarded: true, inviteCode: "toch001" },
    ]);
    await db.insert(s.adminCourses).values([{ userId: DEV.content, courseId: courseIds["GST 111"] }, { userId: DEV.content, courseId: courseIds["GST 112"] }]);
    await db.insert(s.userCourses).values(["GST 111", "MTH 101", "PHY 101", "CHM 101", "CSC 111"].map((code) => ({ userId: DEV.student, courseId: courseIds[code] })));
  }

  console.log("Questions & papers…");
  async function seedCourse(code: string, qs: Q[], session: string, timeLimitMin: number) {
    const courseId = courseIds[code];
    const [course] = await db.select().from(s.courses).where(sql`${s.courses.id} = ${courseId}`);
    const topicIds = new Map<string, string>();
    for (const t of [...new Set(qs.map((q) => q[3]))]) {
      const [row] = await db.insert(s.topics).values({ courseId, name: t, position: topicIds.size }).returning();
      topicIds.set(t, row.id);
    }
    const [paper] = await db.insert(s.papers).values({
      courseId, session, semester: 1, examType: "exam", timeLimitMin, optionCount: course.optionCount, negativeMark: course.negativeMark,
      status: "published", publishedAt: new Date(), publishedBy: DEMO ? DEV.super : null,
    }).returning();
    let pos = 0;
    for (const [text, options, key, topic, explanation, trap, steps, difficulty] of qs) {
      const [q] = await db.insert(s.questions).values({
        courseId, topicId: topicIds.get(topic)!, text, options, correctOption: key, answerVerified: true, explanation, trap: trap ?? null,
        workedSteps: steps ?? null, difficulty: difficulty ?? "medium", status: "approved", confidence: 0.97, sourceNumber: pos + 1,
      }).returning();
      await db.insert(s.paperQuestions).values({ paperId: paper.id, questionId: q.id, position: pos++ });
    }
  }
  await seedCourse("GST 111", GST111, "2023/2024", 25);
  await seedCourse("MTH 101", MTH101, "2022/2023", 20);
  await seedCourse("PHY 101", PHY101, "2023/2024", 15);
  await db.insert(s.topics).values(["Atomic structure", "Mole concept", "Chemical bonding"].map((name, i) => ({ courseId: courseIds["CHM 101"], name, position: i })));

  if (DEMO) {
    console.log("Leaderboard…");
    const gst = courseIds["GST 111"];
    const now = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < STUDENTS.length; i++) {
      const [first, ...rest] = STUDENTS[i].split(" ");
      const id = `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      ids.push(id);
      await db.insert(s.users).values({
        id, firstName: first, surname: rest.join(" "), displayName: STUDENTS[i], institutionId: uil.id,
        departmentId: i % 3 === 0 ? deptIds["Mass Communication"] : cs, level: 100, onboarded: true, inviteCode: `s${String(i).padStart(5, "0")}`,
      });
      await db.insert(s.userCourses).values({ userId: id, courseId: gst });
      await db.insert(s.userCourseStats).values({ userId: id, courseId: gst, courseScore: Math.round((95 - i * 1.2) * 10) / 10, rankedAttempts: 3 + (i % 5) });
      const xp = Math.max(120, 4000 - i * 140);
      await db.insert(s.xpEvents).values([
        { userId: id, amount: Math.round(xp * 0.6), reason: "drill", createdAt: new Date(now - (i + 1) * 3_600_000) },
        { userId: id, amount: Math.round(xp * 0.4), reason: "exam", createdAt: new Date(now - (i + 2) * 5_400_000) },
      ]);
      await db.insert(s.userStreaks).values({ userId: id, current: (i % 9) + 1, best: (i % 9) + 4, lastActiveDate: new Date(now + 3_600_000).toISOString().slice(0, 10), totalXp: xp * 3, questionsAnswered: 300 + i * 20, questionsCorrect: 200 + i * 10 });
    }

    // Aisha: mid-table on GST 111, a 6-day streak, a couple of friends.
    await db.insert(s.userCourseStats).values({ userId: DEV.student, courseId: gst, courseScore: 74, rankedAttempts: 4 });
    await db.insert(s.xpEvents).values({ userId: DEV.student, amount: 1240, reason: "week", createdAt: new Date(now - 7_200_000) });
    const yesterday = new Date(now + 3_600_000 - 864e5).toISOString().slice(0, 10);
    await db.insert(s.userStreaks).values({ userId: DEV.student, current: 6, best: 11, lastActiveDate: yesterday, freezes: 0, totalXp: 2340, questionsAnswered: 812, questionsCorrect: 577 });
    await db.insert(s.badgesEarned).values(["clean_sheet", "week_one", "first_blood", "early_bird"].map((badgeKey) => ({ userId: DEV.student, badgeKey })));
    for (const f of [ids[7], ids[9], ids[8], ids[10]]) {
      await db.insert(s.friendships).values([{ userId: DEV.student, friendId: f }, { userId: f, friendId: DEV.student }]);
    }
  }

  console.log("Daily challenges…");
  const { pickDailyChallenge } = await import("../services/sessions");
  const { lagosDate } = await import("../lib/time");
  for (const code of ["GST 111", "MTH 101", "PHY 101"]) await pickDailyChallenge(courseIds[code], lagosDate());

  console.log(DEMO ? `Done. Demo account ids: ${JSON.stringify(DEV)}` : "Done. No accounts were created: sign up in the app.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
