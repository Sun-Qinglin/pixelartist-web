import { NextResponse, type NextRequest } from "next/server";
import { authenticate } from "@/lib/ai/auth";
import { getSupabaseServer } from "@/lib/supabase-server";
import { buildPrompt } from "@/lib/ai/prompt";
import { consumeQuota, refundQuota, recordMemoryTask, usingMemoryStore } from "@/lib/ai/quota";
import { MAX_IMAGES_PER_REQUEST, MAX_SIZE, MIN_SIZE } from "@/lib/ai/policy";
import {
  AiUpstreamError,
  createInference,
  findStyle,
  isUpstreamConfigured,
  stripDataUrl,
} from "@/lib/ai/rd-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 参考图上限（RD Core / Pro 支持最多 9 张） */
const MAX_REFERENCE_IMAGES = 9;
/** 单张图 base64 的长度上限，防止超大请求体把函数撑爆 */
const MAX_IMAGE_B64_CHARS = 400_000;

/**
 * POST /api/ai/generate
 * 提交一次生成任务。永远走 RD 的异步接口，只把 task_id 返给客户端，
 * 由客户端轮询 GET /api/ai/task/{id} 取图——同步等 10-20 秒会被函数超时掐断。
 *
 * Request:
 *   {
 *     prompt: "红色史莱姆，侧面朝右",     // 中文原文即可，服务端负责翻成英文
 *     style: "rd_fast__platformer",
 *     width: 32, height: 32, num_images: 1, seed: 0,
 *     palette_b64: "<PNG base64>",        // 可选：锁定调色板
 *     ref_b64: ["<PNG base64>"],          // 可选：参考图
 *     remove_bg: true,
 *     check_cost_only: false              // 只询价，不扣额度、不生成
 *   }
 *
 * Response:
 *   200 { ok, task_id, status, images, cost, final_prompt, translated, quota }
 *   402 { ok: false, error, quota }      额度不足
 *   502 { ok: false, error }             上游失败（已自动退额度）
 */
export async function POST(request: NextRequest) {
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const userPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const styleId = typeof body.style === "string" ? body.style.trim() : "";
  if (userPrompt.length < 2) {
    return NextResponse.json({ ok: false, error: "请先描述要生成的素材" }, { status: 400 });
  }
  if (styleId.length < 3) {
    return NextResponse.json({ ok: false, error: "请选择生成风格" }, { status: 400 });
  }

  const checkCostOnly = body.check_cost_only === true;
  const removeBg = body.remove_bg !== false;
  const seedRaw = toInt(body.seed, 0);
  const seed = seedRaw > 0 ? seedRaw : 0;

  // ---- 尺寸/张数：以风格目录给的约束为准，目录拿不到就退回全局底线 ----
  const style = await findStyle(styleId);
  const minSize = Math.max(MIN_SIZE, style?.minSize ?? MIN_SIZE);
  const maxSize = Math.min(MAX_SIZE, style?.maxSize ?? MAX_SIZE);
  const width = clampInt(toInt(body.width, 32), minSize, maxSize);
  const height = clampInt(toInt(body.height, 32), minSize, maxSize);
  const batchCap = Math.min(MAX_IMAGES_PER_REQUEST, style?.maxBatch ?? MAX_IMAGES_PER_REQUEST);
  const numImages = clampInt(toInt(body.num_images, 1), 1, batchCap);

  // ---- 参考图 / 调色板：只接受裸 base64，超长的直接丢弃 ----
  const paletteB64 = normalizeImageField(body.palette_b64);
  const referenceB64 = normalizeImageList(body.ref_b64);

  // ---- 提示词：中文 → 英文 + 剥离禁用词 ----
  const promptResult = await buildPrompt(userPrompt);

  // ---- 询价：不扣额度、不建流水 ----
  if (checkCostOnly) {
    try {
      const estimate = await createInference({
        prompt: promptResult.final,
        styleId,
        width,
        height,
        numImages,
        seed,
        checkCostOnly: true,
      });
      return NextResponse.json({
        ok: true,
        cost: estimate.cost,
        final_prompt: promptResult.final,
        translated: promptResult.translated,
        width,
        height,
        num_images: numImages,
      });
    } catch (err) {
      return upstreamFailure(err);
    }
  }

  // ---- 扣额度：不足直接 402，客户端能看到剩余量 ----
  let quota;
  try {
    const consumed = await consumeQuota(svc, auth.claims.sub, auth.claims.tier, numImages);
    quota = consumed.quota;
    if (!consumed.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            auth.claims.tier === "anon"
              ? "今日试用额度已用完，激活后可继续生成"
              : "本月生成额度已用完",
          quota,
        },
        { status: 402 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "额度校验失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  // ---- 真正提交 ----
  let result;
  try {
    result = await createInference({
      prompt: promptResult.final,
      styleId,
      width,
      height,
      numImages,
      seed,
      paletteB64,
      referenceB64,
      removeBg,
    });
  } catch (err) {
    // 上游失败就把刚扣的额度退回去，用户不该为失败买单
    await refundQuota(svc, auth.claims.sub, numImages);
    return upstreamFailure(err);
  }

  const succeededImmediately = result.images.length > 0;
  const status = succeededImmediately ? "succeeded" : "running";

  // 流水只用于对账与追溯，写失败不影响本次生成结果
  try {
    if (usingMemoryStore()) {
      if (result.taskId) {
        recordMemoryTask(result.taskId, {
          subject: auth.claims.sub,
          charged: numImages,
          status: succeededImmediately ? "succeeded" : "running",
        });
      }
    } else {
      await svc!.from("ai_generations").insert({
        subject: auth.claims.sub,
        device_id: auth.claims.dev,
        task_id: result.taskId || null,
        rd_request_id: result.requestId || null,
        style: styleId,
        width,
        height,
        num_images: numImages,
        cost: result.cost,
        quota_charged: numImages,
        prompt_user: userPrompt.slice(0, 2000),
        prompt_final: promptResult.final.slice(0, 2000),
        status,
      });
    }
  } catch (err) {
    console.error("[ai] insert generation failed:", err);
  }

  return NextResponse.json({
    ok: true,
    task_id: result.taskId,
    status,
    images: result.images,
    cost: result.cost,
    final_prompt: promptResult.final,
    translated: promptResult.translated,
    note: promptResult.note,
    width,
    height,
    num_images: numImages,
    quota,
  });
}

// ------------------------------------------------------------------ helpers

function toInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return fallback;
}

function clampInt(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeImageField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = stripDataUrl(value);
  if (clean.length < 64 || clean.length > MAX_IMAGE_B64_CHARS) return undefined;
  return clean;
}

function normalizeImageList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const clean = normalizeImageField(item);
    if (clean) out.push(clean);
    if (out.length >= MAX_REFERENCE_IMAGES) break;
  }
  return out.length > 0 ? out : undefined;
}

function upstreamFailure(err: unknown) {
  const message = err instanceof Error ? err.message : "生成失败";
  // 上游没配置是服务端自己的问题（500），其余按网关错误给 502，客户端提示不一致
  const status = err instanceof AiUpstreamError ? err.status : 500;
  console.error("[ai] generate failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status });
}
