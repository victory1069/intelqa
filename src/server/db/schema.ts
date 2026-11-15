import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  date,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ───────────────────────── Enums ───────────────────────── */

export const roleEnum = pgEnum("role", ["student", "content_admin", "super_admin"]);
export const catalogStatusEnum = pgEnum("catalog_status", ["draft", "live"]);
export const uploadStatusEnum = pgEnum("upload_status", ["processing", "in_review", "published", "failed"]);
export const paperStatusEnum = pgEnum("paper_status", ["draft", "published", "unpublished"]);
export const examTypeEnum = pgEnum("exam_type", ["exam", "test", "post_utme"]);
export const questionStatusEnum = pgEnum("question_status", ["draft", "approved", "hidden"]);
export const difficultyEnum = pgEnum("difficulty", ["easy", "medium", "hard"]);
export const modeEnum = pgEnum("attempt_mode", ["exam", "drill", "topic", "retry", "daily", "challenge", "quiz"]);
export const reviewStatusEnum = pgEnum("review_status", ["none", "pending", "allowed", "rejected"]);
export const reportReasonEnum = pgEnum("report_reason", ["wrong_key", "unclear_explanation", "typo", "other"]);
export const quizStatusEnum = pgEnum("quiz_status", ["draft", "live", "closed"]);
export const reportStatusEnum = pgEnum("report_status", ["open", "resolved", "dismissed"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ───────────────────────── Catalogue ───────────────────────── */

export const institutions = pgTable("institutions", {
  id: id(),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull().unique(), // UNILORIN
  status: catalogStatusEnum("status").notNull().default("draft"),
  createdAt: createdAt(),
});

export const faculties = pgTable("faculties", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const departments = pgTable("departments", {
  id: id(),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const courses = pgTable(
  "courses",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // GST 111
    title: text("title").notNull(),
    level: integer("level").notNull().default(100),
    semester: integer("semester").notNull().default(1),
    /** Default format for new papers: 4 = A–D, 5 = A–E. */
    optionCount: integer("option_count").notNull().default(4),
    /** Marks lost per wrong answer, e.g. 0.25. 0 = no negative marking. */
    negativeMark: real("negative_mark").notNull().default(0),
    status: catalogStatusEnum("status").notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("courses_inst_code_idx").on(t.institutionId, t.code)],
);

/** Which departments take a course by default (used to pre-tick courses during onboarding). */
export const courseDepartments = pgTable(
  "course_departments",
  {
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.departmentId] })],
);

export const topics = pgTable("topics", {
  id: id(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

/* ───────────────────────── Users ───────────────────────── */

export const users = pgTable("users", {
  /** Same id as the Supabase auth user. */
  id: uuid("id").primaryKey(),
  phone: text("phone"),
  email: text("email"),
  firstName: text("first_name"),
  surname: text("surname"),
  displayName: text("display_name"),
  /** A requested name change waiting for moderation. Boards keep showing displayName. */
  pendingDisplayName: text("pending_display_name"),
  nameChangedAt: timestamp("name_changed_at", { withTimezone: true }),
  role: roleEnum("role").notNull().default("student"),
  institutionId: uuid("institution_id").references(() => institutions.id),
  departmentId: uuid("department_id").references(() => departments.id),
  level: integer("level"),
  onboarded: boolean("onboarded").notNull().default(false),
  /** True once the account has a password. New accounts (and password resets) are sent to "Create a password". */
  passwordSet: boolean("password_set").notNull().default(false),
  hiddenFromBoards: boolean("hidden_from_boards").notNull().default(false),
  suspended: boolean("suspended").notNull().default(false),
  suspendReason: text("suspend_reason"),
  /** Short code used in friend invite links. */
  inviteCode: text("invite_code").unique(),
  notifyStreak: boolean("notify_streak").notNull().default(true),
  notifyPapers: boolean("notify_papers").notNull().default(true),
  /** 8 am push that today's daily pop quiz is ready. */
  notifyDaily: boolean("notify_daily").notNull().default(true),
  createdAt: createdAt(),
});

export const userCourses = pgTable(
  "user_courses",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId] })],
);

/** Courses a content admin may edit. Super admins can edit everything. */
export const adminCourses = pgTable(
  "admin_courses",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId] })],
);

export const friendships = pgTable(
  "friendships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    friendId: uuid("friend_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.friendId] })],
);

/* ───────────────────────── Content ───────────────────────── */

