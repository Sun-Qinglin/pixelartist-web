import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPaddleSignature } from "@/lib/paddle";
// 与 Godot 客户端同源的 HMAC 发码模块
import { issueCode } from "@/lib/license.mjs";

export const runtime = "nodejs";

const TIER_LETTER: Record<string, string> = {
  permanent: "L",
  yearly: "Y",
  monthly: "M",
  student: "S",
};

/**
 * POST /api/paddle/webhook
 * 收到 transaction.completed 后自动发一张激活码,
 * 写入 orders + license_codes;若买家已登录则直接解锁 Pro。
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || !supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "服务未配置" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("paddle-signature");

  if (!verifyPaddleSignature(rawBody, signature, secret)) {
    console.warn("[paddle:webhook] 签名校验失败");
    return NextResponse.json({ ok: false, error: "签名无效" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
  }

  // 只处理首次结账;订阅续费(origin=subscription_recurring)不重复发码
  if (event.event_type !== "transaction.completed") {
    return NextResponse.json({ ok: true, ignored: event.event_type });
  }
  const txn = event.data || {};
  if (txn.origin && txn.origin !== "web") {
    return NextResponse.json({ ok: true, ignored: `origin=${txn.origin}` });
  }

  const txnId: string = txn.id;
  const custom = txn.custom_data || {};
  const tier: string = custom.tier || "yearly";
  const days: number = Number(custom.days ?? 365);
  const typeLetter: string = TIER_LETTER[tier] || "Y";
  const userId: string | null = custom.user_id || null;
  const amount = Number(txn?.details?.totals?.total ?? 0);
  const currency = txn?.currency_code || "CNY";

  const expiresAt = days > 0 ? Math.floor(Date.now() / 1000) + days * 86400 : 0;
  const code: string = issueCode(tier, expiresAt);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 幂等:同一笔交易只发一次码
  const { error: orderErr } = await supabase.from("orders").insert({
    provider: "paddle",
    provider_transaction_id: txnId,
    user_id: userId,
    plan: custom.plan || tier,
    tier,
    amount_cents: amount,
    currency,
    license_code: code,
  });

  if (orderErr) {
    // 23505 = 唯一约束冲突,说明这笔订单已经处理过
    if ((orderErr as any).code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[paddle:webhook] 写 orders 失败:", orderErr.message);
    return NextResponse.json({ ok: false, error: orderErr.message }, { status: 500 });
  }

  // 把码放进码池
  const { error: codeErr } = await supabase.from("license_codes").insert({
    code,
    tier,
    type_letter: typeLetter,
    expires_at: expiresAt,
    batch_note: `paddle:${txnId}`,
    // 已登录买家直接标记为已用,避免码被重复兑换
    ...(userId ? { redeemed_by: userId, redeemed_at: new Date().toISOString() } : {}),
  });
  if (codeErr) console.error("[paddle:webhook] 写 license_codes 失败:", codeErr.message);

  // 已登录买家:直接解锁 Pro
  if (userId) {
    const { error: profErr } = await supabase
      .from("profiles")
      .update({
        pro_tier: tier,
        pro_expires_at: expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null,
        license_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (profErr) console.error("[paddle:webhook] 更新 profiles 失败:", profErr.message);

    await supabase.from("subscriptions").insert({
      user_id: userId,
      tier,
      status: "active",
      payment_provider: "paddle",
      provider_order_id: txnId,
      amount_cents: amount,
      currency,
      current_period_end: expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null,
    });
  }

  console.log(`[paddle:webhook] ✅ ${txnId} → ${tier} 码 ${code}`);
  return NextResponse.json({ ok: true, code });
}
