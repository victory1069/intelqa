CREATE TYPE "public"."quiz_status" AS ENUM('draft', 'live', 'closed');--> statement-breakpoint
ALTER TYPE "public"."attempt_mode" ADD VALUE 'quiz';--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"topic_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"question_ids" jsonb NOT NULL,
	"time_limit_min" integer NOT NULL,
	"negative_mark" real DEFAULT 0 NOT NULL,
	"status" "quiz_status" DEFAULT 'draft' NOT NULL,
	"closes_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "quiz_id" uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quizzes_course_idx" ON "quizzes" USING btree ("course_id","status");--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE set null ON UPDATE no action;