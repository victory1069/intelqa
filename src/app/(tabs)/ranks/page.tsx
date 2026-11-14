"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { usePendingSync } from "@/lib/use-downloads";
import { startOnline } from "@/lib/start";
import { inviteUrl } from "@/lib/invite";
import type { Board, BoardRow } from "@/lib/types";
import { Avatar, Banner, EmptyState, Pill, Sheet, Skeleton, fmtClock } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Tab = "course" | "department" | "institution" | "friends" | "daily";
const TAB_KEY = "iq-ranks-tab";
/** D07: your own row per board, so the loading state can show it before the board arrives. */
const ME_ROW_KEY = "iq-ranks-me";
/** D05: last known friends count, for the pill on other tabs. */
const FRIENDS_KEY = "iq-ranks-friends";

type SavedMe = { row: BoardRow; rankedBy: string; date?: string };

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
/** Today in Lagos as YYYY-MM-DD. */
const lagosDate = (at: number) => new Date(at + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

/** Next Monday 00:00 in Lagos (UTC+1, no DST). */
function nextLagosMonday(at: number) {
  const local = new Date(at + LAGOS_OFFSET_MS);
  const dow = (local.getUTCDay() + 6) % 7; // Mon = 0
  local.setUTCDate(local.getUTCDate() + (7 - dow));
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() - LAGOS_OFFSET_MS;
}

/** ISO week number of the Lagos date. */
function lagosWeek(at: number) {
  const d = new Date(lagosDate(at) + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

/** "1d 03h", or "4h 12m" on the last day. */
function fmtEndsIn(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Wall clock that ticks from an interval. */
function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export default function Ranks() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab | null) ?? "course";
    } catch {
      return "course";
    }
  });
  const [picked, setCourseId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const courseId = picked ?? (me?.courses.find((c) => c.status === "live") ?? me?.courses[0])?.id ?? null;
  const [period, setPeriod] = useState<"week" | "all">("week");
  const [metric, setMetric] = useState<"xp" | "course">("xp");
  const [showTop, setShowTop] = useState(false);


  const course = me?.courses.find((c) => c.id === courseId);
  const path =
    tab === "course" || tab === "daily"
      ? courseId ? `/leaderboard?board=${tab}&course=${courseId}` : null
      : tab === "friends"
        ? `/leaderboard?board=friends&metric=${metric}${courseId ? `&course=${courseId}` : ""}`
        : `/leaderboard?board=${tab}&period=${period}`;
  const { data, loading, staleAt } = useApi<Board>(path);
  const pending = usePendingSync().length;
  const meKey = `${tab}:${tab === "course" || tab === "daily" || tab === "friends" ? (courseId ?? "") : ""}`;
  const [savedFriends] = useState(() => readJson<number>(FRIENDS_KEY));
  const friendsCount = tab === "friends" && data && !staleAt ? data.total : savedFriends;

  // Remember your row and the friends count for the next visit's loading state.
  useEffect(() => {
    if (!data || staleAt) return;
    try {
      if (data.me) {
        const all = readJson<Record<string, SavedMe>>(ME_ROW_KEY) ?? {};
        all[meKey] = { row: data.me, rankedBy: data.rankedBy, date: data.date };
        localStorage.setItem(ME_ROW_KEY, JSON.stringify(all));
      }
      if (tab === "friends") localStorage.setItem(FRIENDS_KEY, JSON.stringify(data.total));
    } catch {}
  }, [data, staleAt, meKey, tab]);

  function pick(t: Tab) {
    setTab(t);
    setShowTop(false);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  }

  // E13
  if (me?.hiddenFromBoards) {
    const held = me.heldIn?.length ? me.heldIn.join(" and ") : null;
    const subject = encodeURIComponent(`Fair-play review${held ? ` · ${held}` : ""}`);
    return (
      <>
        <Title />
        <EmptyState glyph="eyeOff" tone="flag" title="You're hidden from leaderboards">
          Several of your {held ? <strong className="text-ink">{held}</strong> : null} sessions were finished faster than the questions can be read. You can still practise and earn XP. Boards come back after a review.
        </EmptyState>
        <div className="flex flex-col gap-3 px-5 pt-2">
          <ButtonLink href={`mailto:support@intelqa.app?subject=${subject}`} full icon="mail">Ask for a review</ButtonLink>
          <Button kind="ghost" full onClick={() => setRulesOpen(true)}>Fair play rules</Button>
        </div>
        <Sheet open={rulesOpen} onClose={() => setRulesOpen(false)} label="Fair play rules">
          <strong className="font-display text-xl">Fair play rules</strong>
          <ul className="flex list-disc flex-col gap-3 pl-5 text-[15px] leading-relaxed text-ink2">
            <li>Boards rank what you can do in exam conditions. Sessions answered in under about 3 seconds a question with very high accuracy are held for a person to check.</li>
            <li>Held sessions still earn XP and still count for your streak.</li>
            <li>Sharing answer keys during a live exam, or using several accounts, gets an account suspended.</li>
            <li>A person reviews every hold. If it was fair, your sessions go back on the boards.</li>
          </ul>
          <Button full onClick={() => setRulesOpen(false)}>Got it</Button>
        </Sheet>
      </>
    );
  }

  return (
    <>
      {staleAt && (
        <div className="px-3 pt-2">
          <Banner icon="offline">
            Offline. Board as of {new Date(staleAt).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()}.
            {pending > 0 && ` ${pending} ${pending === 1 ? "result" : "results"} will sync when you reconnect.`}
          </Banner>
        </div>
      )}
      <Title>
        {(tab === "course" || tab === "daily" || (tab === "friends" && metric === "course")) && me && (
          <label className="relative flex items-center gap-1 rounded-[10px] border-[1.5px] border-line px-2.5 py-1.5 font-mono text-[13px] font-bold">
            <select value={courseId ?? ""} onChange={(e) => setCourseId(e.target.value)} className="appearance-none bg-transparent pr-4 outline-none" aria-label="Course">
              {me.courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
            <Icon name="chevD" size={14} className="pointer-events-none absolute right-2" />
          </label>
        )}
        {(tab === "department" || tab === "institution") && (
          <Segment value={period} onChange={setPeriod} options={[["week", "This week"], ["all", "All time"]]} />
        )}
        {tab === "friends" && <Segment value={metric} onChange={setMetric} options={[["xp", "XP"], ["course", `${course?.code ?? "Course"} score`]]} />}
      </Title>
      <div className="flex gap-2 overflow-x-auto px-5 pt-6">
        <Pill on={tab === "course"} onClick={() => pick("course")}>Course</Pill>
        <Pill on={tab === "department"} onClick={() => pick("department")}>Department</Pill>
        <Pill on={tab === "institution"} onClick={() => pick("institution")}>{me?.institution?.shortCode ?? "School"}</Pill>
        <Pill on={tab === "friends"} onClick={() => pick("friends")}>{friendsCount && friendsCount > 1 ? `Friends · ${friendsCount}` : "Friends"}</Pill>
        <Pill on={tab === "daily"} onClick={() => pick("daily")}>Daily</Pill>
      </div>

      {!data && loading ? (
        <BoardSkeleton key={meKey} meKey={meKey} daily={tab === "daily"} />
      ) : !data ? (
        <EmptyState glyph="board" title="Couldn't load this board">Pull down to try again.</EmptyState>
      ) : tab === "friends" && data.total <= 1 ? (
        <FriendsEmpty code={me?.inviteCode ?? ""} />
      ) : (
        <BoardView board={data} tab={tab} courseCode={course?.code ?? ""} courseId={courseId} dept={me?.department?.name ?? ""} showTop={showTop} setShowTop={setShowTop} />
      )}
    </>
  );
}

function Title({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 px-5 pt-8 lg:pt-14">
      <h1 className="display text-[48px] lg:text-[72px]">Ranks</h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Segment<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-[10px] bg-raised p-[3px]" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={`rounded-lg px-2.5 py-1.5 text-xs ${value === v ? "bg-surface font-semibold shadow-card" : "text-ink2"}`}>{l}</button>
      ))}
    </div>
  );
}

