"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Coffee,
  Focus,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SkipForward,
  Timer as TimerIcon,
  Volume2,
  VolumeX,
  X,
  Cloud,
  LoaderCircle,
} from "lucide-react";
import {
  addDays,
  dateKey,
  DEFAULT_SETTINGS,
  elapsed,
  finishTimer,
  formatDuration,
  newTimer,
  pauseTimer,
  Phase,
  secondsOnDay,
  Settings,
  Timer,
  weekStart,
} from "@/lib/model";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { useSessions } from "@/lib/use-sessions";
import { useWebMcp } from "@/lib/use-webmcp";

const labels: Record<Phase, string> = {
  focus: "專注",
  short: "短休息",
  long: "長休息",
};
const weekDays = ["一", "二", "三", "四", "五", "六", "日"];
function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-content">
        <div className="modal-heading">
          <h2 id="dialog-title">{title}</h2>
          <IconButton label="關閉" onClick={close}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function Pomodoro() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!cloudEnabled);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        setUser(data.session?.user ?? null);
        setAuthReady(true);
      })
      .catch(() => setAuthReady(true));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (!authReady)
    return (
      <div className="loading">
        <LoaderCircle className="spin" /> 正在讀取專注空間…
      </div>
    );
  return <Workspace key={user?.id ?? "local"} user={user} />;
}
function Workspace({ user }: { user: User | null }) {
  const scope = user?.id ?? "local";
  const records = useSessions(scope);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [timer, setTimer] = useState<Timer | null>(null);
  const timerRef = useRef<Timer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [owner, setOwner] = useState(false);
  const view = usePathname() === "/history" ? "history" : "timer";
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [modal, setModal] = useState<"settings" | "account" | "help" | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [sending, setSending] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const saveTimer = useCallback(
    (value: Timer) => {
      timerRef.current = value;
      setTimer(value);
      try {
        localStorage.setItem(`pomodoro:timer:${scope}`, JSON.stringify(value));
      } catch {
        setNotice("無法儲存計時狀態，重新整理後可能遺失進度。");
      }
    },
    [scope],
  );
  useEffect(() => {
    let loadedSettings = DEFAULT_SETTINGS;
    try {
      const s = JSON.parse(localStorage.getItem("pomodoro:settings") || "null");
      if (
        s &&
        ["focus", "short", "long"].every(
          (k) => Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= 180,
        ) &&
        Number.isInteger(s.cycles) &&
        s.cycles >= 2 &&
        s.cycles <= 8 &&
        typeof s.sound === "boolean"
      )
        loadedSettings = s;
    } catch {
      /* defaults */
    }
    settingsRef.current = loadedSettings;
    setSettings(loadedSettings);
    const load = () => {
      let restored: Timer | null = null;
      try {
        const raw = JSON.parse(
          localStorage.getItem(`pomodoro:timer:${scope}`) || "null",
        );
        if (
          raw &&
          ["focus", "short", "long"].includes(raw.phase) &&
          Number.isFinite(raw.totalMs) &&
          raw.totalMs > 0 &&
          raw.totalMs <= 10800000 &&
          Array.isArray(raw.segments) &&
          raw.segments.every(
            (s: { start: string; end: string }) =>
              Number.isFinite(Date.parse(s.start)) &&
              Date.parse(s.end) >= Date.parse(s.start),
          ) &&
          (raw.runStartedAt === null || Number.isFinite(raw.runStartedAt)) &&
          typeof raw.id === "string" &&
          typeof raw.title === "string" &&
          Number.isInteger(raw.completedCount)
        )
          restored = raw;
      } catch {
        /* defaults */
      }
      const value = restored ?? newTimer(loadedSettings);
      timerRef.current = value;
      setTimer(value);
    };
    load();
    let release: (() => void) | undefined;
    let cancelled = false;
    if (navigator.locks)
      void navigator.locks.request(`pomodoro:timer-lock:${scope}`, async () => {
        if (cancelled) return;
        load();
        setOwner(true);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
    else
      setNotice(
        "此瀏覽器不支援安全計時，請使用新版 Chrome、Safari 或 Firefox。",
      );
    const listener = (event: StorageEvent) => {
      if (event.key === `pomodoro:timer:${scope}`) load();
    };
    window.addEventListener("storage", listener);
    return () => {
      cancelled = true;
      release?.();
      window.removeEventListener("storage", listener);
    };
  }, [scope]);
  const ring = useCallback(() => {
    if (!settingsRef.current.sound || !audioRef.current) return;
    const context = audioRef.current;
    if (context.state !== "running") return;
    [0, 0.22, 0.44].forEach((delay, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.value = [660, 880, 990][i];
      gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(
        0.13,
        context.currentTime + delay + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + delay + 0.3,
      );
      oscillator.start(context.currentTime + delay);
      oscillator.stop(context.currentTime + delay + 0.31);
    });
  }, []);
  const finish = useCallback(
    (complete: boolean) => {
      const current = timerRef.current;
      if (!current) return;
      const result = finishTimer(
        current,
        settingsRef.current,
        Date.now(),
        complete,
      );
      if (result.session) records.add(result.session);
      saveTimer(result.timer);
      setNotice(
        current.phase === "focus"
          ? `已儲存 ${formatDuration(result.session?.duration_seconds ?? 0)}專注`
          : "休息結束",
      );
      if (complete) ring();
    },
    [records.add, ring, saveTimer],
  );
  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      setNow(time);
      const current = timerRef.current;
      if (
        owner &&
        records.ready &&
        current?.runStartedAt !== null &&
        current &&
        elapsed(current, time) >= current.totalMs
      )
        finish(true);
    };
    tick();
    const interval = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [owner, records.ready, finish]);
  const remaining = timer
    ? Math.max(0, Math.ceil((timer.totalMs - elapsed(timer, now)) / 1000))
    : settings.focus * 60;
  const timeLabel = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  useEffect(() => {
    document.title = timer?.runStartedAt
      ? `${timeLabel} · ${labels[timer.phase]} | 專注之間`
      : "專注之間 · Pomodoro";
  }, [timeLabel, timer?.phase, timer?.runStartedAt]);
  const toggleTimer = useCallback(() => {
    const current = timerRef.current;
    if (!current || !owner) return;
    if (current.runStartedAt !== null)
      saveTimer(pauseTimer(current, Date.now()));
    else {
      try {
        audioRef.current ??= new AudioContext();
        void audioRef.current.resume();
      } catch {
        /* sound unavailable */
      }
      saveTimer({
        ...current,
        runStartedAt: Date.now(),
        startedAt: current.startedAt ?? Date.now(),
      });
    }
    setNotice("");
  }, [owner, saveTimer]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        view === "timer" &&
        !modal &&
        !["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        toggleTimer();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal, toggleTimer, view]);
  const changePhase = (phase: Phase) => {
    if (!timer || !owner || phase === timer.phase) return;
    if (
      elapsed(timer, now) > 0 &&
      !confirm("切換階段會放棄目前未儲存的時間。要繼續嗎？")
    )
      return;
    saveTimer(newTimer(settings, phase, timer.completedCount));
    setNotice("");
  };
  const today = new Date(now);
  const start = addDays(weekStart(today), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const daily = days.map((day) =>
    records.sessions.reduce((n, s) => n + secondsOnDay(s, day), 0),
  );
  const total = daily.reduce((a, b) => a + b, 0);
  const todayTotal = records.sessions.reduce(
    (n, s) => n + secondsOnDay(s, today),
    0,
  );
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = addDays(todayStart, 1);
  const millisecondsToday = (startAt: number, endAt: number) =>
    Math.max(
      0,
      Math.min(endAt, +tomorrowStart) - Math.max(startAt, +todayStart),
    );
  let currentFocusToday = 0;
  if (timer?.phase === "focus") {
    const recordedMs = timer.segments.reduce(
      (sum, segment) =>
        sum +
        millisecondsToday(Date.parse(segment.start), Date.parse(segment.end)),
      0,
    );
    const previousMs = timer.segments.reduce(
      (sum, segment) =>
        sum + Date.parse(segment.end) - Date.parse(segment.start),
      0,
    );
    const runningMs =
      timer.runStartedAt === null
        ? 0
        : millisecondsToday(
            timer.runStartedAt,
            Math.min(now, timer.runStartedAt + timer.totalMs - previousMs),
          );
    currentFocusToday = (recordedMs + runningMs) / 1000;
  }
  const displayedTodayTotal = todayTotal + currentFocusToday;
  const weekSessions = records.sessions.filter((s) =>
    days.some((d) => secondsOnDay(s, d) > 0),
  );
  const completed = weekSessions.filter(
    (s) =>
      s.completed &&
      dateKey(new Date(s.ended_at)) >= dateKey(start) &&
      dateKey(new Date(s.ended_at)) < dateKey(addDays(start, 7)),
  ).length;
  const visibleSessions = weekSessions
    .filter(
      (s) =>
        !selectedDay ||
        secondsOnDay(s, new Date(selectedDay + "T00:00:00")) > 0,
    )
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const max = Math.max(3600, ...daily);
  const progress = timer ? elapsed(timer, now) / timer.totalMs : 0;
  const phase = timer?.phase ?? "focus";
  const count = timer?.completedCount ?? 0;
  const updateSettings = (next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    try {
      localStorage.setItem("pomodoro:settings", JSON.stringify(next));
    } catch {
      setNotice("無法儲存設定");
    }
    if (owner && timer && elapsed(timer, now) === 0)
      saveTimer({ ...timer, totalMs: next[timer.phase] * 60000 });
  };
  const moveWeek = (delta: number) => {
    setWeekOffset((n) => n + delta);
    setSelectedDay(null);
  };
  useWebMcp({
    read: () => ({
      phase: timerRef.current?.phase,
      running: timerRef.current?.runStartedAt !== null,
      remainingSeconds: timerRef.current
        ? Math.ceil(
            (timerRef.current.totalMs - elapsed(timerRef.current, Date.now())) /
              1000,
          )
        : null,
      weekFocusSeconds: Math.floor(total),
    }),
    start: () => {
      const current = timerRef.current;
      if (!owner || !records.ready || !current || current.phase !== "focus")
        throw new Error("Focus timer is unavailable");
      if (current.runStartedAt === null) toggleTimer();
    },
    pause: () => {
      const current = timerRef.current;
      if (!owner || !current || current.phase !== "focus")
        throw new Error("Focus timer is unavailable");
      if (current.runStartedAt !== null) toggleTimer();
    },
  });
  const exportCsv = () => {
    const rows = [
      ["日期", "專注事項", "開始時間", "結束時間", "專注秒數", "完整完成"],
      ...records.sessions.map((s) => [
        dateKey(new Date(s.started_at)),
        s.title,
        s.started_at,
        s.ended_at,
        s.duration_seconds,
        s.completed ? "是" : "否",
      ]),
    ];
    const csv =
      "\uFEFF" +
      rows
        .map((r) =>
          r
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/^[=+@\-\t\r]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `專注紀錄-${dateKey(today)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={`app-shell ${view}-page`}>
      <header className="app-header">
        <Link className="compact-brand" href="/" aria-label="番茄鐘首頁">
          <TimerIcon size={23} strokeWidth={1.8} />
          <span>專注之間</span>
        </Link>
        <nav className="header-actions" aria-label="頁面導覽">
          <Link
            className="page-link"
            href={view === "timer" ? "/history" : "/"}
          >
            {view === "timer" ? (
              <BarChart3 size={18} />
            ) : (
              <TimerIcon size={18} />
            )}
            {view === "timer" ? "專注紀錄" : "返回番茄鐘"}
          </Link>
          {view === "history" && (
            <>
              <IconButton label="設定" onClick={() => setModal("settings")}>
                <Settings2 size={19} />
              </IconButton>
              <IconButton
                label={user ? "帳號與同步" : "登入與同步"}
                onClick={() => setModal("account")}
              >
                <Cloud size={19} />
              </IconButton>
            </>
          )}
        </nav>
      </header>
      <main className={view === "timer" ? "focus-main" : "history-main"}>
        <h1 className={view === "timer" ? "sr-only" : "history-title"}>
          {view === "timer" ? "番茄鐘" : "專注紀錄"}
        </h1>
        {view === "timer" && (
          <section
            className={`timer-card ${phase !== "focus" ? "break-mode" : ""}`}
            aria-label="番茄鐘"
          >
            <div className="timer-top">
              <IconButton
                label={`提示音${settings.sound ? "開啟" : "關閉"}`}
                aria-pressed={settings.sound}
                onClick={() =>
                  updateSettings({ ...settings, sound: !settings.sound })
                }
              >
                {settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </IconButton>
              <IconButton label="計時設定" onClick={() => setModal("settings")}>
                <Settings2 size={19} />
              </IconButton>
            </div>
            <div className="phase-tabs" role="group" aria-label="計時階段">
              {(["focus", "short", "long"] as Phase[]).map((p) => (
                <button
                  key={p}
                  aria-pressed={phase === p}
                  className={phase === p ? "selected" : ""}
                  disabled={!owner}
                  onClick={() => changePhase(p)}
                >
                  {p === "focus" ? <Focus size={16} /> : <Coffee size={16} />}
                  {labels[p]}
                </button>
              ))}
            </div>
            <div className="clock-layout">
              <div className="clock-ring">
                <svg viewBox="0 0 320 320" aria-hidden="true">
                  <circle className="ring-base" cx="160" cy="160" r="151" />
                  <circle
                    className="ring-progress"
                    cx="160"
                    cy="160"
                    r="151"
                    strokeDasharray={948.76}
                    strokeDashoffset={948.76 * progress}
                  />
                </svg>
                <div className="clock-face">
                  <div
                    className="clock-digits"
                    role="timer"
                    aria-label={`剩餘 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`}
                  >
                    {timeLabel}
                  </div>
                  {phase === "focus" && (
                    <span className="round-label">
                      {(count % settings.cycles) + 1} / {settings.cycles}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {phase === "focus" && (
              <label className="task-input">
                <span className="task-mark">↳</span>
                <input
                  aria-label="這次要專注的事情"
                  maxLength={120}
                  disabled={!owner || phase !== "focus"}
                  value={timer?.title ?? ""}
                  placeholder="專注事項（選填）"
                  onChange={(e) =>
                    timer && saveTimer({ ...timer, title: e.target.value })
                  }
                />
              </label>
            )}
            <div className="timer-controls">
              <IconButton
                label="重設計時（不儲存）"
                disabled={!owner}
                onClick={() => {
                  if (
                    timer &&
                    (elapsed(timer, now) === 0 ||
                      confirm("重設會放棄這次尚未儲存的專注時間，確定重設？"))
                  )
                    saveTimer(newTimer(settings, phase, count));
                }}
              >
                <RotateCcw size={21} />
              </IconButton>
              <button
                className="start-button"
                title="空白鍵：開始／暫停"
                disabled={!owner || !records.ready}
                onClick={toggleTimer}
              >
                {timer?.runStartedAt ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
                {timer?.runStartedAt
                  ? "暫停"
                  : timer && elapsed(timer, now) > 0
                    ? "繼續" + labels[phase]
                    : "開始" + labels[phase]}
              </button>
              <IconButton
                label={phase === "focus" ? "提早結束並儲存專注" : "跳過休息"}
                disabled={!owner}
                onClick={() => {
                  if (
                    phase !== "focus" ||
                    confirm("結束這次專注並儲存已專注的時間？")
                  )
                    finish(false);
                }}
              >
                <SkipForward size={21} />
              </IconButton>
            </div>
            <div className="timer-bottom">
              <div
                className="cycle-dots"
                aria-label={`已完成 ${count % settings.cycles} 次，本輪共 ${settings.cycles} 次`}
              >
                {Array.from({ length: settings.cycles }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < count % settings.cycles ||
                      (phase === "long" &&
                        count > 0 &&
                        count % settings.cycles === 0)
                        ? "filled"
                        : ""
                    }
                  >
                    {i < count % settings.cycles ? <Check size={11} /> : null}
                  </span>
                ))}
              </div>
              <div
                className="timer-total"
                aria-label={`今日加總 ${formatDuration(displayedTodayTotal)}`}
              >
                <span>今日加總</span>
                <strong>{formatDuration(displayedTodayTotal)}</strong>
              </div>
            </div>
          </section>
        )}
        <div
          role="status"
          aria-live="polite"
          className={
            notice || records.error || (!owner && timer) ? "notice" : "sr-only"
          }
        >
          {records.error ||
            notice ||
            (!owner && timer
              ? "另一個分頁正在管理計時；關閉該分頁後即可在這裡操作。"
              : "")}
        </div>
        {view === "history" && (
          <section className="stats-section" aria-label="專注統計">
            <div className="section-heading">
              <div>
                <h2>每週統計</h2>
              </div>
              <div className="week-nav">
                <IconButton label="上一週" onClick={() => moveWeek(-1)}>
                  <ChevronLeft size={18} />
                </IconButton>
                <button
                  className="week-label"
                  onClick={() => {
                    setWeekOffset(0);
                    setSelectedDay(null);
                  }}
                  title="回到本週"
                >
                  {weekOffset === 0
                    ? "本週"
                    : `${start.getMonth() + 1}/${start.getDate()} — ${days[6].getMonth() + 1}/${days[6].getDate()}`}
                </button>
                <IconButton
                  label="下一週"
                  disabled={weekOffset >= 0}
                  onClick={() => moveWeek(1)}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat-card">
                <span>
                  <TimerIcon size={17} />
                  {weekOffset === 0 ? "今日專注" : "每日平均"}
                </span>
                <strong>
                  {formatDuration(weekOffset === 0 ? todayTotal : total / 7)}
                </strong>
              </div>
              <div className="stat-card">
                <span>
                  <BarChart3 size={17} />
                  {weekOffset === 0 ? "本週" : "這週"}專注
                </span>
                <strong>{formatDuration(total)}</strong>
              </div>
              <div className="stat-card">
                <span>
                  <Check size={17} />
                  完成番茄
                </span>
                <strong>
                  {completed}
                  <em>顆</em>
                </strong>
              </div>
            </div>
            <div className="chart-card">
              <div className="chart-heading">
                <h3>每日專注時長</h3>
                <span className="chart-legend">
                  <i />
                  專注時間
                </span>
              </div>
              <div className="chart-area">
                <div className="chart-axis">
                  <span>{Math.ceil(max / 3600)} 小時</span>
                  <span>{Math.ceil(max / 3600) * 30} 分鐘</span>
                  <span>0</span>
                </div>
                <div className="chart-grid">
                  <div className="grid-line top" />
                  <div className="grid-line middle" />
                  <div className="grid-line bottom" />
                  {days.map((d, i) => (
                    <button
                      key={i}
                      className={`day-column ${dateKey(d) === dateKey(today) ? "today" : ""} ${selectedDay === dateKey(d) ? "chosen" : ""}`}
                      aria-label={`${d.toLocaleDateString("zh-TW")} ${formatDuration(daily[i])}，查看紀錄`}
                      aria-pressed={selectedDay === dateKey(d)}
                      onClick={() => {
                        setSelectedDay(
                          selectedDay === dateKey(d) ? null : dateKey(d),
                        );
                      }}
                    >
                      <div className="bar-space">
                        <span className="bar-tooltip">
                          {formatDuration(daily[i])}
                        </span>
                        <div
                          className={`bar ${daily[i] === 0 ? "empty" : ""}`}
                          style={{
                            height:
                              daily[i] > 0
                                ? `${Math.max(2, (daily[i] / (Math.ceil(max / 3600) * 3600)) * 100)}%`
                                : "3px",
                          }}
                        />
                      </div>
                      <span className="day-name">週{weekDays[i]}</span>
                      <span className="day-date">
                        {d.getMonth() + 1}/{d.getDate()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
        {view === "history" && (
          <section className="history-card">
            <div className="section-heading">
              <div>
                <h2>
                  {selectedDay ? `${selectedDay} 的紀錄` : "這週的專注紀錄"}
                </h2>
                <span>{visibleSessions.length} 個專注時段</span>
              </div>
              <div className="history-actions">
                {selectedDay && (
                  <button onClick={() => setSelectedDay(null)}>顯示整週</button>
                )}
                <button disabled={!records.sessions.length} onClick={exportCsv}>
                  <ArrowDownToLine size={16} />
                  匯出全部 CSV
                </button>
              </div>
            </div>
            {visibleSessions.length ? (
              <div className="session-list">
                {visibleSessions.map((s) => (
                  <div className="session-row" key={s.id}>
                    <div className="session-icon">
                      <Focus size={19} />
                    </div>
                    <div className="session-info">
                      <strong>{s.title}</strong>
                      <span>
                        {new Date(s.started_at).toLocaleDateString("zh-TW", {
                          month: "numeric",
                          day: "numeric",
                        })}{" "}
                        ·{" "}
                        {new Date(s.started_at).toLocaleTimeString("zh-TW", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}{" "}
                        —{" "}
                        {new Date(s.ended_at).toLocaleTimeString("zh-TW", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    </div>
                    <span
                      className={`session-badge ${s.completed ? "" : "partial"}`}
                    >
                      {s.completed ? "已完成" : "提早結束"}
                    </span>
                    <strong className="session-duration">
                      {formatDuration(
                        selectedDay
                          ? secondsOnDay(s, new Date(selectedDay + "T00:00:00"))
                          : days.reduce((n, d) => n + secondsOnDay(s, d), 0),
                      )}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>這段時間還沒有專注紀錄。</p>
                <Link className="page-link" href="/">
                  開始專注 <ArrowRight size={16} />
                </Link>
              </div>
            )}
          </section>
        )}
        {view === "history" && (
          <footer className="page-footer">
            <button onClick={() => setModal("help")}>
              <CircleHelp size={15} />
              關於專注紀錄
            </button>
          </footer>
        )}
      </main>
      {modal === "settings" && (
        <Modal title="計時設定" close={() => setModal(null)}>
          <p className="modal-description">
            調整每段時間。進行中的計時會保留原本長度，下一段套用新設定。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              updateSettings({
                focus: Number(fd.get("focus")),
                short: Number(fd.get("short")),
                long: Number(fd.get("long")),
                cycles: Number(fd.get("cycles")),
                sound: settings.sound,
              });
              setModal(null);
            }}
          >
            <div className="settings-grid">
              {(["focus", "short", "long"] as Phase[]).map((p) => (
                <label key={p}>
                  {labels[p]}（分鐘）
                  <input
                    name={p}
                    type="number"
                    min={1}
                    max={180}
                    required
                    defaultValue={settings[p]}
                  />
                </label>
              ))}
              <label>
                長休息間隔（次）
                <input
                  name="cycles"
                  type="number"
                  min={2}
                  max={8}
                  required
                  defaultValue={settings.cycles}
                />
              </label>
            </div>
            <button className="primary full" type="submit">
              儲存設定
            </button>
          </form>
        </Modal>
      )}
      {modal === "account" && (
        <Modal
          title={user ? "雲端紀錄" : "登入與同步"}
          close={() => setModal(null)}
        >
          {!cloudEnabled ? (
            <>
              <div className="account-icon">
                <Cloud size={28} />
              </div>
              <p>
                目前使用本機模式，所有紀錄都儲存在這個瀏覽器，重新整理後仍會保留。
              </p>
              <p className="modal-description">
                雲端功能尚未啟用。完成 Supabase 設定後，就能透過 Email
                登入並跨裝置同步。
              </p>
              <button className="primary full" onClick={() => setModal(null)}>
                繼續專注
              </button>
            </>
          ) : user ? (
            <>
              <p className="email-display">{user.email}</p>
              <p className="modal-description">
                {records.pending
                  ? `${records.pending} 筆紀錄等待上傳`
                  : "此帳號的紀錄會自動同步。"}{" "}
                本機模式的舊紀錄可手動匯入此帳號。
              </p>
              <div className="account-actions">
                <button
                  className="primary"
                  onClick={() => void records.sync()}
                  disabled={records.syncing}
                >
                  {records.syncing ? "同步中…" : "立即同步"}
                </button>
                <button
                  onClick={() => {
                    records.importLocal();
                    setAuthMessage(
                      "已加入匯入佇列；同步完成後可在此帳號查看。",
                    );
                  }}
                >
                  匯入本機紀錄
                </button>
                <button
                  onClick={async () => {
                    if (timer?.runStartedAt)
                      saveTimer(pauseTimer(timer, Date.now()));
                    const result = await supabase?.auth.signOut();
                    if (result?.error) setAuthMessage(result.error.message);
                    else setModal(null);
                  }}
                >
                  <LogOut size={16} />
                  登出
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSending(true);
                setAuthMessage("");
                try {
                  const result = await supabase!.auth.signInWithOtp({
                    email,
                    options: { emailRedirectTo: window.location.origin },
                  });
                  setAuthMessage(
                    result.error
                      ? result.error.message
                      : "登入連結已寄出，請至信箱點擊連結。",
                  );
                } catch {
                  setAuthMessage("寄送失敗，請確認網路後再試。");
                } finally {
                  setSending(false);
                }
              }}
            >
              <p className="modal-description">
                用 Email 接收登入連結，登入後即可同步你的專注紀錄。
              </p>
              <label className="email-field">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <button className="primary full" disabled={sending}>
                {sending ? "寄送中…" : "寄送登入連結"}
              </button>
            </form>
          )}
          {authMessage && (
            <p role="status" className="auth-message">
              {authMessage}
            </p>
          )}
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="每一段專注，如何被記錄？" close={() => setModal(null)}>
          <div className="help-copy">
            <p>
              完成番茄鐘，或按右側「提早結束」時，會儲存實際專注時間。暫停與休息不會計入統計，重設則放棄尚未儲存的時段。
            </p>
            <p>
              每週從星期一開始，以這台裝置的時區（
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
              ）顯示。跨午夜的專注時間會分配到對應日期；未滿 1
              分鐘的專注以秒顯示。
            </p>
            <p>
              切換分頁、重新整理後，計時仍依原定時間結束。每段結束後需手動開始下一段，不會在你離開後自動累計新的專注。
            </p>
            <p>
              本機紀錄僅保留在目前瀏覽器；清除網站資料會刪除它們。你可以在「專注紀錄」匯出
              CSV 備份。提示音需保持瀏覽器開啟且允許播放音效。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
