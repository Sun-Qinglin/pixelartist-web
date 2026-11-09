// 服务端专用 Supabase client —— 绕过 RLS 写 profiles / license_codes / subscriptions。
// 绝对别加 NEXT_PUBLIC_ 前缀；绝对别在浏览器代码里 import 本模块。
// 同时兼容新版 secret key 和旧版 service_role key。

import { createClient } from "@supabase/supabase-js";

function _serverKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}
function _publicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  );
}

// 服务端 client (secret / service_role, 绕过 RLS)
export function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = _serverKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// 带用户登录态的 client (从 cookie 里提取 access_token)
export function getSupabaseWithUser(accessToken: string | null | undefined) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pubKey = _publicKey();
  if (!url || !pubKey || !accessToken) return null;
  return createClient(url, pubKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: "Bearer " + accessToken },
    },
  });
}
