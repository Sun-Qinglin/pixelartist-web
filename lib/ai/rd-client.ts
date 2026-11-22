/**
 * Retro Diffusion v2 API 封装。
 *
 * 只有这一层知道 RD 的原始字段名；上层路由拿到的都是归一化结构。
 * RD 的返回字段在不同模型/版本上偶有差异（base64_images / images、task_id / id、
 * credit_cost / balance_cost…），所以下面所有解析都是「按候选字段取值」，
 * 拿到不认识的结构也不会 500，而是退化成明确的错误让客户端提示重试。
 *
 * 关键约定（踩过坑的）：
 *   * 一定要 `async: true`：Vercel 的函数超时扛不住同步等 10-20 秒的生成。
 *   * prompt 里不写 "pixel art"，画风由 prompt_style 决定。
 *   * input_palette / input_image 传的是**纯 base64**，不能带 `data:image/png;base64,` 前缀。
 *   * 生成尺寸必须是风格允许范围内的原生像素尺寸，不要传放大的显示尺寸。
 */

const DEFAULT_BASE = "https://api.retrodiffusion.ai";
const REQUEST_TIMEOUT_MS = 30_000;
const STYLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class AiUpstreamError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 502, code = "upstream_error") {
    super(message);
    this.name = "AiUpstreamError";
    this.status = status;
    this.code = code;
  }
}

