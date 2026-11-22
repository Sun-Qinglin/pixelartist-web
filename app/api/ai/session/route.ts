import { NextResponse, type NextRequest } from "next/server";
import { validateCode } from "@/lib/license";
import { getSupabaseServer } from "@/lib/supabase-server";
import {
  anonSubject,
  isAuthConfigured,
  normalizeCode,
  signToken,
} from "@/lib/ai/auth";
import { bindDevice, peekQuota, storeMode, usingMemoryStore } from "@/lib/ai/quota";
import { MAX_DEVICES_PER_CODE } from "@/lib/ai/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/session
 * 用激活码换一张 12 小时的通行证；没有激活码就发匿名试用凭证。
 *
 * Request: { "activation_code": "PA2-L-...", "device_id": "<指纹>" }
 *   activation_code 可省略 —— 省略时按 device_id 走匿名试用额度。
 *
 * Response:
 *   200 { ok, token, token_expires_at, tier, quota: { limit, used, remaining, period }, anonymous }
 *   400 { ok: false, error }
 *   401 { ok: false, error }   激活码签名无效 / 已过期
 *   403 { ok: false, error }   设备数超限
 *   500 { ok: false, error }   服务端未配置
 */
export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI 服务未配置（缺少 AI_JWT_SECRET）" },
      { status: 500 }
    );
  }

  const svc = getSupabaseServer();
  // memory 模式（本地开发）不需要 Supabase
  if (!svc && !usingMemoryStore()) {
    return NextResponse.json(
      { ok: false, error: "AI 服务未配置（缺少 Supabase 凭据）" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  const payload = (body ?? {}) as { activation_code?: unknown; device_id?: unknown };
  const rawCode = typeof payload.activation_code === "string" ? payload.activation_code.trim() : "";
  const deviceId = typeof payload.device_id === "string" ? payload.device_id.trim() : "";

  if (deviceId.length < 8) {
    return NextResponse.json({ ok: false, error: "缺少设备标识" }, { status: 400 });
  }

  let subject: string;
  let tier: string;
  let anonymous = false;

  if (rawCode) {
    const result = validateCode(rawCode, { checkExpired: true });
    if (!result.ok || !result.tier) {
      return NextResponse.json(
        { ok: false, error: result.reason || "激活码无效" },
        { status: 401 }
      );
    }

    subject = normalizeCode(rawCode);
    tier = result.tier;

    try {
      const bound = await bindDevice(svc, deviceId, subject, MAX_DEVICES_PER_CODE);
      if (!bound.ok) {
        const message =
          bound.reason === "device_bound_elsewhere"
            ? "此设备已绑定到其他激活码"
            : `该激活码已绑定 ${bound.bound} 台设备，超出上限（${MAX_DEVICES_PER_CODE} 台）`;
        return NextResponse.json({ ok: false, error: message }, { status: 403 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "设备绑定失败";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  } else {
    subject = anonSubject(deviceId);
    tier = "anon";
    anonymous = true;
  }

  let quota;
  try {
    quota = await peekQuota(svc, subject, tier);
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取额度失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  let token: string;
  let expiresAt: number;
  try {
    const signed = signToken(subject, tier, deviceId);
    token = signed.token;
    expiresAt = signed.exp;
  } catch (err) {
    const message = err instanceof Error ? err.message : "签发凭证失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    token,
    token_expires_at: expiresAt,
    tier,
    quota,
    anonymous,
    store: storeMode(),
  });
}
