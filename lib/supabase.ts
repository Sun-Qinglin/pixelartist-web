"use client";

import { createClient } from "@supabase/supabase-js";

// 环境变量在部署平台粘贴时容易混入引号、反引号或空白,先清洗再使用。
const clean = (v?: string) => (v ?? "").replace(/[`"'\s]/g, "");

// 同时兼容新版 publishable key 和旧版 anon key
// 优先级:PUBLISHABLE > ANON
function _key() {
  return (
    clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

export function getSupabase() {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = _key();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: true } });
}

export const SUPABASE_CONFIGURED = Boolean(
  clean(process.env.NEXT_PUBLIC_SUPABASE_URL) && _key()
);