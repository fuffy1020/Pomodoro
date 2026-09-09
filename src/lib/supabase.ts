import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const cloudEnabled =
  /^https:\/\/.+/.test(url) &&
  key.length > 20 &&
  !url.includes("your-project") &&
  !key.includes("replace_with");
export const supabase = cloudEnabled ? createClient(url, key) : null;
