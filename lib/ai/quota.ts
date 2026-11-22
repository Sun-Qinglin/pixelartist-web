/**
 * 额度读写。
 *
 * 两种存储后端，由 AI_QUOTA_STORE 决定：
 *   supabase（默认）：生产用。跨实例持久、能对账、能手动补额度。
 *   memory：本地开发用。这台机器连不上 Supabase 时的降级方案 ——
 *           进程内 Map，重启即清空，且只对单进程有效（next dev 是单进程，够用）。
 *
 * ⚠️ 生产环境绝不要设 AI_QUOTA_STORE=memory，那等于没有任何额度限制。
 *
 * 时间窗口：
 *   付费用户  "M:2026-02"      按自然月（UTC）刷新
 *   匿名试用  "D:2026-02-14"   按天（UTC）刷新
 * 用 UTC 而不是本地时区，避免同一份代码在不同服务器上算出不同的窗口。
 */

import type { getSupabaseServer } from "@/lib/supabase-server";
import { isAnonSubject } from "./auth";
import { quotaForTier } from "./policy";

/** service_role 客户端类型：从工厂函数反推，避免到处写泛型 */
export type ServerClient = NonNullable<ReturnType<typeof getSupabaseServer>>;

/** 存储后端模式下，svc 参数允许为 null（memory 模式不需要 Supabase） */
export type MaybeClient = ServerClient | null;

export interface QuotaSnapshot {
  /** 本窗口总额度 */
  limit: number;
  /** 本窗口已用 */
  used: number;
  /** 剩余 */
  remaining: number;
  /** 窗口标识，用于客户端显示 */
  period: string;
}

export type StoreMode = "memory" | "supabase";

/** 只有显式配置才走内存，避免生产环境漏配 Supabase 时静默变成"无额度限制" */
export function storeMode(): StoreMode {
  const raw = (process.env.AI_QUOTA_STORE || "").trim().toLowerCase();
  return raw === "memory" ? "memory" : "supabase";
}

export function usingMemoryStore(): boolean {
  return storeMode() === "memory";
}

export function periodKeyFor(subject: string, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (isAnonSubject(subject)) {
    const day = String(now.getUTCDate()).padStart(2, "0");
    return `D:${year}-${month}-${day}`;
  }
  return `M:${year}-${month}`;
}

function snapshot(period: string, limit: number, used: number): QuotaSnapshot {
  return {
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    period,
  };
}

function requireClient(svc: MaybeClient): ServerClient {
  if (!svc) throw new Error("Supabase 未配置，无法读写额度");
  return svc;
}

// ------------------------------------------------------------------ 内存后端

interface MemoryUsage {
  used: number;
  quota: number;
}

const memoryUsage = new Map<string, MemoryUsage>();
const memoryDevices = new Map<string, string>();

function memKey(subject: string, period: string): string {
  return `${subject}\u0000${period}`;
}

function countDevices(code: string): number {
  let n = 0;
  memoryDevices.forEach((value) => {
    if (value === code) n += 1;
  });
  return n;
}

/** 本地开发时的任务归属表：memory 模式下没有 ai_generations 表，用它顶替 */
export interface MemoryTask {
  subject: string;
  charged: number;
  status: "running" | "succeeded" | "refunded";
}

const memoryTasks = new Map<string, MemoryTask>();

export function recordMemoryTask(taskId: string, task: MemoryTask): void {
  if (!taskId) return;
  memoryTasks.set(taskId, task);
}

export function lookupMemoryTask(taskId: string): MemoryTask | null {
  return memoryTasks.get(taskId) ?? null;
}

export function markMemoryTask(taskId: string, patch: Partial<MemoryTask>): void {
  const current = memoryTasks.get(taskId);
  if (current) memoryTasks.set(taskId, { ...current, ...patch });
}

/** 仅用于本地调试：清空所有内存状态 */
export function resetMemoryStore(): void {
  memoryUsage.clear();
  memoryDevices.clear();
  memoryTasks.clear();
}

// ------------------------------------------------------------------ 额度

