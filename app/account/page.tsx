import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import LoginForm from "./_components/login-form";

export const metadata: Metadata = {
  title: "账号",
  description: "登录 PixelArtist 账号，管理 Pro 订阅与设备授权。",
};

const BENEFITS = [
  "动画导出（GIF / 精灵表）",
  "批量帧导出",
  "Pro 专属工具与素材",
  "优先问题支持",
];

export default function AccountPage() {
  return (
    <>
      <div className="shell">
        <header className="page-head">
          <h1 className="page-title">账号与 Pro</h1>
          <p className="page-sub">
            用邮箱登录后即可在此查看订阅状态、管理设备；或在客户端内凭激活码离线解锁 Pro。
          </p>
        </header>

        <div className="auth-grid">
          <LoginForm />

          <section className="card">
            <h2 className="release-title" style={{ marginTop: 0, fontSize: 18 }}>
              订阅状态
            </h2>

            <div className="pro-status" style={{ marginTop: 16 }}>
              <div>
                <div className="pro-status-name">免费版</div>
                <div className="pro-status-sub">Pro 状态将在登录后同步</div>
              </div>
              <span className="status-pill">免费版</span>
            </div>

            <div className="sub-title" style={{ marginTop: 24 }}>
              Pro 包含
            </div>
            <ul className="plain-list">
              {BENEFITS.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>

            <p className="auth-note">
              会员到期不删除作品、不加水印，续费即恢复 Pro 功能；客户端离线支持激活码解锁。
            </p>

            <div className="download-actions" style={{ marginTop: 18 }}>
              <Link href="/pricing/" className="btn btn-ghost">
                查看定价
                <Icon name="arrow" size={16} />
              </Link>
            </div>
          </section>
        </div>
      </div>

      <div style={{ height: 72 }} />
    </>
  );
}
