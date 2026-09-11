import { test } from "node:test";
import assert from "node:assert/strict";
import type { Timer } from "../src/lib/model";
import {
  addDays,
  dateKey,
  DEFAULT_SETTINGS,
  elapsed,
  finishTimer,
  newTimer,
  pauseTimer,
  secondsOnDay,
  sessionSchema,
  weekStart,
} from "../src/lib/model";

const base = new Date("2026-09-09T10:00:00.000Z").getTime();
test("pause and resume count only active intervals", () => {
  let timer = newTimer(DEFAULT_SETTINGS);
  timer = { ...timer, runStartedAt: base, startedAt: base };
  timer = pauseTimer(timer, base + 30000);
  assert.equal(elapsed(timer, base + 90000), 30000);
  timer = { ...timer, runStartedAt: base + 90000 };
  const result = finishTimer(timer, DEFAULT_SETTINGS, base + 120000, false);
  assert.equal(result.session?.duration_seconds, 60);
  assert.equal(result.session?.segments.length, 2);
  assert.equal(result.session?.completed, false);
  assert.equal(result.timer.completedCount, 0);
  assert.equal(sessionSchema.safeParse(result.session).success, true);
});
test("background completion is capped at the deadline and does not start another timer", () => {
  const timer = {
    ...newTimer(DEFAULT_SETTINGS),
    runStartedAt: base,
    startedAt: base,
  };
  const result = finishTimer(timer, DEFAULT_SETTINGS, base + 3 * 3600000, true);
  assert.equal(result.session?.duration_seconds, 1500);
  assert.equal(
    result.session?.ended_at,
    new Date(base + 1500000).toISOString(),
  );
  assert.equal(result.timer.phase, "short");
  assert.equal(result.timer.runStartedAt, null);
});
test("every fourth completed focus leads to a long break; rests are never recorded", () => {
  let timer = newTimer(DEFAULT_SETTINGS);
  for (let n = 1; n <= 4; n++) {
    timer = { ...timer, runStartedAt: base, startedAt: base };
    const result = finishTimer(timer, DEFAULT_SETTINGS, base + 1500000, true);
    assert.equal(result.timer.phase, n === 4 ? "long" : "short");
    assert.equal(result.timer.completedCount, n);
    const rest = finishTimer(
      { ...result.timer, runStartedAt: base },
      DEFAULT_SETTINGS,
      base + 3600000,
      true,
    );
    assert.equal(rest.session, null);
    assert.equal(rest.timer.phase, "focus");
    timer = rest.timer;
  }
});
test("cross-midnight focus splits at local midnight and excludes pauses", () => {
  const date = new Date(2026, 8, 9, 23, 50);
  let timer: Timer = {
    ...newTimer(DEFAULT_SETTINGS),
    runStartedAt: +date,
    startedAt: +date,
  };
  timer = pauseTimer(timer, +date + 5 * 60000);
  timer = { ...timer, runStartedAt: +date + 15 * 60000 };
  const session = finishTimer(
    timer,
    DEFAULT_SETTINGS,
    +date + 25 * 60000,
    false,
  ).session!;
  assert.equal(secondsOnDay(session, date), 300);
  assert.equal(secondsOnDay(session, addDays(date, 1)), 600);
  assert.equal(session.duration_seconds, 900);
});
test("weeks start on Monday, including Sunday and year boundaries", () => {
  assert.equal(dateKey(weekStart(new Date(2026, 8, 13))), "2026-09-07");
  assert.equal(dateKey(weekStart(new Date(2027, 0, 1))), "2026-12-28");
});
test("API validation rejects forged durations and overlapping segments", () => {
  const session = finishTimer(
    { ...newTimer(DEFAULT_SETTINGS), runStartedAt: base },
    DEFAULT_SETTINGS,
    base + 60000,
    false,
  ).session!;
  assert.equal(
    sessionSchema.safeParse({ ...session, duration_seconds: 100 }).success,
    false,
  );
  assert.equal(
    sessionSchema.safeParse({
      ...session,
      segments: [...session.segments, ...session.segments],
      duration_seconds: 120,
    }).success,
    false,
  );
  assert.equal(
    sessionSchema.safeParse({ ...session, id: "bad-id" }).success,
    false,
  );
});
test("database timestamps with timezone offsets can be synced to the browser", () => {
  const databaseSession = {
    id: "00000000-0000-4000-8000-000000000000",
    title: "跨裝置專注",
    started_at: "2026-09-10T12:00:00+00:00",
    ended_at: "2026-09-10T12:25:00+00:00",
    duration_seconds: 1500,
    completed: true,
    segments: [
      {
        start: "2026-09-10T12:00:00+00:00",
        end: "2026-09-10T12:25:00+00:00",
      },
    ],
  };
  assert.equal(sessionSchema.safeParse(databaseSession).success, true);
});
test("sub-second focus is not saved and reloading a paused timer preserves elapsed time", () => {
  const timer = { ...newTimer(DEFAULT_SETTINGS), runStartedAt: base };
  assert.equal(
    finishTimer(timer, DEFAULT_SETTINGS, base + 500, false).session,
    null,
  );
  const paused = JSON.parse(JSON.stringify(pauseTimer(timer, base + 10000)));
  assert.equal(elapsed(paused, base + 500000), 10000);
});
