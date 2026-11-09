// 对应 lib/license.mjs 的类型声明（.mjs 在 TS 里需要 .d.mts 才能匹配）
export const TIER_LETTERS: Record<string, string>;
export function issueCode(tier: string, expiresAt: number): string;
export interface ValidateResult {
  ok: boolean;
  tier?: string;
  type?: string;
  expiresAt?: number;
  reason?: string;
}
export function validateCode(
  code: string,
  opts?: { checkExpired?: boolean }
): ValidateResult;
