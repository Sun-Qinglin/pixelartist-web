import { NextResponse, type NextRequest } from "next/server";
import { authenticate } from "@/lib/ai/auth";
import { isUpstreamConfigured, listStyles } from "@/lib/ai/rd-client";
import { ALLOWED_MODELS } from "@/lib/ai/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/styles
 * 代理 RD 的风格目录（只暴露允许使用的模型档位），服务端缓存 24 小时。
 *
 * 客户端必须拿这份目录来约束尺寸：同一个 style 在不同模型上的
 * 最小/最大边长、单次张数上限都不一样，硬编码会直接被 RD 拒。
 *
 * Response:
 *   200 { ok, styles: [{ id, model, label, min_size, max_size, max_batch, requires_input }], cached }
 *   401 未授权
 *   500 服务端未配置
 */
export async function GET(request: NextRequest) {
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

  const all = await listStyles();
  const allowed = new Set<string>(ALLOWED_MODELS);
  const styles = all
    .filter((style) => {
      // style id 形如 rd_fast__platformer，前缀就是模型档；不带前缀的按允许处理
      const prefix = style.id.includes("__") ? style.id.split("__")[0] : "";
      if (prefix && !allowed.has(prefix)) return false;
      if (!prefix && style.model && !allowed.has(style.model)) return false;
      return true;
    })
    .map((style) => ({
      id: style.id,
      model: style.model,
      label: style.label,
      min_size: style.minSize,
      max_size: style.maxSize,
      max_batch: style.maxBatch,
      requires_input: style.requiresInput,
    }))
    // 需要输入图的风格（改图/像素化）不能用于「文本 → 素材」，先过滤掉
    .filter((style) => !style.requires_input);

  return NextResponse.json({
    ok: true,
    styles,
    cached: styles.length > 0,
  });
}
