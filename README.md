# 專注之間 · Pomodoro

繁體中文番茄鐘，使用 Next.js App Router、React、TypeScript、Supabase Auth / PostgreSQL。可直接部署至 Vercel；尚未設定 Supabase 時可使用本機模式。這份專案沒有建立雲端資源，也沒有發布網站。

## 本機啟動

需要 Node.js 22 或更新版本（Vercel 建議選擇 22.x 或 24.x）。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

打開 http://127.0.0.1:3000 。專案已提供空白 `.env.local`，不含真實金鑰。兩個環境變數留空即使用本機模式。

## 已完成的功能

- `/` 只顯示番茄鐘與設定；從右上角進入 `/history` 查看統計與紀錄。共用版面保留計時狀態，切換頁面不會中斷計時。

- 預設專注 25 分鐘、短休息 5 分鐘，每完成 4 次專注進入 15 分鐘長休息。
- 可調整時長與長休息間隔、開始／暫停／繼續、重設、提早結束並記錄、跳過休息、切換階段、提示音與空白鍵操作。
- 自動切換下一階段，手動開始下一段，防止無人在場時累計專注。
- 依時間戳計時，重新整理、背景分頁、電腦休眠後會恢復並結算一段；不補算未開始的後續循環。
- 每日／每週時數、每週番茄數、前後週查詢、點選圖表查看當日紀錄、全部紀錄 CSV 匯出。
- 暫停與休息不計入專注；跨午夜的時段依活躍區間拆分。統計依目前裝置時區、週一至週日；更換裝置時區會重新分配日界。
- 本機持久化；設定 Supabase 後支援 Email Magic Link 登入、跨裝置同步、本機紀錄手動匯入、離線待同步佇列（重新連線或每 60 秒重試）。
- 同一帳號在同一瀏覽器以 Web Locks 避免多個分頁重複管理計時；跨裝置可各自啟動時段。計時器與偏好設定保留在裝置，完成紀錄才同步雲端。

## 接上 Supabase

1. 建立 Supabase 專案。
2. 在 SQL Editor 執行 `supabase/migrations/001_focus_sessions.sql`。此檔為一次性 migration；也可用 Supabase CLI migration 工作流程套用。
3. 在 Supabase 專案設定複製 Project URL 與 **publishable key**（亦接受舊版 anon key）。將值填入 `.env.local`：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_with_your_key
```

4. 在 Authentication → Providers 啟用 Email。Authentication → URL Configuration 的 Site URL 設為目前網站網址；Redirect URLs 加入 `http://127.0.0.1:3000`，若使用 localhost 則也加入 `http://localhost:3000`。部署後加入 Vercel 正式網址；預覽部署若需要登入也必須加入對應網址。
5. 重新執行 `npm run dev`。開啟「專注紀錄」，點右上角雲端圖示，輸入 Email，從信箱開啟登入連結。使用同一個瀏覽器完成登入。正式環境依需求設定 Supabase 自訂 SMTP，以符合其寄信額度與限制。
6. 登入後，若要上傳之前本機模式的紀錄，點「匯入本機紀錄」。同一帳號重複匯入會依 UUID 去重；不會自動把本機紀錄分享給其他登入帳號。

**不需要 service_role 或 secret key。** `NEXT_PUBLIC_` 變數會提供給瀏覽器，只能放公開的 publishable/anon key。資料表啟用 RLS，每個使用者只能讀取／插入自己的紀錄，API 會驗證 JWT 並使用該使用者身分查詢。

參考官方文件：[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)、[Email 登入](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 部署到 Vercel

1. 將專案推送至自己的 Git 儲存庫（不要提交 `.env.local`），在 Vercel 匯入專案。
2. Framework Preset 選 Next.js，使用預設根目錄、`npm run build` 和自動產物設定，不需要額外 `vercel.json`。
3. 將上面兩個環境變數加到 Vercel 的 Production／需要的 Preview 環境，再部署。若留空則是本機模式。
4. 回 Supabase 將正式網域加入 Site URL / Redirect URLs。修改 `NEXT_PUBLIC_` 環境變數後需要重新部署。
5. 用正式網址登入，完成一段專注，再於另一個瀏覽器登入同帳號確認紀錄。

參考：[Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)。

## API 與資料

- `GET /api/sessions?offset=0`：需 Bearer access token，取得自己的紀錄，每頁最多 1000 筆，回傳 `nextOffset`。
- `POST /api/sessions`：需 Bearer access token，驗證時段格式後以 `(user_id, id)` 去重寫入。欄位：`id`、`title`、`started_at`、`ended_at`、`duration_seconds`、`completed`、`segments: [{start, end}]`。`user_id` 從已驗證 JWT 取得，不信任用戶傳入值。
- 未設定環境時 API 回 503，缺少／失效登入回 401，格式錯誤回 400，同步錯誤回 502 並保留本機佇列。
- 前端同步佇列、本機計時器按帳號分開儲存；沒有登入不會呼叫資料 API。
- 雲端表格為專注紀錄來源；本機仍保留快取與尚未上傳的紀錄。登出不會刪除裝置上既有快取。

## 驗證

```bash
npm test
npm run typecheck
npm run build
```

自動測試涵蓋暫停／繼續、提早結束、背景到期、長休息循環、跨午夜與週界、紀錄格式驗證。尚未提供真實 Supabase 專案，所以 Auth、RLS 與雲端往返須在接好後驗收。

建議接線後確認：A 帳號紀錄不可被 B 讀取；同一 UUID 重送不重複；斷網完成一段後恢復網路能同步；登出／登入不混入其他帳號資料。

## 使用限制

本機模式依賴瀏覽器 localStorage，清除網站資料會失去本機紀錄；建議定期匯出。瀏覽器關閉或被系統凍結時無法保證即時音效，重新打開會恢復計時與結算。儲存失敗會顯示提示，請匯出備份。CSV 是查閱備份格式，目前不提供 CSV 匯入。專注事項與個人紀錄不包含示範假資料。

瀏覽器若支援 WebMCP，會額外註冊讀取計時狀態、開始與暫停專注工具。一般瀏覽器仍可正常操作；此環境未驗證 WebMCP 瀏覽器合約。
