import crypto from "crypto";

// ============================================================
// Paddle Billing 服务端封装
// ------------------------------------------------------------
// 为什么用 Paddle 而不是 Stripe:
//   Paddle 是 Merchant of Record,个人/公司都能注册,
//   国内用户可直接用支付宝(需 Paddle 审批)和微信支付(仅一次性付款)。
//   我们不用处理跨境收款和税务。
// ============================================================

const API_BASE =
  process.env.PADDLE_ENV === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";

export const PADDLE_CONFIGURED = Boolean(
  process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET
);

/** 套餐定义:tier / 天数 / 对应的 Paddle price_id(从环境变量读) */
export type PlanKey = "yearly" | "monthly" | "lifetime" | "student";

type PlanConfig = {
  tier: "yearly" | "monthly" | "permanent" | "student";
  /** 有效天数,0 = 永久 */
  days: number;
  /** 激活码类型字母,和客户端 LicenseValidator 一致 */
  typeLetter: "Y" | "M" | "L" | "S";
  label: string;
  priceId?: string;
};

export const PADDLE_PLANS: Record<PlanKey, PlanConfig> = {
  yearly: {
    tier: "yearly",
    days: 365,
    typeLetter: "Y",
    label: "PixelArtist Pro 年付 (¥68/年)",
    priceId: process.env.PADDLE_PRICE_YEARLY,
  },
  monthly: {
    tier: "monthly",
    days: 30,
    typeLetter: "M",
    label: "PixelArtist Pro 月付 (¥9.9/月)",
    priceId: process.env.PADDLE_PRICE_MONTHLY,
  },
  lifetime: {
    tier: "permanent",
    days: 0,
    typeLetter: "L",
    label: "PixelArtist Pro 永久版 (¥128)",
    priceId: process.env.PADDLE_PRICE_LIFETIME,
  },
  student: {
    tier: "student",
    days: 365,
    typeLetter: "S",
    label: "PixelArtist Pro 学生版 (¥34/年)",
    priceId: process.env.PADDLE_PRICE_STUDENT,
  },
};

function apiKey(): string {
  return process.env.PADDLE_API_KEY || "";
}

/**
 * 创建 Paddle 交易并返回托管支付页 URL。
 * Paddle 会根据买家所在国家/币种自动展示可用方式
 * (国内买家 + CNY 时会出现支付宝,一次性商品还会出现微信支付)。
 */
export async function createPaddleCheckout(params: {
  plan: PlanKey;
  userId?: string;
  email?: string;
  origin: string;
}): Promise<{ url: string }> {
  const plan = PADDLE_PLANS[params.plan];
  if (!plan) throw new Error("未知套餐");
  if (!plan.priceId) throw new Error(`套餐 ${params.plan} 未配置 price_id`);

  const res = await fetch(`${API_BASE}/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      items: [{ price_id: plan.priceId, quantity: 1 }],
      // 这里只信任服务端推导的 tier/days,不接受前端传入,避免篡改
      custom_data: {
        plan: params.plan,
        tier: plan.tier,
        days: plan.days,
        type_letter: plan.typeLetter,
        user_id: params.userId || null,
      },
      ...(params.email ? { customer: { email: params.email } } : {}),
      checkout: {
        // Paddle 会自动在末尾追加 _ptxn=<transaction_id>
        success_url: `${params.origin}/purchase/success`,
      },
    }),
  });

  const json: any = await res.json();
  if (!res.ok) {
    const detail = json?.error?.detail || json?.error?.code || `HTTP ${res.status}`;
    throw new Error(detail);
  }

  const url = json?.data?.checkout?.url;
  if (!url) throw new Error("Paddle 未返回支付链接");
  return { url };
}

/**
 * 校验 Paddle Webhook 签名。
 * 请求头格式: Paddle-Signature: ts=1711550000;h1=<hex>
 * 签名内容: `${ts}:${rawBody}`,算法 HMAC-SHA256。
 */
export function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const parts: Record<string, string> = {};
  for (const kv of signatureHeader.split(";")) {
    const idx = kv.indexOf("=");
    if (idx === -1) continue;
    parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }

  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  // 拒绝超过 5 分钟的旧请求,防重放
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}:${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(h1, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