const fmtValue = (r: BoardRow, board: Board) =>
  board.rankedBy === "xp" ? `${r.value.toLocaleString()} XP` : board.rankedBy === "score_then_time" ? `${r.value}/10` : `${Math.round(r.value)}%`;

function Row({ r, board, sub }: { r: BoardRow; board: Board; sub?: string }) {
  return (
    <div className={`flex min-h-[54px] items-center gap-3 rounded-xl px-3 py-2.5 ${r.me ? "border-[1.5px] border-accent bg-accent-tint" : ""}`}>
      <span className={`w-[38px] font-mono text-[13px] font-bold ${r.me ? "text-accent-text" : ""}`}>#{r.rank}</span>
      <Avatar name={r.name} me={r.me} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-sm ${r.me ? "font-bold" : "font-medium"}`}>{r.me ? `You · ${r.name}` : r.name}</span>
        {sub && <span className="text-xs text-ink3">{sub}</span>}
      </span>
      <strong className={`font-mono text-[13px] ${board.rankedBy === "score_then_time" ? "w-[50px] text-right" : ""}`}>{fmtValue(r, board)}</strong>
      {board.rankedBy === "score_then_time" && <span className="w-[52px] text-right font-mono text-[13px] text-ink2">{fmtClock(r.extra ?? 0)}</span>}
    </div>
  );
}

function BoardView({
  board, tab, courseCode, courseId, dept, showTop, setShowTop,
}: {
  board: Board; tab: Tab; courseCode: string; courseId: string | null; dept: string; showTop: boolean; setShowTop: (b: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const now = useNow(tab === "daily" ? 1000 : 30_000);
  const weekly = (tab === "department" || tab === "institution") && !!board.resetsAt;
  const endsAt = board.resetsAt ? new Date(board.resetsAt).getTime() : nextLagosMonday(now);
  const caption = {
    course: `Course score · ${board.total.toLocaleString()} ranked · resets end of semester`,
    department: `${dept || "Department"} · total XP${board.resetsAt ? " · resets Monday" : ""}`,
    institution: `Total XP${board.resetsAt ? " · this week · resets Monday" : " · all time"}`,
    friends: `${board.rankedBy === "xp" ? "XP this week" : `${courseCode} score`} · ${board.total} people`,
    daily: `Score, then time · ${board.total.toLocaleString()} played today`,
  }[tab];

  // D06: the student isn't ranked on this course yet.
  const notRanked = tab === "course" && !board.me;
  const podium = tab === "course" && board.top.length >= 3 ? [board.top[1], board.top[0], board.top[2]] : null;
  const rest = podium ? board.top.slice(3) : board.top;
  const meInTop = board.top.some((r) => r.me);

  return (
    <main className="flex flex-col pb-10">
      {tab === "daily" && (
        <span className="px-5 pt-5 font-mono text-[11px] tracking-wide text-ink3 uppercase">
          {new Date((board.date ?? lagosDate(now)) + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "")}
          {" · "}RESETS IN {fmtClock(Math.max(0, (endsAt - now) / 1000))}
        </span>
      )}
      <span className={`px-5 text-[13px] text-ink3 ${tab === "daily" ? "pt-2" : "pt-5"}`}>{caption}</span>

      {tab === "daily" && board.me && (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-[18px] bg-highlighter p-5 text-exam-ink">
          <Icon name="calendar" size={26} color="#15132B" />
          <div className="flex flex-col"><strong className="text-[15px]">You: {board.me.value}/10 in {fmtClock(board.me.extra ?? 0)}</strong><span className="text-[13px]">#{board.me.rank} of {board.total.toLocaleString()} today</span></div>
        </div>
      )}
      {tab !== "course" && tab !== "daily" && tab !== "friends" && board.me && (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-[18px] bg-accent p-5 text-on-accent">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-xs opacity-90">{tab === "department" ? `${dept || "Department"} · 100L${weekly ? ` · week ${lagosWeek(now)}` : ""}` : `Your school${weekly ? ` · week ${lagosWeek(now)}` : ""}`}</span>
            <strong className="font-display text-2xl">#{board.me.rank} of {board.total.toLocaleString()}</strong>
          </div>
          {weekly && (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs opacity-90">Ends in</span>
              <strong className="font-mono text-sm">{fmtEndsIn(endsAt - now)}</strong>
            </div>
          )}
        </div>
      )}

      {notRanked && courseId && (
        <div className="mx-5 mt-3.5 flex flex-col gap-4 rounded-[18px] border-[1.5px] border-dashed border-accent bg-surface p-6">
          <div className="flex items-center gap-2.5"><span className="font-mono text-base font-bold text-accent-text">#?</span><strong className="text-[15px]">You need 3 ranked sessions to join this board</strong></div>
          <span className="text-sm text-ink2">Course boards count exams and quick drills, so one lucky run can&apos;t top them.</span>
          <Button size="md" full loading={busy} onClick={async () => { setBusy(true); try { router.push(await startOnline({ mode: "drill", courseId, size: 10 })); } catch { setBusy(false); } }}>Do a {courseCode} drill</Button>
        </div>
      )}

      {podium && (
        <div className="flex items-end gap-2 px-5 pt-3">
          {podium.map((p, n) => {
            const first = n === 1;
            return (
              <div key={p.userId} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="rounded-full" style={{ boxShadow: `0 0 0 3px var(--bg), 0 0 0 5px ${first ? "#FFD43B" : n === 0 ? "#C4C1D9" : "#E8A272"}` }}><Avatar name={p.name} size={44} me={p.me} /></span>
                <span className="text-center text-xs leading-tight font-semibold">{p.name}</span>
                <div className={`flex w-full flex-col items-center justify-center rounded-[12px_12px_4px_4px] ${first ? "bg-accent text-on-accent" : "bg-raised"}`} style={{ height: first ? 84 : n === 0 ? 62 : 50 }}>
                  <strong className="font-display text-xl">#{p.rank}</strong>
                  <span className="font-mono text-[11px]">{fmtValue(p, board)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {podium && !showTop && board.around.length > 0 && rest.length > 0 && (
        <button onClick={() => setShowTop(true)} className="mx-5 mt-2.5 flex h-[38px] items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-[13px] font-semibold text-accent-text">
          Show #4 – #{board.top.at(-1)?.rank}<Icon name="chevD" size={14} />
        </button>
      )}

      {tab === "daily" && board.top.length > 0 && (
        <div className="flex px-6 pt-3.5 pb-1 font-mono text-[10.5px] tracking-wide text-ink3" aria-hidden>
          <span className="w-[48px]">RANK</span>
          <span className="flex-1">NAME</span>
          <span className="w-[50px] text-right">SCORE</span>
          <span className="w-[52px] text-right">TIME</span>
        </div>
      )}
      <div className={`flex flex-col gap-0.5 px-5 ${tab === "daily" ? "" : "pt-2"}`}>
        {(!podium || showTop || board.around.length === 0 || meInTop) && rest.map((r) => <Row key={r.userId} r={r} board={board} />)}
        {board.around.length > 0 && (
          <>
            {(!podium || showTop) && <span className="py-1 text-center text-ink3" aria-hidden>⋯</span>}
            {board.around.map((r) => <Row key={r.userId} r={r} board={board} />)}
          </>
        )}
        {!board.top.length && <span className="p-6 text-sm text-ink2">Nobody on this board yet. Be the first.</span>}
      </div>

      {tab === "friends" && (
        <div className="px-5 pt-3"><InviteButton label="Challenge a friend" /></div>
      )}
    </main>
  );
}

/** D07: skeleton rows at the real row height, with your own row from the last saved board. */
function BoardSkeleton({ meKey, daily }: { meKey: string; daily: boolean }) {
  const [saved] = useState(() => {
    const s = readJson<Record<string, SavedMe>>(ME_ROW_KEY)?.[meKey];
    // Yesterday's daily rank would be misleading.
    return s && (!daily || s.date === lagosDate(Date.now())) ? s : null;
  });
  const skeletonRow = (i: number, w: string, o = 1) => (
    <div key={i} className="flex h-[42px] items-center gap-2.5 rounded-xl bg-surface px-2.5" style={{ opacity: o }}>
      <Skeleton className="h-3 w-7 rounded-md" />
      <Skeleton className="h-7 w-7 rounded-full" />
      <span className="block h-3 rounded-md bg-raised" style={{ width: w }} />
    </div>
  );
  return (
    <div className="flex flex-col gap-1.5 px-5 pt-5" aria-busy="true">
      <div className="flex items-end gap-2 px-1.5 pb-3">
        <Skeleton className="h-20 flex-1 rounded-xl" />
        <Skeleton className="h-[104px] flex-1 rounded-xl" />
        <Skeleton className="h-[68px] flex-1 rounded-xl" />
      </div>
      {skeletonRow(0, "50%")}
      {skeletonRow(1, "40%")}
      {saved && <Row r={{ ...saved.row, me: true }} board={{ total: 0, me: null, top: [], around: [], rankedBy: saved.rankedBy }} />}
      {skeletonRow(2, "46%")}
      {skeletonRow(3, "36%", 0.6)}
      {!saved && skeletonRow(4, "42%", 0.4)}
    </div>
  );
}

/** D04 */
function FriendsEmpty({ code }: { code: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <EmptyState glyph="users" tone="accent" title="Practise with your guys">
        Send your link to your hostel or class group. Anyone who joins with it shows up here, and you can challenge them to a paper.
      </EmptyState>
      <div className="flex flex-col gap-3 px-[22px] pt-6">
        <InviteButton label="Invite on WhatsApp" />
        <CopyLink code={code} />
      </div>
    </div>
  );
}

function InviteButton({ label }: { label: string }) {
  const { me } = useAuth();
  return (
    <Button
      full
      kind={label.startsWith("Challenge") ? "tonal" : "primary"}
      icon={label.startsWith("Challenge") ? "trophy" : "share"}
      onClick={() => {
        const text = `Practise past questions with me on IntelQA. Join with my link: ${inviteUrl(me?.inviteCode ?? "")}`;
        if (navigator.share) navigator.share({ text }).catch(() => {});
        else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
      }}
    >
      {label}
    </Button>
  );
}

function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button full kind="ghost" icon={copied ? "check" : "link"} onClick={async () => { await navigator.clipboard.writeText(inviteUrl(code)).catch(() => {}); setCopied(true); }}>
      {copied ? "Link copied" : "Copy my link"}
    </Button>
  );
}

