import Link from "next/link";
import { Logo } from "./logo";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <span className="brand">
            <span className="brand-mark">
              <Logo size={22} />
            </span>
            <span className="brand-name">PixelArtist</span>
          </span>
          <p className="footer-note">{site.description}</p>
        </div>

        <div className="footer-col">
          <div className="footer-col-title">产品</div>
          <Link href="/download/">下载</Link>
          <Link href="/pricing/">定价</Link>
          <Link href="/#features">功能</Link>
        </div>

        <div className="footer-col">
          <div className="footer-col-title">账号</div>
          <Link href="/account/">登录 / 注册</Link>
          <Link href="/pricing/">Pro 订阅</Link>
          <Link href="/#faq">常见问题</Link>
        </div>
      </div>

      <div className="shell footer-bottom">
        <span>© {new Date().getFullYear()} PixelArtist</span>
        <span>
          版本 v{site.version} · {site.releaseDate}
        </span>
      </div>
    </footer>
  );
}
