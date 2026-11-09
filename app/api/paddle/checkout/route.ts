import { NextResponse, type NextRequest } from "next/server";
import { createPaddleCheckout, PADDLE_CONFIGURED, PADDLE_PLANS, type PlanKey } from "@/lib/paddle";

export const runtime = "nodejs";

/**
 * POST /api/paddle/checkout
 * 入参: { plan: "yearly" | "monthly" | "lifetime" | "student" }
 * 出参: { ok: true, url } —— 前端直接跳过去
 */
export async function POST(request: NextRequest) {
  if (!PADDLE_CONFIGURED) {
    return NextResponse.json(
      { ok: false, error: "支付未配置" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const plan = String(body.plan || "") as PlanKey;
  if (!PADDLE_PLANS[plan]) {
    return NextResponse.json({ ok: false, error: "未知套餐" }, { status: 400 });
  }

  // 可选:用登录态把订单直接绑到账号上,付完自动解锁
  const authHeader =
    request.headers.get("authorization") || request.headers.get("Authorization") || "";
  let userId: string | undefined;
  let email: string | undefined;
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonUrl && anonKey) {
      try {
        const r = await fetch(`${anonUrl}/auth/v1/user`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (r.ok) {
          const u: any = await r.json();
          userId = u?.id;
          email = u?.email;
        }
      } catch {
        // 校验失败就当作游客购买,不阻塞支付
      }
    }
  }

  try {
    const origin = request.headers.get("origin") || new URL(request.url).origin;
    const { url } = await createPaddleCheckout({ plan, userId, email, origin });
    return NextResponse.json({ ok: true, url });
  } catch (e: any) {
    console.error("[paddle:checkout]", e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
