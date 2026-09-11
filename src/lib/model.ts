import { z } from "zod";

export type Phase = "focus" | "short" | "long";
export type Settings = {
  focus: number;
  short: number;
  long: number;
  cycles: number;
  sound: boolean;
};
export const DEFAULT_SETTINGS: Settings = {
  focus: 25,
  short: 5,
  long: 15,
  cycles: 4,
  sound: true,
};
const timestampSchema = z.iso.datetime({ offset: true });
export const segmentSchema = z
  .object({ start: timestampSchema, end: timestampSchema })
  .refine((s) => Date.parse(s.end) > Date.parse(s.start), "Invalid interval");
export const sessionSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().max(120),
    started_at: timestampSchema,
    ended_at: timestampSchema,
    duration_seconds: z.number().int().min(1).max(10800),
    completed: z.boolean(),
    segments: z.array(segmentSchema).min(1).max(500),
  })
  .superRefine((s, ctx) => {
    const total = s.segments.reduce(
      (n, seg) => n + Date.parse(seg.end) - Date.parse(seg.start),
      0,
    );
    if (
      Math.abs(Math.floor(total / 1000) - s.duration_seconds) > 1 ||
      Date.parse(s.ended_at) < Date.parse(s.started_at) ||
      s.segments.some(
        (seg, i) =>
          Date.parse(seg.start) < Date.parse(s.started_at) ||
          Date.parse(seg.end) > Date.parse(s.ended_at) ||
          (i > 0 && Date.parse(seg.start) < Date.parse(s.segments[i - 1].end)),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid session timing" });
  });
export type FocusSession = z.infer<typeof sessionSchema>;
export type Segment = FocusSession["segments"][number];
export type Timer = {
  phase: Phase;
  totalMs: number;
  segments: Segment[];
  runStartedAt: number | null;
  startedAt: number | null;
  id: string;
  title: string;
  completedCount: number;
};
export function newTimer(
  settings: Settings,
  phase: Phase = "focus",
  count = 0,
): Timer {
  return {
    phase,
    totalMs: settings[phase] * 60_000,
    segments: [],
    runStartedAt: null,
    startedAt: null,
    id: crypto.randomUUID(),
    title: "",
    completedCount: count,
  };
}
export function elapsed(timer: Timer, now: number) {
  return Math.min(
    timer.totalMs,
    timer.segments.reduce(
      (n, s) => n + Date.parse(s.end) - Date.parse(s.start),
      0,
    ) +
      (timer.runStartedAt === null ? 0 : Math.max(0, now - timer.runStartedAt)),
  );
}
export function pauseTimer(timer: Timer, now: number): Timer {
  if (timer.runStartedAt === null) return timer;
  const previous = timer.segments.reduce(
    (n, s) => n + Date.parse(s.end) - Date.parse(s.start),
    0,
  );
  const end = Math.min(now, timer.runStartedAt + timer.totalMs - previous);
  return {
    ...timer,
    runStartedAt: null,
    segments:
      end > timer.runStartedAt
        ? [
            ...timer.segments,
            {
              start: new Date(timer.runStartedAt).toISOString(),
              end: new Date(end).toISOString(),
            },
          ]
        : timer.segments,
  };
}
export function finishTimer(
  timer: Timer,
  settings: Settings,
  now: number,
  completed: boolean,
): { timer: Timer; session: FocusSession | null } {
  const stopped = pauseTimer(timer, now);
  const seconds = Math.floor(elapsed(stopped, now) / 1000);
  const count =
    timer.completedCount + (timer.phase === "focus" && completed ? 1 : 0);
  const next: Phase =
    timer.phase === "focus"
      ? completed && count % settings.cycles === 0
        ? "long"
        : "short"
      : "focus";
  const session: FocusSession | null =
    timer.phase === "focus" && seconds >= 1
      ? {
          id: timer.id,
          title: timer.title.trim() || "專注時段",
          started_at: stopped.segments[0].start,
          ended_at: stopped.segments.at(-1)!.end,
          duration_seconds: seconds,
          completed,
          segments: stopped.segments,
        }
      : null;
  return { timer: newTimer(settings, next, count), session };
}
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function weekStart(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
export function secondsOnDay(session: FocusSession, date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  return session.segments.reduce(
    (n, seg) =>
      n +
      Math.max(
        0,
        Math.min(Date.parse(seg.end), +end) -
          Math.max(Date.parse(seg.start), +start),
      ) /
        1000,
    0,
  );
}
export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m >= 60
    ? `${Math.floor(m / 60)} 小時 ${m % 60} 分`
    : m > 0 || seconds === 0
      ? `${m} 分鐘`
      : `${Math.floor(seconds)} 秒`;
}
