/** 站点级配置:文案、价格、下载信息都集中在这里,改一处全站生效。 */

export const site = {
  name: "PixelArtist",
  title: "PixelArtist · 像素画编辑器",
  tagline: "把每一颗像素，画成你想要的样子",
  description:
    "轻量专注的像素画编辑器：无限图层、逐帧动画、自动保存，完全离线。Windows 免费下载。",
  version: "0.1.0",
  releaseDate: "2026-11-09",
} as const;

export type Plan = {
  id: "free" | "monthly" | "yearly" | "lifetime";
  name: string;
  price: string;
  unit: string;
  note: string;
  features: string[];
  href: string;
  cta: string;
  featured?: boolean;
};

export const plans: Plan[] = [
  {
    id: "free",
    name: "免费版",
    price: "¥0",
    unit: "永久免费",
    note: "不限图层，不限时长",
    features: [
      "全部绘图工具与快捷键",
      "无限图层与全部混合模式",
      "逐帧时间轴与洋葱皮",
      "PNG 导出与工程文件保存",
      "本地自动保存、完全离线",
    ],
    href: "/download/",
    cta: "免费下载",
  },
  {
    id: "monthly",
    name: "Pro 月付",
    price: "¥9.9",
    unit: "/ 月",
    note: "随时取消，适合短期项目",
    features: [
      "包含免费版全部功能",
      "动画导出（GIF / 精灵表）",
      "批量帧导出",
      "Pro 专属工具与素材",
      "优先问题支持",
    ],
    href: "/account/",
    cta: "即将开放",
  },
  {
    id: "yearly",
    name: "Pro 年付",
    price: "¥68",
    unit: "/ 年",
    note: "最受欢迎，平均每月不到 6 元",
    features: [
      "包含免费版全部功能",
      "动画导出（GIF / 精灵表）",
      "批量帧导出",
      "Pro 专属工具与素材",
      "优先问题支持",
    ],
    href: "/account/",
    cta: "即将开放",
    featured: true,
  },
  {
    id: "lifetime",
    name: "Pro 永久",
    price: "¥128",
    unit: "一次买断",
    note: "长期使用最划算",
    features: [
      "包含 Pro 全部功能",
      "后续 Pro 更新持续可用",
      "不限设备数量",
      "优先问题支持",
    ],
    href: "/account/",
    cta: "即将开放",
  },
];

/** 免费版 / Pro 功能对照 */
export const comparisons: { label: string; free: string; pro: string }[] = [
  { label: "绘图工具与快捷键", free: "全部", pro: "全部" },
  { label: "图层数量", free: "不限", pro: "不限" },
  { label: "混合模式", free: "全部", pro: "全部" },
  { label: "逐帧动画编辑", free: "支持", pro: "支持" },
  { label: "PNG 导出", free: "支持", pro: "支持" },
  { label: "动画导出（GIF / 精灵表）", free: "—", pro: "支持" },
  { label: "批量帧导出", free: "—", pro: "支持" },
  { label: "Pro 专属工具与素材", free: "—", pro: "支持" },
  { label: "本地自动保存", free: "支持", pro: "支持" },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "免费版有什么限制？",
    a: "免费版不限图层、不限使用时长，全部绘图工具、混合模式与 PNG 导出都可以用。Pro 主要提供动画导出与高阶导出能力。",
  },
  {
    q: "会员到期后我的作品会被删除或加水印吗？",
    a: "不会。到期后作品仍然保留、导出不加水印，只是 Pro 专属功能暂时不可用，续费后立即恢复。",
  },
  {
    q: "支持哪些系统？",
    a: "目前提供 Windows 10 / 11 64 位版本，免安装解压即用。macOS 与 Linux 版本在计划中。",
  },
];
