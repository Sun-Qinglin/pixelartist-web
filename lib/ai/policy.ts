/**
 * AI 素材生成的额度与参数策略 —— 所有数值集中在这里，改一行就生效。
 *
 * 额度单位是「张」：一次请求 num_images=2 就扣 2。
 * 付费用户的额度和 RD 的真实成本直接挂钩，调之前先算一下单位经济：
 *   RD Fast  $0.03/张 → permanent 200 张/月 ≈ $6/月成本
 *   RD Core  $0.10/张 → 同样的量 ≈ $20/月，所以面板里只开放 Fast/Core 两档。
 */

export type AiTier = "anon" | "permanent" | "yearly" | "monthly" | "student";

/** 每个付费档位每自然月能生成多少张 */
export const MONTHLY_QUOTA: Record<Exclude<AiTier, "anon">, number> = {
  permanent: 200,
  yearly: 200,
  monthly: 100,
  student: 80,
};

/** 没有激活码的匿名试用：按天计 */
export const ANON_DAILY_QUOTA = 2;

/** 一个激活码最多绑定几台设备（防止一码多人群发） */
export const MAX_DEVICES_PER_CODE = 3;

/** 网关签发的 token 有效期（秒）。客户端到期前静默续期。 */
export const TOKEN_TTL_SECONDS = 12 * 60 * 60;

/** 单次请求最多要几张图 */
export const MAX_IMAGES_PER_REQUEST = 4;

/** 画布尺寸硬底线。各风格还有自己的上下限，以 /v2/styles/selector 为准。 */
export const MIN_SIZE = 12;
export const MAX_SIZE = 512;

/** 允许的模型档位（面板里能选的就这两个） */
export const ALLOWED_MODELS = ["rd_fast", "rd_core"] as const;
export type AiModel = (typeof ALLOWED_MODELS)[number];

/** 模型档位对应的单价（USD/张），只用于给用户显示预估，真实账单以 RD 返回为准 */
export const MODEL_UNIT_PRICE: Record<AiModel, number> = {
  rd_fast: 0.03,
  rd_core: 0.1,
};

/** 取某档位的额度；未知档位按 0 处理（等于禁用） */
export function quotaForTier(tier: string): number {
  if (tier === "anon") return ANON_DAILY_QUOTA;
  return MONTHLY_QUOTA[tier as Exclude<AiTier, "anon">] ?? 0;
}

export function isPaidTier(tier: string): boolean {
  return tier === "permanent" || tier === "yearly" || tier === "monthly" || tier === "student";
}