/** 只读查询，不建行、不扣减 */
export async function peekQuota(
  svc: MaybeClient,
  subject: string,
  tier: string
): Promise<QuotaSnapshot> {
  const limit = quotaForTier(tier);
  const period = periodKeyFor(subject);

  if (usingMemoryStore()) {
    const row = memoryUsage.get(memKey(subject, period));
    return snapshot(period, Math.max(limit, row?.quota ?? 0), row?.used ?? 0);
  }

  const { data, error } = await requireClient(svc)
    .from("ai_usage")
    .select("used, quota")
    .eq("subject", subject)
    .eq("period_key", period)
    .maybeSingle();

  if (error) throw new Error(`读取额度失败: ${error.message}`);
  const used = Number((data as { used?: number } | null)?.used ?? 0);
  return snapshot(period, limit, used);
}

/**
 * 原子扣减。amount 是「张数」，不足则 ok=false 且不扣。
 * Supabase 后端由 RPC 内的 for update 行锁保证并发安全。
 */
export async function consumeQuota(
  svc: MaybeClient,
  subject: string,
  tier: string,
  amount: number
): Promise<{ ok: boolean; quota: QuotaSnapshot }> {
  const period = periodKeyFor(subject);
  const limit = quotaForTier(tier);
  const ask = Math.max(amount, 0);

  if (usingMemoryStore()) {
    const key = memKey(subject, period);
    const row = memoryUsage.get(key) ?? { used: 0, quota: limit };
    row.quota = Math.max(row.quota, limit);
    if (row.used + ask > row.quota) {
      memoryUsage.set(key, row);
      return { ok: false, quota: snapshot(period, row.quota, row.used) };
    }
    row.used += ask;
    memoryUsage.set(key, row);
    return { ok: true, quota: snapshot(period, row.quota, row.used) };
  }

  const { data, error } = await requireClient(svc).rpc("ai_consume_quota", {
    p_subject: subject,
    p_period: period,
    p_quota: limit,
    p_amount: ask,
  });

  if (error) throw new Error(`扣减额度失败: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; used?: number; quota?: number }
    | null;

  const quotaLimit = Number(row?.quota ?? limit);
  const used = Number(row?.used ?? 0);
  return { ok: Boolean(row?.ok), quota: snapshot(period, quotaLimit, used) };
}

/**
 * 退回额度。跨月退款会退到「当前」窗口而不是当初扣的那个窗口，
 * 极端情况下（月底下单、月初失败）会少退一次，属于可接受的误差。
 */
export async function refundQuota(
  svc: MaybeClient,
  subject: string,
  amount: number
): Promise<void> {
  if (amount <= 0) return;
  const period = periodKeyFor(subject);

  if (usingMemoryStore()) {
    const key = memKey(subject, period);
    const row = memoryUsage.get(key);
    if (row) {
      row.used = Math.max(row.used - amount, 0);
      memoryUsage.set(key, row);
    }
    return;
  }

  const { error } = await requireClient(svc).rpc("ai_refund_quota", {
    p_subject: subject,
    p_period: period,
    p_amount: amount,
  });
  if (error) {
    // 退款失败不该让主流程崩掉，但要留痕便于人工补
    console.error("[ai] refund quota failed:", subject, amount, error.message);
  }
}

// ------------------------------------------------------------------ 设备绑定

export interface DeviceBindResult {
  ok: boolean;
  /** device_limit | device_bound_elsewhere | (空) */
  reason: string;
  bound: number;
}

/** 把设备绑到激活码上；超过上限返回 ok=false */
export async function bindDevice(
  svc: MaybeClient,
  deviceId: string,
  licenseCode: string,
  maxDevices: number
): Promise<DeviceBindResult> {
  if (usingMemoryStore()) {
    const owner = memoryDevices.get(deviceId);
    const bound = countDevices(licenseCode);
    if (owner !== undefined && owner !== licenseCode) {
      return { ok: false, reason: "device_bound_elsewhere", bound };
    }
    if (owner === undefined && bound >= Math.max(maxDevices, 1)) {
      return { ok: false, reason: "device_limit", bound };
    }
    memoryDevices.set(deviceId, licenseCode);
    return { ok: true, reason: "", bound: owner === undefined ? bound + 1 : bound };
  }

  const { data, error } = await requireClient(svc).rpc("ai_bind_device", {
    p_device_id: deviceId,
    p_license_code: licenseCode,
    p_max_devices: maxDevices,
  });

  if (error) throw new Error(`设备绑定失败: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string; bound?: number }
    | null;

  return {
    ok: Boolean(row?.ok),
    reason: String(row?.reason ?? ""),
    bound: Number(row?.bound ?? 0),
  };
}
