"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/download/", label: "下载" },
  { href: "/pricing/", label: "定价" },
  { href: "/account/", label: "账号" },
];

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="PixelArtist 首页">
          <span className="brand-mark">
            <Logo size={24} />
          </span>
          <span className="brand-name">PixelArtist</span>
        </Link>

        <nav className="nav" aria-label="主导航">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${active ? " is-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link href="/download/" className="btn btn-primary btn-sm header-cta">
          免费下载
        </Link>
      </div>
    </header>
  );
}
