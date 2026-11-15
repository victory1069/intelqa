# IntelQA CBT

A phone-first PWA where 100-level students sit past questions under real CBT conditions, compete on leaderboards, and get every missed question explained. Admins turn a scanned or typed past paper into a checked question bank.

One Next.js 16 app serves both the student PWA and the admin dashboard. The API is a Hono app mounted at `/api`, using the layout from the product spec ("Light backend structure"): one Postgres database, Supabase for OTP sign-in and file storage, and Claude for document extraction and the "Ask" follow-up.

## Layout

```
src/
  server/                 the API (Hono), mounted by src/app/api/[[...route]]/route.ts
    index.ts              mounts every route, error handling, auth boundaries
    env.ts                validated env vars
    db/                   schema.ts (Drizzle), client.ts, migrations/, seed.ts
    middleware/           auth.ts (Supabase JWT or dev header), admin.ts (roles, course scope)
    routes/               catalog, papers, attempts, leaderboard, me, questions, challenges
      admin/              uploads, papers (review/publish), questions (bank, reports, CSV), insights, super
    services/             scoring, leaderboard, sessions, extraction, ask, regrade
    jobs/daily.ts         streaks + freezes, daily challenges, expired sessions, stuck uploads
  shared/game.ts          XP, levels, badges, streak and fair-play rules (used by API and app)
  app/                    pages: student screens, /admin/*, manifest, icon
  components/             UI kit (from the design files), exam runner, admin editor/crop
  lib/                    API client, auth, offline store (Dexie), sync, hooks
public/sw.js              service worker (app shell, offline pages, figure cache)
scripts/                  smoke.mjs (API end-to-end test), make-icons.mjs
```

Routes stay thin: validate input, call a service, return JSON. Scoring, ranks, extraction and regrading live in `services/`.

## Run it locally

```bash
npm install
cp .env.example .env.local     # already set up for local use
npm run db:local               # Postgres (PGlite) on :5433; leave it running
npm run db:migrate             # in a second terminal
npm run db:seed                # UNILORIN, 7 courses, 42 checked questions. No accounts.
npm run dev                    # http://localhost:3000
```

Signing in needs the Supabase keys in `.env.local` (see **Sign-in** below), even with the laptop database. There are no demo accounts: create your own by signing up.

`node scripts/smoke.mjs` walks the API end to end against the running server (start exam, save, submit, result, review, boards, modes, reports, challenges, admin scoping, key regrade, a paper upload). It uses test accounts, so it only runs on the laptop database: `npm run db:seed:demo` (refused on any other database), `DEV_AUTH=1` in `.env.local`, then the script. The test accounts can only be used through the API, never the sign-in screen. Re-seed before re-running it; the daily challenge is one per day.

### Sign-in

Email first, then:

- **New account**: a 6-digit code is emailed (the same email has a link that works too). After the code, the app asks for a password, then opens setup.
- **Returning account**: email and password. "Forgot password?" emails a code, then asks for a new password.
- Any signed-in account without a password is held on "Create a password" until it sets one (`PasswordGate` in `src/components/auth-form.tsx`). `users.password_set` records it; `POST /api/auth/lookup` picks the password or code step.
- Phone works the same way once an SMS provider is connected in Supabase.

Supabase setup (Dashboard → Authentication):

1. **Email templates**: the default "Magic Link" and "Confirm signup" templates only contain a link. Add the code to both, e.g. `<p>Your IntelQA code: <strong>{{ .Token }}</strong></p>`.
2. **URL configuration**: Site URL is your app's address. Add `http://localhost:3000/**` (and your live address) under Redirect URLs, so the link in the email opens the app.
3. **Emails**: the built-in sender allows only a few emails an hour. Set up custom SMTP before launch.

### Testing admin uploads on your laptop

Everything works without Supabase or an API key:

- **Files** are saved in `.local-storage/` and served by `/api/files` (scans need a signed link; question figures are public). Delete the folder to clear them.
- **Reading papers**: without `ANTHROPIC_API_KEY` the built-in parser (`src/server/services/parse-paper.ts`) reads *typed* papers (DOCX, TXT, PDFs with selectable text). It can't read photos or scanned PDFs, and it doesn't draft explanations or topics, so questions without an explanation are flagged for you to write one. It handles:
  - **Options** marked `A.` / `(a)` / `a)` / `[A]`, roman numerals `i.` / `(ii)`, numbers `1.` `2.` under a question, bullets `•` / `-` / `–`, or no marker at all (one per line, flagged for a check). One per line or several on a line, including on the question's own line. Statements `i. ii. iii.` inside a question stay in the question when the options are lettered.
  - **Answers** under the question (`Answer: B`, `Ans - (c)`, `Correct answer is Abuja`, `… Ans: B` at the end of a line), marked on an option (`*B.`, `B. … *`, `(correct)`, ✓, or the one bold or underlined option in a DOCX), or in an answer key anywhere in the document, usually the last page: under a heading such as `ANSWERS` / `Answer key` / `Marking scheme`, or as bare lines like `1. C  2. D`. Keys can be `1. C`, `2-B`, `1C 2B 3A`, `1–5: ABCDA`, a table (a row of numbers, then a row of letters), a roman numeral, an option number or the option's text (`7. but`). If the question's mark and the key disagree, the question is flagged.
  - **Word numbering**: DOCX files keep their automatic list numbers (`src/server/services/docx-text.ts`), so papers typed with Word's numbered lists read correctly.
  - `npx tsx scripts/parser-cases.ts` runs the parser over 19 different layouts.
- **With a key**: add `ANTHROPIC_API_KEY` to `.env.local` and restart `npm run dev`. Uploads then go through Claude (photos, scans, explanations, topics), with the same rules: any option markers, answers marked on the question, and an answer key anywhere in the document. That uses API credit.

Try it:

1. Sign in at http://localhost:3000/admin/sign-in with an admin account (a super admin invites admins from Admin › Admins).
2. Uploads › New upload. Use a file from `samples/`. The course, session, semester and exam type are filled in from the file name and the paper's header (e.g. "GST 111 … 2019/2020 First Semester Examination"); check them, and pick any it couldn't find:
   - `GST111-2021-2022-typed.docx` → course GST 111, session 2021/2022. Fifteen questions in three layouts, with answers and explanations; four are flagged as repeats of the seeded paper. Approve them, then Publish.
   - `GST112-2022-2023-typed.pdf` with `GST112-2022-2023-answer-key.txt` as the answer key → GST 112, 2022/2023. Ten questions across two PDF pages; keys come from the separate file; each needs an explanation written before approval.
   - `GST111-2019-2020-mixed-formats.pdf` → GST 111, 2019/2020. Twelve questions whose options use letters, roman numerals, numbers, bullets, dashes and no markers; the answers are on the last page as letters, roman numerals, option numbers and words. Every key should come out filled in.
   - `GST111-2020-2021-with-problems.txt` → GST 111, 2020/2021. Deliberate problems: a question with three options and no key, a numbering gap, a question with no key, and one that mentions a diagram.
3. The upload page shows progress, then **Open review**: the original on the left (typed files show as text with the selected question highlighted), the editable question on the right.
4. After publishing, sign in as a student taking GST 111 at http://localhost:3000/sign-in: the paper is on the course page, and their notifications include "New paper".

The same paper (course, session, semester, type) can't be uploaded twice; delete the old upload first.

## Production setup

1. **Supabase project**
   - Auth: enable Phone (needs an SMS provider; Supabase supports Twilio, MessageBird, Vonage and Textlocal; Termii would need a custom SMS hook) and Email OTP.
   - Storage: create a private bucket `uploads` and a public bucket `question-images`.
   - Database: use the transaction pooler URL (port 6543) as `DATABASE_URL`, remove `DATABASE_LOCAL`, then `npm run db:migrate`.
2. **Env vars**: see `.env.example`. Set `ANTHROPIC_API_KEY`, `CRON_SECRET`, and keep `DEV_AUTH` off. Make sure `SUPABASE_SERVICE_ROLE_KEY` is set: without it uploads fall back to local disk, which Vercel throws away (the server logs a warning).
3. **Scheduled jobs** (all need `Authorization: Bearer $CRON_SECRET`; `vercel.json` schedules all three on Vercel, which sends the secret itself; elsewhere use Supabase pg_cron or a GitHub Action. Each job also answers GET). Lagos is UTC+1 all year, so 8 am Lagos is `0 7 * * *` in UTC cron:
   - `POST /api/jobs/daily` just after midnight Lagos time: streaks and freezes, daily challenges (the pop quizzes), weekly rank snapshots, expired sessions.
   - `POST /api/jobs/morning` (or GET, for Vercel Cron) at 8 am Lagos time: pushes "Your GST 111 pop quiz is ready" to every student who hasn't played today's yet. It also creates today's quizzes if the midnight job missed, and it's safe to run twice: no student is told twice in one day. Students can turn it off in Settings.
   - `POST /api/jobs/evening` at 8 pm Lagos time: streak reminders for students who haven't practised today.
   - Locally: `npm run job:daily` / `npm run job:morning` / `npm run job:evening`.