function baseUrl(): string {
  return (process.env.RETRO_DIFFUSION_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

function rdKey(): string {
  return (process.env.RETRO_DIFFUSION_API_KEY || "").trim().replace(/[`"'\s]/g, "");
}

export function isUpstreamConfigured(): boolean {
  return rdKey().length > 0;
}

// ------------------------------------------------------------------ JSON 提取小工具

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function getStr(obj: unknown, keys: string[]): string {
  const rec = asRecord(obj);
  if (!rec) return "";
  for (const key of keys) {
    const raw = rec[key];
    if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  }
  return "";
}

function getNum(obj: unknown, keys: string[], fallback: number): number {
  const rec = asRecord(obj);
  if (!rec) return fallback;
  for (const key of keys) {
    const raw = rec[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

/** 去掉 `data:image/png;base64,` 这类前缀，RD 只认裸 base64 */
export function stripDataUrl(value: string): string {
  const trimmed = value.trim();
  const comma = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && comma > 0) return trimmed.slice(comma + 1);
  return trimmed;
}

function extractImages(payload: unknown): string[] {
  const rec = asRecord(payload);
  const roots: unknown[] = [
    rec?.base64_images,
    rec?.images,
    rec?.outputs,
    rec?.output,
    asRecord(rec?.data)?.base64_images,
    asRecord(rec?.data)?.images,
    asRecord(rec?.result)?.base64_images,
    asRecord(rec?.result)?.images,
  ];

  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const clean = stripDataUrl(value);
    // 太短的字符串不可能是 PNG，直接忽略，避免把 URL 或空串当图
    if (clean.length > 128) out.push(clean);
  };

  for (const root of roots) {
    if (Array.isArray(root)) root.forEach(push);
    else push(root);
  }
  return out;
}

// ------------------------------------------------------------------ HTTP

async function rdFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = rdKey();
  if (!key) throw new AiUpstreamError("AI 服务未配置", 500, "not_configured");

  let response: Response;
  try {
    response = await fetch(baseUrl() + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-RD-Token": key,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AiUpstreamError(`调用生成服务失败: ${message}`, 502, "upstream_unreachable");
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    const detail = getStr(parsed, ["error", "message", "detail"]) || text.slice(0, 200);
    throw new AiUpstreamError(
      `生成服务返回 ${response.status}: ${detail || "无详情"}`,
      502,
      "upstream_rejected"
    );
  }

  return parsed;
}

// ------------------------------------------------------------------ 风格目录

export interface RdStyle {
  id: string;
  model: string;
  label: string;
  minSize: number;
  maxSize: number;
  /** 单次最多几张 */
  maxBatch: number;
  /** 是否必须带输入图 */
  requiresInput: boolean;
}

let styleCache: { at: number; items: RdStyle[] } | null = null;

function normalizeStyles(payload: unknown): RdStyle[] {
  const rec = asRecord(payload);
  const candidates: unknown[] = [
    rec?.styles,
    rec?.data,
    rec?.items,
    asRecord(rec?.data)?.styles,
    payload,
  ];

  let list: unknown[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      list = candidate;
      break;
    }
  }
  if (list.length === 0 && rec) {
    // 有的版本返回的是 { "rd_fast__default": {...}, ... } 这种字典
    const values = Object.values(rec).filter((v) => asRecord(v) !== null);
    if (values.length > 0) list = values;
  }

  const out: RdStyle[] = [];
  for (const raw of list) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = getStr(item, ["id", "style_id", "styleId", "name", "code"]);
    if (!id) continue;

    const model = getStr(item, ["model", "model_id", "base_model"]) || id.split("__")[0] || "rd_fast";
    const minSize = getNum(item, ["min_size", "minSize", "min_width", "size_min"], 12);
    const maxSize = getNum(item, ["max_size", "maxSize", "max_width", "size_max"], 512);
    const maxBatch = getNum(item, ["max_batch", "batch", "max_images", "num_images_max"], 4);
    const requiresInput =
      item.requires_input === true ||
      item.requires_input_image === true ||
      getStr(item, ["input", "input_type"]) === "required";

    out.push({
      id,
      model,
      label: getStr(item, ["label", "title", "display_name", "description"]) || id,
      minSize: Math.max(1, Math.floor(minSize)),
      maxSize: Math.max(Math.floor(minSize), Math.floor(maxSize)),
      maxBatch: Math.max(1, Math.floor(maxBatch)),
      requiresInput,
    });
  }

  return out;
}

/** 拉风格目录，进程内缓存 24 小时；失败时返回空数组（上层用默认约束兜底） */
export async function listStyles(): Promise<RdStyle[]> {
  if (styleCache && Date.now() - styleCache.at < STYLE_CACHE_TTL_MS) {
    return styleCache.items;
  }
  try {
    const payload = await rdFetch("/v2/styles/selector", { method: "GET" });
    const items = normalizeStyles(payload);
    if (items.length > 0) {
      styleCache = { at: Date.now(), items };
      return items;
    }
  } catch (err) {
    console.error("[ai] listStyles failed:", err instanceof Error ? err.message : err);
  }
  return styleCache?.items ?? [];
}

export async function findStyle(styleId: string): Promise<RdStyle | null> {
  const items = await listStyles();
  return items.find((s) => s.id === styleId) ?? null;
}

// ------------------------------------------------------------------ 生成

export interface RdInferenceInput {
  prompt: string;
  styleId: string;
  width: number;
  height: number;
  numImages: number;
  seed?: number;
  /** 纯 base64 PNG */
  paletteB64?: string;
  /** 纯 base64 PNG 数组 */
  referenceB64?: string[];
  removeBg?: boolean;
  /** 只询价，不真生成（RD 不收费） */
  checkCostOnly?: boolean;
}

export interface RdInferenceResult {
  taskId: string;
  requestId: string;
  cost: number;
  images: string[];
  status: string;
}

export async function createInference(input: RdInferenceInput): Promise<RdInferenceResult> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    prompt_style: input.styleId,
    width: input.width,
    height: input.height,
    num_images: input.numImages,
    remove_bg: input.removeBg ?? true,
    bypass_prompt_expansion: false,
  };

  if (typeof input.seed === "number" && input.seed > 0) body.seed = input.seed;
  if (input.paletteB64) body.input_palette = stripDataUrl(input.paletteB64);
  if (input.referenceB64 && input.referenceB64.length > 0) {
    body.reference_images = input.referenceB64.map(stripDataUrl);
  }

  if (input.checkCostOnly) {
    body.check_cost = true;
  } else {
    // 询价不走异步任务；真正生成一定走异步，避免函数超时
    body.async = true;
  }

  const payload = await rdFetch("/v2/inferences", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const rec = asRecord(payload);
  const taskId = getStr(rec, ["task_id", "taskId", "id", "request_id"]);
  const requestId = getStr(rec, ["request_id", "requestId", "id"]) || taskId;
  const images = extractImages(payload);

  let status = getStr(rec, ["status", "state", "task_status"]);
  if (!status) status = images.length > 0 ? "succeeded" : "pending";

  if (!input.checkCostOnly && !taskId && images.length === 0) {
    throw new AiUpstreamError("生成服务没有返回任务号", 502, "upstream_no_task");
  }

  return {
    taskId,
    requestId,
    cost: getNum(rec, ["credit_cost", "balance_cost", "cost", "price", "estimated_cost"], 0),
    images,
    status,
  };
}

export type RdTaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface RdTaskState {
  status: RdTaskStatus;
  /** 纯 base64 PNG */
  images: string[];
  cost: number;
  error: string;
}

function normalizeStatus(raw: string): RdTaskStatus {
  const s = raw.toLowerCase();
  if (s === "succeeded" || s === "success" || s === "completed" || s === "complete" || s === "done") {
    return "succeeded";
  }
  if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled") {
    return "failed";
  }
  if (s === "running" || s === "processing" || s === "in_progress" || s === "started") {
    return "running";
  }
  return "pending";
}

export async function getTask(taskId: string): Promise<RdTaskState> {
  const payload = await rdFetch(`/v2/inferences/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
  });

  const rec = asRecord(payload);
  const images = extractImages(payload);
  let status = normalizeStatus(getStr(rec, ["status", "state", "task_status"]));
  if (status !== "succeeded" && status !== "failed" && images.length > 0) {
    status = "succeeded";
  }

  return {
    status,
    images: status === "succeeded" ? images : [],
    cost: getNum(rec, ["credit_cost", "balance_cost", "cost", "price"], 0),
    error: getStr(rec, ["error", "message", "detail", "failure_reason"]),
  };
}