export const uploads = pgTable("uploads", {
  id: id(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  /** Storage paths of the question-paper files, in page order. */
  files: jsonb("files").$type<{ path: string; mime: string; name: string }[]>().notNull(),
  answerKeyFile: jsonb("answer_key_file").$type<{ path: string; mime: string; name: string } | null>(),
  status: uploadStatusEnum("status").notNull().default("processing"),
  session: text("session").notNull(), // 2023/2024
  semester: integer("semester").notNull().default(1),
  examType: examTypeEnum("exam_type").notNull().default("exam"),
  timeLimitMin: integer("time_limit_min").notNull(),
  optionCount: integer("option_count").notNull().default(4),
  negativeMark: real("negative_mark").notNull().default(0),
  /** Pipeline progress shown on the processing screen. */
  progress: jsonb("progress").$type<{ step: number; total: number; label: string }>(),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  error: text("error"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const papers = pgTable("papers", {
  id: id(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
  session: text("session").notNull(),
  semester: integer("semester").notNull().default(1),
  examType: examTypeEnum("exam_type").notNull().default("exam"),
  timeLimitMin: integer("time_limit_min").notNull(),
  optionCount: integer("option_count").notNull().default(4),
  negativeMark: real("negative_mark").notNull().default(0),
  status: paperStatusEnum("status").notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by").references(() => users.id),
  createdAt: createdAt(),
});

export const questions = pgTable(
  "questions",
  {
    id: id(),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    options: jsonb("options").$type<string[]>().notNull(),
    /** 0-based index into options. Null when the source had no key and none was proposed. */
    correctOption: integer("correct_option"),
    /** False when the key came from the AI, not the source or a person. Unverified questions stay out of exam mode. */
    answerVerified: boolean("answer_verified").notNull().default(false),
    explanation: text("explanation"),
    /** One line on why the most common wrong answer is a trap. */
    trap: text("trap"),
    workedSteps: jsonb("worked_steps").$type<string[]>(),
    imagePath: text("image_path"),
    imageAlt: text("image_alt"),
    imageBytes: integer("image_bytes"),
    difficulty: difficultyEnum("difficulty").notNull().default("medium"),
    status: questionStatusEnum("status").notNull().default("draft"),
    /** Auto-hidden after 3 open reports. */
    autoHidden: boolean("auto_hidden").notNull().default(false),
    confidence: real("confidence"),
    /** Pipeline flags shown at the top of the review list, e.g. "Option D smudged". */
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    hasDiagram: boolean("has_diagram").notNull().default(false),
    sourceUploadId: uuid("source_upload_id").references(() => uploads.id, { onDelete: "set null" }),
    sourcePage: integer("source_page"),
    sourceBox: jsonb("source_box").$type<{ x: number; y: number; w: number; h: number } | null>(),
    sourceNumber: integer("source_number"),
    /** Links repeats across years. */
    repeatOfId: uuid("repeat_of_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("questions_course_idx").on(t.courseId), index("questions_topic_idx").on(t.topicId)],
);

export const paperQuestions = pgTable(
  "paper_questions",
  {
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.paperId, t.questionId] })],
);

/**
 * A practice test an admin sets for a course. The admin picks the course, topics, size and time;
 * the questions are drawn at random across those topics and every student sits the same set.
 */
export const quizzes = pgTable(
  "quizzes",
  {
    id: id(),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions"),
    /** Topics the draw came from. Empty = every topic in the course. */
    topicIds: jsonb("topic_ids").$type<string[]>().notNull().default([]),
    /** The drawn questions, in the order they were drawn (each student sees them shuffled). */
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    timeLimitMin: integer("time_limit_min").notNull(),
    negativeMark: real("negative_mark").notNull().default(0),
    status: quizStatusEnum("status").notNull().default("draft"),
    /** Optional last day to sit it; after this it closes itself. */
    closesAt: timestamp("closes_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quizzes_course_idx").on(t.courseId, t.status)],
);

/* ───────────────────────── Attempts ───────────────────────── */

export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mode: modeEnum("mode").notNull(),
    courseId: uuid("course_id").notNull().references(() => courses.id),
    paperId: uuid("paper_id").references(() => papers.id),
    topicId: uuid("topic_id").references(() => topics.id),
    challengeId: uuid("challenge_id"),
    quizId: uuid("quiz_id").references(() => quizzes.id, { onDelete: "set null" }),
    dailyDate: date("daily_date"),
    /** Question ids in the order this student sees them. */
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    /** Per question, the original option indexes in display order. */
    optionOrders: jsonb("option_orders").$type<number[][]>().notNull(),
    negativeMark: real("negative_mark").notNull().default(0),
    timeLimitSec: integer("time_limit_sec"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    autoSubmitted: boolean("auto_submitted").notNull().default(false),
    score: real("score"),
    maxScore: integer("max_score"),
    correctCount: integer("correct_count"),
    wrongCount: integer("wrong_count"),
    skippedCount: integer("skipped_count"),
    timeTakenSec: integer("time_taken_sec"),
    xpEarned: integer("xp_earned"),
    /** Taken offline and synced later: earns XP but never counts toward course score. */
    offline: boolean("offline").notNull().default(false),
    countsForBoard: boolean("counts_for_board").notNull().default(false),
    /** Fair-play hold. */
    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("none"),
    /** Client-generated id for offline attempts so sync is idempotent. */
    clientId: text("client_id").unique(),
  },
  (t) => [index("attempts_user_idx").on(t.userId), index("attempts_course_idx").on(t.courseId)],
);

export const attemptAnswers = pgTable(
  "attempt_answers",
  {
    attemptId: uuid("attempt_id").notNull().references(() => attempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    /** Original (unshuffled) option index, or null if skipped. */
    chosenOption: integer("chosen_option"),
    correct: boolean("correct"),
    timeSpentMs: integer("time_spent_ms").notNull().default(0),
    flagged: boolean("flagged").notNull().default(false),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.questionId] }), index("answers_question_idx").on(t.questionId)],
);

/* ───────────────────────── Derived / gamification ───────────────────────── */

export const xpEvents = pgTable(
  "xp_events",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id").references(() => attempts.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("xp_user_time_idx").on(t.userId, t.createdAt)],
);

export const userCourseStats = pgTable(
  "user_course_stats",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    /** 0–100. Weighted average of best 5 ranked attempts. */
    courseScore: real("course_score").notNull().default(0),
    rankedAttempts: integer("ranked_attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId] }), index("ucs_board_idx").on(t.courseId, t.courseScore)],
);

export const userStreaks = pgTable("user_streaks", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  current: integer("current").notNull().default(0),
  best: integer("best").notNull().default(0),
  /** Lagos-local date of the last session that counted. */
  lastActiveDate: date("last_active_date"),
  freezes: integer("freezes").notNull().default(0),
  freezeUsedOn: date("freeze_used_on"),
  /** Length of the streak the daily job just ended, and when. Shown once on Home. */
  brokenStreak: integer("broken_streak"),
  brokenOn: date("broken_on"),
  /** Streak length the last freeze saved. */
  frozenStreak: integer("frozen_streak"),
  totalXp: integer("total_xp").notNull().default(0),
  questionsAnswered: integer("questions_answered").notNull().default(0),
  questionsCorrect: integer("questions_correct").notNull().default(0),
});

export const badgesEarned = pgTable(
  "badges_earned",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    badgeKey: text("badge_key").notNull(),
    earnedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeKey] })],
);

