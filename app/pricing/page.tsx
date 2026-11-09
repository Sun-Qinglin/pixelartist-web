import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { PriceGrid } from "@/components/price-grid";
import { comparisons, faqs } from "@/lib/site";

export const metadata: Metadata = {
  title: "定价",
  description: "PixelArtist 免费版与 Pro 定价：年付 ¥68、永久 ¥128，会员到期不删除作品、不加水印。",
};

export default function PricingPage() {
  return (
    <>
      <div className="shell">
        <header className="page-head">
          <h1 className="page-title">简单透明的定价</h1>
          <p className="page-sub">
            免费版不限图层、不限时长。需要动画导出与高阶导出时再升级 Pro，按年订阅最划算。
          </p>
        </header>

        <div style={{ marginTop: 34 }}>
          <PriceGrid />
        </div>

        <p className="auth-note" style={{ maxWidth: 720 }}>
          学生认证可享 5 折优惠；首发期活动价格以站内公告为准。
          会员到期后作品仍然保留、导出不加水印，仅 Pro 专属功能暂时不可用，续费后立即恢复。
        </p>

        <section className="section" style={{ paddingTop: 56, paddingLeft: 0, paddingRight: 0 }}>
          <div className="section-head">
            <h2 className="section-title">免费版与 Pro 功能对照</h2>
            <p className="section-sub">只把真正高阶的能力放进 Pro，核心作画体验不打折。</p>
          </div>
          <div className="compare-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>功能</th>
                  <th>免费版</th>
                  <th>Pro</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className={row.free === "—" ? "is-no" : "is-yes"}>{row.free}</td>
                    <td className={row.pro === "—" ? "is-no" : "is-yes"}>{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
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
        </section>

        <div className="cta-band" style={{ marginBottom: 72 }}>
          <div>
            <h2 className="cta-title">先免费画起来</h2>
            <p className="cta-sub">下载免费版，之后随时可以在客户端内升级 Pro。</p>
          </div>
          <div className="cta-actions">
            <Link href="/download/" className="btn btn-primary">
              <Icon name="download" size={18} />
              免费下载
            </Link>
            <Link href="/account/" className="btn btn-ghost">
              账号与订阅
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
