/**
 * 中文需求 → 英文生成提示词。
 *
 * RD 的 prompt 只该描述「主体」，画风由 prompt_style 决定；往 prompt 里写
 * "pixel art" 之类的词反而会把结果拉向「像素风格插画」而不是真网格像素。
 * 所以这里做两件事：
 *   1. 用便宜的 LLM 把中文翻成英文并收敛成一句主体描述；
 *   2. 无论翻译成功与否，都把禁用词剥掉、补齐平坦白底描述。
 *
 * 翻译模型是可选的：没配 AI_TRANSLATE_KEY 就退化成「原文直传」，
 * 功能不报错，只是中文提示词下 RD 的理解会差一些（客户端会提示用户写英文）。
 */

const BANNED_TERMS = [
  "pixel art",
  "pixelart",
  "pixel-art",
  "pixelated",
  "pixel style",
  "8-bit",
  "8bit",
  "16-bit",
  "16bit",
  "32-bit",
  "retro style",
  "sprite sheet",
  "spritesheet",
  "sprite-sheet",
  "transparent background",
  "game asset",
  "asset pack",
];

const BACKGROUND_HINT = "on a plain white background";
const MAX_PROMPT_CHARS = 400;
const TRANSLATE_TIMEOUT_MS = 10_000;

export interface PromptResult {
  /** 最终送给 RD 的提示词 */
  final: string;
  /** 是否经过模型翻译 */
  translated: boolean;
  /** 给客户端看的补充说明（失败原因等），正常为空 */
  note: string;
}

interface ProviderConfig {
  base: string;
  model: string;
  key: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 剥掉禁用词 + 压缩空白 */
export function scrubPrompt(input: string): string {
  let out = input;
  for (const term of BANNED_TERMS) {
    out = out.replace(new RegExp(escapeRegExp(term), "gi"), " ");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
}

/** 没写背景就补一句平坦白底——RD 不写背景时会漂成脏灰底，抠图很难看 */
function ensureBackground(text: string): string {
  const trimmed = text.replace(/[.,;、。]+$/, "").trim();
  if (!trimmed) return BACKGROUND_HINT;
  if (/background/i.test(trimmed)) return trimmed;
  return `${trimmed}, ${BACKGROUND_HINT}`;
}

const SYSTEM_PROMPT = `You turn a game-asset request (usually written in Chinese) into ONE concise English image prompt for a pixel-art generator that renders the art style by itself.

Rules:
1. Describe ONLY the subject: what it is, its silhouette, pose or orientation, main colors, and the camera angle (side view / top-down / isometric) if the request implies one.
2. Never mention: pixel art, 8-bit, 16-bit, retro, sprite sheet, pixelated, resolution, canvas size, or any art style or rendering keyword.
3. Never mention transparency or background removal. Always end with ", on a plain white background".
4. Output one single line, under 40 words. No quotes, no markdown, no explanation.
5. Stay literal. If the request is vague, keep it short instead of inventing details.

Output the prompt only.`;

function providerConfig(): ProviderConfig | null {
  const key = (process.env.AI_TRANSLATE_KEY || "").trim().replace(/[`"'\s]/g, "");
  if (!key) return null;

  const provider = (process.env.AI_TRANSLATE_PROVIDER || "deepseek").trim().toLowerCase();
  const modelOverride = (process.env.AI_TRANSLATE_MODEL || "").trim();
  const baseOverride = (process.env.AI_TRANSLATE_BASE_URL || "").trim();

  // 三个都走 OpenAI 兼容协议，换供应商只需要改这几个默认值
  const defaults: Record<string, { base: string; model: string }> = {
    deepseek: { base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    gemini: {
      base: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.0-flash",
    },
  };

  const picked = defaults[provider];
  const base = (baseOverride || picked?.base || "").trim().replace(/\/+$/, "");
  if (!base) return null;

  return {
    base,
    model: modelOverride || picked?.model || "gpt-4o-mini",
    key,
  };
}

function extractContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

async function callChatCompletion(cfg: ProviderConfig, userText: string): Promise<string> {
  const response = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 160,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
    }),
    signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 160);
    throw new Error(`翻译服务返回 ${response.status}: ${detail}`);
  }

  const payload: unknown = await response.json();
  const content = extractContent(payload);
  if (!content.trim()) throw new Error("翻译结果为空");
  return content;
}

/** 把用户输入变成最终提示词。永远不抛错——翻译失败就用原文兜底。 */
export async function buildPrompt(userText: string): Promise<PromptResult> {
  const cleaned = scrubPrompt(userText).slice(0, MAX_PROMPT_CHARS);
  const cfg = providerConfig();

  if (!cfg) {
    return {
      final: ensureBackground(cleaned),
      translated: false,
      note: "服务端未配置翻译模型，已按原文生成",
    };
  }

  try {
    const raw = await callChatCompletion(cfg, cleaned);
    const normalized = scrubPrompt(raw)
      .replace(/^["'`*\s]+/, "")
      .replace(/["'`*\s]+$/, "")
      .slice(0, MAX_PROMPT_CHARS);
    if (normalized.length < 3) throw new Error("翻译结果过短");
    return { final: ensureBackground(normalized), translated: true, note: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai] buildPrompt fallback:", message);
    return {
      final: ensureBackground(cleaned),
      translated: false,
      note: "翻译失败，已按原文生成",
    };
  }
}
