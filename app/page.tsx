import Link from "next/link";
import { EditorMock } from "@/components/editor-mock";
import { Icon, type IconName } from "@/components/icon";
import { PriceGrid } from "@/components/price-grid";
import { faqs } from "@/lib/site";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "layers",
    title: "无限图层",
    text: "任意数量的图层与全部混合模式，复杂构图也放得下，免费版同样不设上限。",
  },
  {
    icon: "film",
    title: "逐帧动画",
    text: "时间轴、洋葱皮与帧率控制都在同一个界面里，做小动画不用再换软件。",
  },
  {
    icon: "pen",
    title: "像素级工具",
    text: "铅笔、直线、矩形、椭圆、油漆桶、吸管、魔棒、选区，常用快捷键一应俱全。",
  },
  {
    icon: "wheel",
    title: "环形工具轮",
    text: "按住鼠标右键向工具方向滑动即可切换，手不离笔，思路不断。",
  },
  {
    icon: "save",
    title: "自动保存",
    text: "定时自动保存，退出前再补存一次；下次启动询问是否恢复，连视角都还原。",
  },
  {
    icon: "theme",
    title: "深浅主题",
    text: "一键切换暗色 / 明亮模式，整套界面平滑过渡，长时间作画更舒服。",
  },
];

const STEPS = [
  {
    num: "01",
    title: "下载解压",
    text: "下载 Windows 版压缩包，解压到任意目录即可运行，无需安装与注册。",
  },
  {
    num: "02",
    title: "打开就画",
    text: "新建画布或导入图片，选择工具与颜色，像素画的核心操作都在手边。",
  },
  {
    num: "03",
    title: "导出作品",
    text: "导出 PNG 或保存工程文件，随时继续；逐帧动画可在 Pro 中导出 GIF 与精灵表。",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="shell hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">PIXELARTIST · 像素画编辑器</span>
            <h1 className="hero-title">
              把每一颗<span className="accent">像素</span>，
              <br />
              画成你想要的样子
            </h1>
            <p className="hero-sub">
              轻量、专注的像素画编辑器：无限图层、逐帧动画、自动保存，完全离线。
              Windows 免费下载，打开就能画。
            </p>
            <div className="hero-actions">
              <Link href="/download/" className="btn btn-primary">
                <Icon name="download" size={18} />
                免费下载 Windows 版
              </Link>
              <Link href="/pricing/" className="btn btn-ghost">
                查看定价
                <Icon name="arrow" size={17} />
              </Link>
            </div>
            <div className="hero-meta">
              <span className="meta-chip">无需注册</span>
              <span className="meta-chip">完全离线</span>
              <span className="meta-chip">免费版不限图层</span>
            </div>
          </div>

          <EditorMock />
        </div>
      </section>

      <section className="section" id="features">
        <div className="shell">
          <div className="section-head">
            <h2 className="section-title">为像素作画而生的编辑器</h2>
            <p className="section-sub">
              去掉用不上的功能，把画笔、图层、动画和保存做到顺手。每一个交互都为像素画服务。
            </p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="feature-card">
                <span className="feature-icon">
                  <Icon name={f.icon} size={19} />
                </span>
                <div className="feature-title">{f.title}</div>
                <p className="feature-text">{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="shell">
          <div className="section-head">
            <h2 className="section-title">三步开始</h2>
            <p className="section-sub">没有注册流程，没有初始化向导，下载完就能落笔。</p>
          </div>
          <div className="step-grid">
            {STEPS.map((s) => (
              <div key={s.num} className="step">
                <div className="step-num">{s.num}</div>
                <div className="step-title">{s.title}</div>
                <p className="step-text">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="shell">
          <div className="section-head">
            <h2 className="section-title">免费开始，需要时再升级</h2>
            <p className="section-sub">
              免费版不限图层、不限时长。Pro 面向动画导出与高阶工作流，按年订阅最划算。
            </p>
          </div>
          <PriceGrid ids={["free", "yearly", "lifetime"]} />
          <div style={{ marginTop: 20 }}>
            <Link href="/pricing/" className="btn btn-ghost btn-sm">
              查看完整定价与功能对照
              <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section section--alt" id="faq">
        <div className="shell">
          <div className="section-head">
            <h2 className="section-title">常见问题</h2>
          </div>
          <div className="faq">
            {faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <div className="cta-band">
            <div>
              <h2 className="cta-title">现在就把想法画成像素</h2>
              <p className="cta-sub">Windows 版免费下载，解压即用，不需要账号。</p>
            </div>
            <div className="cta-actions">
              <Link href="/download/" className="btn btn-primary">
                <Icon name="download" size={18} />
                免费下载
              </Link>
              <Link href="/pricing/" className="btn btn-ghost">
                了解 Pro
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
