"use client";

import { createClient } from "@supabase/supabase-js";

// 同时兼容新版 publishable key 和旧版 anon key
// 优先级:PUBLISHABLE > ANON
function _key() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  );
}

export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = _key();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: true } });
}

export const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && _key()
);