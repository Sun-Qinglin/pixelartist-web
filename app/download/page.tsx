import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { release } from "@/lib/release";

export const metadata: Metadata = {
  title: "下载",
  description: "下载 PixelArtist Windows 版，免费使用，解压即用。",
};

export default function DownloadPage() {
  return (
    <>
      <div className="shell">
        <header className="page-head">
          <h1 className="page-title">下载 PixelArtist</h1>
          <p className="page-sub">
            免费版不限图层、不限时长，全部绘图工具与 PNG 导出都可以用。解压即用，不需要注册。
          </p>
        </header>

        <div className="download-grid">
          <section className="card">
            <div className="release-tag">
              <span className="status-pill">{release.channel}</span>
              <span className="meta-chip">Windows 64 位</span>
            </div>

            <h2 className="release-title">版本 v{release.version}</h2>
            <div className="release-meta">
              {release.platform} · 发布于 {release.date} · 大小 {release.size}
            </div>

            <div className="download-actions">
              {release.downloadReady ? (
                <a className="btn btn-primary" href={release.downloadPath}>
                  <Icon name="windows" size={18} />
                  下载安装包
                </a>
              ) : (
                <span className="btn btn-primary is-disabled" aria-disabled="true">
                  <Icon name="windows" size={18} />
                  安装包准备中
                </span>
              )}
              <Link className="btn btn-ghost" href="#changelog">
                查看更新日志
              </Link>
            </div>

            <p className="download-hint">
              {release.downloadReady
                ? "下载后解压到任意目录，双击 PixelArtist.exe 即可运行。"
                : "首发版本正在打包，开放后会在这里直接下载。届时无需账号即可获取。"}
            </p>

            <div className="sub-title">SHA-256 校验</div>
            <div className="hash">{release.sha256}</div>
          </section>

          <section className="card">
            <h2 className="release-title" style={{ marginTop: 0, fontSize: 18 }}>
              系统要求
            </h2>
            <ul className="plain-list" style={{ marginTop: 16 }}>
              {release.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>

            <div className="sub-title" style={{ marginTop: 26 }}>
              许可
            </div>
            <ul className="plain-list">
              <li>免费版永久可用，无需注册</li>
              <li>Pro 功能需订阅或买断</li>
              <li>会员到期不删除作品、不加水印</li>
            </ul>
          </section>
        </div>

        <section className="card" id="changelog" style={{ marginTop: 18 }}>
          <h2 className="release-title" style={{ marginTop: 0, fontSize: 18 }}>
            v{release.version} 更新日志
          </h2>
          <ul className="plain-list" style={{ marginTop: 16 }}>
            {release.changelog.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="section">
        <div className="shell">
          <div className="cta-band">
            <div>
              <h2 className="cta-title">需要动画导出与批量导出？</h2>
              <p className="cta-sub">Pro 提供 GIF、精灵表与批量帧导出，年付 ¥68。</p>
            </div>
            <div className="cta-actions">
              <Link href="/pricing/" className="btn btn-primary">
                查看 Pro
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
