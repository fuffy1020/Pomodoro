"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { FocusSession, sessionSchema } from "./model";
const keyFor = (id: string) => `pomodoro:sessions:${id}`;
type Stored = { sessions: FocusSession[]; pending: string[] };
export function readSessions(id: string): Stored {
  const value = localStorage.getItem(keyFor(id));
  if (!value) return { sessions: [], pending: [] };
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.pending))
    throw new Error("儲存的紀錄格式異常");
  return {
    sessions: parsed.sessions.map((s: unknown) => sessionSchema.parse(s)),
    pending: parsed.pending.filter((x: unknown) => typeof x === "string"),
  };
}
export function useSessions(userId: string) {
  const [data, setData] = useState<Stored>({ sessions: [], pending: [] });
  const ref = useRef(data);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);
  const commit = useCallback(
    (next: Stored) => {
      ref.current = next;
      setData(next);
      try {
        localStorage.setItem(keyFor(userId), JSON.stringify(next));
      } catch {
        setError("瀏覽器無法儲存紀錄，請匯出備份並確認儲存空間。");
      }
    },
    [userId],
  );
  useEffect(() => {
    try {
      const saved = readSessions(userId);
      ref.current = saved;
      setData(saved);
    } catch {
      setError("無法讀取此裝置紀錄，請先保留瀏覽器資料。");
    }
    setReady(true);
    const listener = (e: StorageEvent) => {
      if (e.key === keyFor(userId)) {
        try {
          const saved = readSessions(userId);
          ref.current = saved;
          setData(saved);
        } catch {
          setError("無法讀取更新的紀錄");
        }
      }
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [userId]);
  const sync = useCallback(async () => {
    if (!supabase || userId === "local" || busy.current) return;
    busy.current = true;
    setSyncing(true);
    setError("");
    try {
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session || auth.session.user.id !== userId)
        throw new Error("請重新登入以同步紀錄");
      const headers = {
        Authorization: `Bearer ${auth.session.access_token}`,
        "Content-Type": "application/json",
      };
      for (const id of [...ref.current.pending]) {
        const session = ref.current.sessions.find((s) => s.id === id);
        if (!session) continue;
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers,
          body: JSON.stringify(session),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw new Error((await response.json()).error || "同步失敗");
        commit({
          sessions: ref.current.sessions,
          pending: ref.current.pending.filter((p) => p !== id),
        });
      }
      const remote: FocusSession[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const response: Response = await fetch(
          `/api/sessions?offset=${offset}`,
          { headers, cache: "no-store", signal: AbortSignal.timeout(15000) },
        );
        if (!response.ok)
          throw new Error((await response.json()).error || "同步失敗");
        const result: { sessions: unknown[]; nextOffset: number | null } =
          await response.json();
        remote.push(
          ...result.sessions.map((s: unknown) => sessionSchema.parse(s)),
        );
        offset = result.nextOffset;
      }
      const merged = new Map(ref.current.sessions.map((s) => [s.id, s]));
      remote.forEach((s) => merged.set(s.id, s));
      commit({ ...ref.current, sessions: [...merged.values()] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失敗，紀錄仍保留在此裝置");
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [commit, userId]);
  useEffect(() => {
    if (!ready) return;
    void sync();
    const interval = setInterval(() => void sync(), 60000);
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, [ready, sync]);
  const add = useCallback(
    (session: FocusSession) => {
      // Re-read before merging so another tab's newly saved session is retained.
      let current = ref.current;
      try {
        const disk = readSessions(userId);
        const merged = new Map(
          [...current.sessions, ...disk.sessions].map((s) => [s.id, s]),
        );
        current = {
          sessions: [...merged.values()],
          pending: [...new Set([...current.pending, ...disk.pending])],
        };
      } catch {
        /* keep the in-memory copy */
      }
      if (current.sessions.some((s) => s.id === session.id)) return;
      commit({
        sessions: [...current.sessions, session],
        pending: userId === "local" ? [] : [...current.pending, session.id],
      });
      void sync();
    },
    [commit, sync, userId],
  );
  const importLocal = () => {
    try {
      readSessions("local").sessions.forEach(add);
      void sync();
    } catch {
      setError("無法匯入本機紀錄");
    }
  };
  return {
    sessions: data.sessions,
    pending: data.pending.length,
    ready,
    error,
    syncing,
    sync,
    add,
    importLocal,
  };
}
