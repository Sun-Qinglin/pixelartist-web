import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * GET /api/me
 * 返回当前登录用户 + profile + 活跃订阅。
 *
 * Response:
 *   200 { "ok": true, "user": {...}, "profile": {...}, "subscription": {...} | null }
 *   401 { "ok": false, "error": "未登录" }
 *   500 { "ok": false, "error": "Supabase 未配置" }
 */
export async function GET(request: NextRequest) {
  const allHeaders: Record<string, string> = {};
  request.headers.forEach((v, k) => { allHeaders[k] = v; });
  console.log("[me] ALL headers:", JSON.stringify(allHeaders, null, 2));
  const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const svc = getSupabaseServer();
  if (!anonUrl || !anonKey || !svc) {
    return NextResponse.json(
      { ok: false, error: "Supabase 未配置,请先填 .env.local" },
      { status: 500 }
    );
  }

  // 读 cookie 拿登录态
  const allCookies = request.headers.get("cookie") ?? "";
  const userClient = createClient(anonUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Cookie: allCookies } },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) {
    return NextResponse.json(
      { ok: false, error: "未登录" },
      { status: 401 }
    );
  }
  const user = authData.user;

  // 查 profile (service_role 绕过 RLS)
  const { data: profile, error: pErr } = await svc
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // 查活跃订阅
  const { data: subs, error: sErr } = await svc
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  const subscription = subs?.[0] ?? null;

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    profile,
    subscription,
  });
}