export const questionReports = pgTable("question_reports", {
  id: id(),
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: reportReasonEnum("reason").notNull(),
  note: text("note"),
  status: reportStatusEnum("status").notNull().default("open"),
  createdAt: createdAt(),
});

export const bookmarks = pgTable(
  "bookmarks",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] })],
);

export const dailyChallenges = pgTable(
  "daily_challenges",
  {
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.date] })],
);

export const challenges = pgTable("challenges", {
  id: id(),
  code: text("code").notNull().unique(),
  creatorId: uuid("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  creatorAttemptId: uuid("creator_attempt_id").references(() => attempts.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const askMessages = pgTable(
  "ask_messages",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ask_user_time_idx").on(t.userId, t.createdAt)],
);

/** An admin invite waiting for that phone/email to sign in for the first time. */
export const adminInvites = pgTable("admin_invites", {
  id: id(),
  contact: text("contact").notNull().unique(), // +2348000000000 or email
  role: roleEnum("role").notNull(),
  courseIds: jsonb("course_ids").$type<string[]>().notNull().default([]),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const institutionRequests = pgTable("institution_requests", {
  id: id(),
  name: text("name").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/** A09: students waiting for a "coming soon" school to open. */
export const waitlist = pgTable(
  "waitlist",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.institutionId] })],
);

/* ───────────────────────── Notifications ───────────────────────── */

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

/** In-app inbox; every push is also stored here. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"streak" | "paper" | "score_corrected" | "challenge" | "rank" | "name" | "daily">().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

/** Each student's course rank at the start of the week, for "↑ 12 this week". */
export const rankSnapshots = pgTable(
  "rank_snapshots",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    rank: integer("rank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId, t.weekStart] })],
);
