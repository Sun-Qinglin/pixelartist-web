import { NextResponse, type NextRequest } from "next/server";
import { authenticate } from "@/lib/ai/auth";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { MaybeClient } from "@/lib/ai/quota";
import {
  lookupMemoryTask,
  markMemoryTask,
  refundQuota,
  usingMemoryStore,
} from "@/lib/ai/quota";
import { getTask, isUpstreamConfigured } from "@/lib/ai/rd-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerationRow {
  subject: string;
  status: string;
  quota_charged: number | null;
}

/**
 * GET /api/ai/task/{task_id}
 * 客户端每 2 秒轮询一次，直到 status 变成 succeeded / failed。
 *
 * Response:
 *   200 { ok, status: "pending"|"running"|"succeeded"|"failed", images: [], cost, error }
 *   401 未授权
 *   404 任务不存在或不属于当前凭证
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ task_id: string }> }
) {
  const auth = authenticate(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  if (!isUpstreamConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI 服务未配置（缺少 RETRO_DIFFUSION_API_KEY）" },
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

  const { task_id: rawTaskId } = await ctx.params;
  const taskId = (rawTaskId || "").trim();
  if (!taskId) {
    return NextResponse.json({ ok: false, error: "缺少任务号" }, { status: 400 });
  }

  const row = await loadGenerationRow(svc, taskId);
  if (row === "error") {
    return NextResponse.json({ ok: false, error: "任务查询失败" }, { status: 500 });
  }
  // 不属于当前凭证的任务一律当不存在，别泄露别人的任务号是否有效
  if (!row || row.subject !== auth.claims.sub) {
    return NextResponse.json({ ok: false, error: "任务不存在" }, { status: 404 });
  }

  let state;
  try {
    state = await getTask(taskId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询生成状态失败";
    console.error("[ai] getTask failed:", message);
    // 查状态失败不退款：任务可能还在跑，让客户端继续轮询到超时为止
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const charged = Number(row.quota_charged ?? 0);

  if (state.status === "succeeded" && state.images.length > 0) {
    await touchGeneration(svc, taskId, { status: "succeeded", cost: state.cost, error: null });
    return NextResponse.json({
      ok: true,
      status: "succeeded",
      images: state.images,
      cost: state.cost,
      error: "",
    });
  }

  const treatedAsFailed = state.status === "failed" || state.status === "succeeded";
  if (treatedAsFailed) {
    // 只在第一次失败时退额度，避免重复轮询反复退款
    if (row.status !== "refunded" && row.status !== "failed" && charged > 0) {
      await refundQuota(svc, row.subject, charged);
    }
    await touchGeneration(svc, taskId, {
      status: "refunded",
      error: state.error || "生成服务没有返回图片",
    });
    return NextResponse.json({
      ok: false,
      status: "failed",
      images: [],
      cost: state.cost,
      error: state.error || "生成失败，额度已退回",
    });
  }

  return NextResponse.json({
    ok: true,
    status: state.status,
    images: [],
    cost: state.cost,
    error: "",
  });
}

/** 读流水；返回 "error" 表示查询本身失败（区别于"查不到"） */
async function loadGenerationRow(
  svc: MaybeClient,
  taskId: string
): Promise<GenerationRow | null | "error"> {
  if (usingMemoryStore()) {
    const task = lookupMemoryTask(taskId);
    if (!task) return null;
    return {
      subject: task.subject,
      status: task.status,
      quota_charged: task.charged,
    };
  }

  if (!svc) return "error";
  const { data, error } = await svc
    .from("ai_generations")
    .select("subject, status, quota_charged")
    .eq("task_id", taskId)
    .maybeSingle<GenerationRow>();

  if (error) {
    console.error("[ai] query generation failed:", error.message);
    return "error";
  }
  return data ?? null;
}

async function touchGeneration(
  svc: MaybeClient,
  taskId: string,
  patch: { status: string; cost?: number; error: string | null }
): Promise<void> {
  if (usingMemoryStore()) {
    // memory 模式的流水只在内存里，只需要把状态记下来给下一次轮询用
    markMemoryTask(taskId, {
      status: patch.status === "succeeded" ? "succeeded" : "refunded",
    });
    return;
  }

  if (!svc) return;
  const { error } = await svc
    .from("ai_generations")
    .update({
      status: patch.status,
      cost: typeof patch.cost === "number" && patch.cost > 0 ? patch.cost : undefined,
      error: patch.error,
      updated_at: new Date().toISOString(),
    })
    .eq("task_id", taskId);
  if (error) console.error("[ai] touch generation failed:", error.message);
}
