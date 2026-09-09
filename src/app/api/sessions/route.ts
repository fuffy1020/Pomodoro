import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sessionSchema } from "@/lib/model";
export const dynamic = "force-dynamic";
async function authorize(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    return {
      error: NextResponse.json({ error: "尚未設定 Supabase" }, { status: 503 }),
    };
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token)
    return { error: NextResponse.json({ error: "請先登入" }, { status: 401 }) };
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    return {
      error: NextResponse.json(
        { error: "登入已過期，請重新登入" },
        { status: 401 },
      ),
    };
  return { db, user: data.user };
}
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.error) return auth.error;
    const raw = request.nextUrl.searchParams.get("offset") ?? "0";
    if (!/^\d+$/.test(raw) || Number(raw) > 1000000)
      return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
    const offset = Number(raw);
    const { data, error } = await auth.db
      .from("focus_sessions")
      .select(
        "id,title,started_at,ended_at,duration_seconds,completed,segments",
      )
      .eq("user_id", auth.user.id)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error)
      return NextResponse.json(
        { error: "無法讀取紀錄，請確認資料表已建立" },
        { status: 502 },
      );
    return NextResponse.json(
      {
        sessions: data,
        nextOffset: data.length === 1000 ? offset + 1000 : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "連線失敗，請稍後重試" },
      { status: 502 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.error) return auth.error;
    const body = await request.text();
    if (body.length > 100000)
      return NextResponse.json({ error: "紀錄過大" }, { status: 413 });
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const result = sessionSchema.safeParse(json);
    if (
      !result.success ||
      (result.success && Date.parse(result.data.ended_at) > Date.now() + 60000)
    )
      return NextResponse.json({ error: "紀錄格式錯誤" }, { status: 400 });
    const { error } = await auth.db
      .from("focus_sessions")
      .upsert(
        { ...result.data, user_id: auth.user.id },
        { onConflict: "user_id,id", ignoreDuplicates: true },
      );
    if (error)
      return NextResponse.json(
        { error: "同步失敗，紀錄仍保留在此裝置" },
        { status: 502 },
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "連線失敗，紀錄仍保留在此裝置" },
      { status: 502 },
    );
  }
}
