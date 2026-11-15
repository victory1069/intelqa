import type { Mode } from "@/shared/game";

export type Level = { n: number; name: string; xp: number; next: { n: number; name: string; xp: number } | null; toNext: number };

export type Streak = {
  current: number;
  best: number;
  freezes: number;
  practisedToday: boolean;
  endsAt: string | null;
  multiplier: number;
  totalXp: number;
  questionsAnswered: number;
  accuracy: number | null;
};

export type Me = {
  id: string;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  surname: string | null;
  displayName: string | null;
  initials: string;
  pendingDisplayName: string | null;
  role: "student" | "content_admin" | "super_admin";
  onboarded: boolean;
  /** False until the account has a password; older cached profiles may not have it. */
  passwordSet?: boolean;
  hiddenFromBoards: boolean;
  /** Course codes whose sessions were held for fair-play review (E13). */
  heldIn?: string[];
  level: number | null;
  inviteCode: string | null;
  institution: { id: string; name: string; shortCode: string } | null;
  department: { id: string; name: string } | null;
  courses: { id: string; code: string; title: string; status: string }[];
  streak: Streak;
  xp: { total: number; level: Level };
  badges: { key: string; name: string; sub: string; glyph: string; earned: boolean }[];
  ask: { used: number; remaining: number };
  notify: { streak: boolean; papers: boolean; daily: boolean };
  unread: number;
};

export type Rank = { rank: number; total: number } | null;

export type StreakMoment =
  | { kind: "freeze"; on: string; days: number; freezesLeft: number }
  | { kind: "lost"; on: string; days: number; best: number };

export type Home = {
  moment: StreakMoment | null;
  unread: number;
  firstName: string | null;
  streak: Streak;
  xp: { total: number; level: Level };
  resume: { id: string; mode: Mode; courseCode: string; session: string | null; answered: number; total: number; deadlineAt: string | null } | null;
  daily: { courseId: string; courseCode: string; played: number; mine: { attemptId: string; score: number | null; timeTakenSec: number | null } | null; resetsAt: string } | null;
  courses: { id: string; code: string; title: string; status: string; papers: number; courseScore: number | null; rankedAttempts: number; rank: Rank; /** Places gained (+) or lost (−) this Lagos week; null with no snapshot. */ moved: number | null; /** Estimated size of the offline download. */ offlineBytes: number }[];
  firstTime: boolean;
  /** Practice tests set by course admins that the student hasn't sat yet. */
  quizzes: StudentQuiz[];
};

/** A practice test set by a course admin, as a student sees it. */
export type StudentQuiz = {
  id: string;
  title: string;
  instructions: string | null;
  course: { id: string; code: string; title: string };
  questions: number;
  timeLimitMin: number;
  negativeMark: number;
  status: "live" | "closed";
  closesAt: string | null;
  publishedAt: string | null;
  /** Finished sittings by this student. */
  sittings: number;
  best: number | null;
  lastAttemptId: string | null;
  openAttemptId: string | null;
};

export type CoursePage = {
  course: { id: string; code: string; title: string; optionCount: number; negativeMark: number; status: string };
  courseScore: number | null;
  rankedAttempts: number;
  rank: Rank;
  mistakes: number;
  topics: { id: string; name: string; questions: number; mastery: number | null }[];
  papers: { id: string; session: string; examType: string; timeLimitMin: number; optionCount: number; negativeMark: number; questions: number; best: number | null; tried: boolean }[];
};

export type SessionQuestion = {
  id: string;
  text: string;
  options: { key: number; text: string }[];
  imageUrl: string | null;
  imageAlt: string | null;
  imageBytes: number | null;
  topicId: string | null;
};

export type Session = {
  id: string;
  mode: Mode;
  course: { id: string; code: string; title: string };
  paper: { id: string; session: string; examType: string; optionCount: number } | null;
  quiz?: { id: string; title: string } | null;
  negativeMark: number;
  startedAt: string;
  deadlineAt: string | null;
  serverNow: string;
  submittedAt: string | null;
  instantFeedback: boolean;
  questions: SessionQuestion[];
  answers: { questionId: string; choice: number | null; flagged: boolean; timeSpentMs: number }[];
  /** Set on sessions running from a downloaded course. */
  offlineClientId?: string;
};

export type ReviewQuestion = {
  id: string;
  text: string;
  options: string[];
  correctOption: number | null;
  answerVerified: boolean;
  explanation: string | null;
  trap: string | null;
  workedSteps: string[] | null;
  imageUrl: string | null;
  imageAlt: string | null;
  topicId: string | null;
};

export type GradeResult = {
  attemptId: string;
  score: number;
  maxScore: number;
  percent: number;
  correct: number;
  wrong: number;
  skipped: number;
  timeTakenSec: number;
  xp: { earned: number; multiplier: number; streak: number };
  flagged: boolean;
  countsForBoard: boolean;
  rank: { before: number | null; after: number | null; total: number | null } | null;
  newBadges: string[];
  xpBefore: number;
  totalXp: number;
};

export type Result = {
  id: string;
  mode: Mode;
  course: { id: string; code: string; title: string };
  paperId: string | null;
  quizId?: string | null;
  score: number;
  maxScore: number;
  percent: number;
  correct: number;
  wrong: number;
  skipped: number;
  negativeMark: number;
  timeTakenSec: number;
  xpEarned: number;
  autoSubmitted: boolean;
  flagged: boolean;
  reviewStatus: string;
  offline: boolean;
  rank: { position: number; total: number; ahead: { name: string; gap: number } | null } | null;
  rankedAttempts: number;
  breakdown: { topicId: string | null; name: string; correct: number; total: number }[];
};

export type ReviewItem = {
  number: number;
  chosen: number | null;
  correct: boolean;
  flagged: boolean;
  bookmarked: boolean;
  topicName: string | null;
  question: ReviewQuestion;
};

export type BoardRow = { rank: number; userId: string; name: string; value: number; extra?: number | null; me: boolean };
export type Board = { total: number; me: BoardRow | null; top: BoardRow[]; around: BoardRow[]; rankedBy: string; resetsAt?: string | null; date?: string };
