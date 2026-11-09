import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateCode } from "@/lib/license";
import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * POST /api/license/redeem
 * 登录用户提交激活码 → 后端校验 + 写 DB → 返回新 Pro 状态。
 *
 * Request: { "code": "PA2-L-0000000000-EEYKYXNO-XSMMYAAA" }
 * Response:
 *   200 { "ok": true, "profile": { pro_tier, pro_expires_at, ... } }
 *   400 { "ok": false, "error": "激活码无效" }
 *   401 { "ok": false, "error": "未登录" }
 *   409 { "ok": false, "error": "此激活码已被兑换" }
 *   500 { "ok": false, "error": "服务端错误" }
 */
export async function POST(request: NextRequest) {
  const allHeaders: Record<string, string> = {};
  request.headers.forEach((v, k) => { allHeaders[k] = v; });
  console.log("[redeem] ALL headers:", JSON.stringify(allHeaders, null, 2));
  // 0. Supabase 未配置
  const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const svc = getSupabaseServer();
  if (!anonUrl || !anonKey || !svc) {
    return NextResponse.json(
      { ok: false, error: "Supabase 未配置,请先填 .env.local" },
      { status: 500 }
    );
  }

  // 1. 拿 access_token —— 优先 Authorization header (前端 fetch 时带的),
  //    兜底 cookie (如果 Supabase 配置了 cookie 持久化)
  let accessToken: string | null = null;

  // ① Authorization header (前端 fetch 会带 Bearer token)
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    accessToken = authHeader.substring(7).trim();
    console.log("[redeem] auth from Authorization header, len:", accessToken?.length);
  }

  // ② 兜底:cookie 里的 sb-xxx-auth-token
  if (!accessToken) {
    const cookieHeader = request.headers.get("cookie") || "";
    for (const part of cookieHeader.split("; ")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.substring(0, eq).trim();
      const val = part.substring(eq + 1);
      if (name.startsWith("sb-") && name.endsWith("-auth-token")) {
        try {
          const json = JSON.parse(Buffer.from(val.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
          accessToken = json.access_token || null;
          break;
        } catch {}
      }
    }
  }

  console.log("[redeem] token:", accessToken ? "OK (" + accessToken.length + " chars)" : "NULL");
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "未登录,请先用邮箱登录" }, { status: 401 });
  }

  // 2. 用 Authorization Bearer 调 auth.getUser (Supabase v3 SDK 正确方式)
  const userClient = createClient(anonUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser(accessToken);
  if (authErr || !authData?.user) {
    return NextResponse.json(
      { ok: false, error: "未登录,请先用邮箱登录" },
      { status: 401 }
    );
  }
  const userId = authData.user.id;

  // 2. 解析请求体
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }
  const rawCode = typeof body?.code === "string" ? body.code.trim() : "";
  if (!rawCode) {
    return NextResponse.json({ ok: false, error: "请输入激活码" }, { status: 400 });
  }

  // 3. HMAC 签名校验 (同 Godot 客户端密钥)
  const result = validateCode(rawCode, { checkExpired: true });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason ?? "激活码无效" },
      { status: 400 }
    );
  }

  // 4. 查 license_codes 表 —— 是否存在 + 是否已兑换
  const cleanedCode = rawCode.toUpperCase().replace(/-/g, "");
  // 注意:DB 里存的是原始带横线的码,用 stripped 版本查询
  const { data: existing, error: qErr } = await svc
    .from("license_codes")
    .select("code, redeemed_by, redeemed_at, expires_at, tier, type_letter")
    .eq("code", rawCode.toUpperCase())
    .maybeSingle();

  if (qErr) {
    console.error("license_codes query error:", qErr);
    return NextResponse.json({ ok: false, error: "服务端错误" }, { status: 500 });
  }

  // 如果码池里没这条记录,允许用户兑换(离线码场景:客户端直接生成但没录入码池)
  // 此时我们直接把它写进码池
  let tierForProfile: string = result.tier ?? "free";
  let expiresForProfile: number = result.expiresAt ?? 0;

  if (existing) {
    if (existing.redeemed_by) {
      return NextResponse.json(
        { ok: false, error: "此激活码已被兑换过" },
        { status: 409 }
      );
    }
    // 优先用码池里的 tier 信息(与签名解出的一致)
    tierForProfile = existing.tier;
    expiresForProfile = existing.expires_at ?? result.expiresAt;
  } else {
    // 码池里没这条 —— 可能是用户手写生成的,直接登记
    const { error: insErr } = await svc.from("license_codes").insert({
      code: rawCode.toUpperCase(),
      tier: result.tier,
      type_letter: result.type,
      expires_at: result.expiresAt,
      redeemed_by: userId,
      redeemed_at: new Date().toISOString(),
      batch_note: "自动登记(离线生成码)",
    });
    if (insErr) {
      console.error("license_codes auto-insert error:", insErr);
      // 不阻断流程,继续给用户解锁
    }
  }

  // 5. 写 profiles 表 (service_role 绕过 RLS)
  const { data: profile, error: updErr } = await svc
    .from("profiles")
    .update({
      pro_tier: tierForProfile,
      pro_expires_at: expiresForProfile === 0 ? null : new Date(expiresForProfile * 1000).toISOString(),
      license_code: rawCode.toUpperCase(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .single();

  if (updErr) {
    console.error("profiles update error:", updErr);
    return NextResponse.json({ ok: false, error: "服务端错误" }, { status: 500 });
  }

  // 如果码池里存在但未标记已兑换,标记一下
  if (existing) {
    const { error: markErr } = await svc
      .from("license_codes")
      .update({ redeemed_by: userId, redeemed_at: new Date().toISOString() })
      .eq("code", rawCode.toUpperCase());
    if (markErr) console.warn("license_codes mark redeemed error:", markErr);
  }

  return NextResponse.json({ ok: true, profile });
}