4. **Push notifications**: generate keys once with `npx web-push generate-vapid-keys` and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address). Without them, notifications still land in the in-app inbox (Me › Notifications); only phone pushes are skipped. Each student gets at most one push a day, except score corrections and the 8 am pop quiz, which sits outside that limit so it never blocks the evening streak reminder. On iPhone, push works only after the app is added to the Home Screen.
5. **First super admin**: sign in once, then in SQL: `update users set role = 'super_admin' where email = '…';`. Invite other admins from Admin › Admins.
6. **Hosting**: Vercel works. Extraction runs in the background of the upload request (`maxDuration = 300`); if long papers time out, move `startExtraction` to a worker, as the spec's "When to add more" says.

## Look and motion

Monument-style: giant condensed uppercase headlines (Big Shoulders), editorial serif statements (Instrument Serif), Instrument Sans for reading, JetBrains Mono for codes and timers. Brand colours laid out as deep ink-violet "night" sections, cream "paper", violet and highlighter yellow.

- **Landings**: `/welcome` (students) and `/admin/sign-in` (admins) are full landing pages with a 5-second loader (`components/motion/loader.tsx`). It plays once per browser session per landing, never for "reduce motion", and a pre-paint script stops it flashing on return visits.
- **Motion kit** (`components/motion/`): `RevealText` (words rise from behind a mask, on mount or in view), `Rise`, `Marquee`, `Spine` (side bar on desktop / top bar on phones that fills as you scroll), `LagosClock`, and `useLandingFx`, which adds Lenis smooth scrolling plus GSAP ScrollTrigger effects via `data-fx` attributes (`slide`, `wipe`, `ink`, `parallax`, `tilt`, `count`, `scale`). GSAP and Lenis only load on the landing pages.
- **App**: `.font-display` headings are uppercase and tight; buttons are caps with an arrow nudge; pages ease in on navigation. Phones get a floating night tab bar; desktop gets a night side bar and a wider column. The admin shell does the same (sidebar on desktop, top bar + slide-out menu on phones). Exam screens keep the calm layout.
- CSS utilities live in `src/app/globals.css` (`.display`, `.statement`, `.caps`, `.grain`, `.rv`, `.rise`, `.page-in`, `.marquee`).

## How the key rules are enforced

- **Answers never reach the phone before submit** in online sessions. Options are shuffled per attempt and keyed by their original index, so a shared "1B 2D 3A" key is useless.
- **Grading is server-side**: score, negative marking, time taken (server clock, capped at the limit), XP with streak multiplier, course score (best 5 of the last 10 ranked attempts, weighted to recent), badges.
- **Fair play**: under 3 s/question at 90%+ accuracy is held off the board for a super admin to review (XP still counts).
- **Offline**: a downloaded course (answers included) can be sat with no connection. Results queue on the phone, are re-graded on sync, earn XP, and never move course-score boards.
- **Answer keys**: nothing goes live until a person approves each question; AI-suggested keys stay out of exam mode until verified; 3 reports auto-hide a question; changing a live key re-marks every past attempt.
- **Ask** only opens for questions whose answer the student has already seen, at 5 per day; a failed reply doesn't count.

## Practice tests

Admins set them under **Admin → Practice tests**: pick a course, a size (5 to 25 questions), a time limit, and optionally some topics, negative marking, a closing date and a note to students. The questions are drawn at random from checked questions, one topic at a time, so the spread stays even. Every student sits the same set, shuffled.

- A **draft** lets the admin read the draw, swap single questions, or draw a new set. Publishing notifies the course's students once.
- Students find live tests on Home, the Practise tab and the course page. They can sit a test as often as they like, and their best score is kept. Tests earn XP and streak days, but don't move course-score boards.
- Once anyone has finished a test, its questions and marking are fixed. Close it instead of deleting it, so students keep their results. A test past its closing date closes itself.
- Code: `src/server/services/quizzes.ts` (the draw), `src/server/routes/admin/quizzes.ts`, `src/server/routes/quizzes.ts`, attempt mode `quiz`. The migration is `0003_quizzes.sql`.

## Other behaviour worth knowing

- **Opera Mini** (data-saver mode can't run the app) gets a plain page, `public/unsupported.html`, served by `src/proxy.ts`, telling the student to open the link in Chrome.
- **Updates**: a new service worker waits and shows "New version ready" with Reload. It never appears during an exam, a game or Ask.
- **Session expired**: if a student who was signed in on the phone gets signed out by the server, the sign-in screen says so and confirms their offline results are safe.
- **Review scan boxes**: extraction records where each question sits on the page. The review screen draws those boxes on the scan; tap a box to open that question.

## Not built yet

- Tests beyond the API smoke script (`node scripts/smoke.mjs` with the dev server running and a fresh `npm run db:seed:demo` on the laptop database).
