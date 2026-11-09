"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

const TIER_LABEL: Record<string, string> = {
  permanent: "永久版",
  yearly: "年付版",
  monthly: "月付版",
  student: "学生版",
};

const STEPS = [
  {
    n: "1",
    title: "复制激活码",
    desc: "购买后你会拿到一串 PA2 开头的码，形如 PA2-Y-1825755004-XXXXXXXX-XXXXXXXX。",
  },
  {
    n: "2",
    title: "打开客户端",
    desc: "启动 PixelArtist，点顶部菜单「帮助 → 输入激活码…」。",
  },
  {
    n: "3",
    title: "粘贴并解锁",
    desc: "粘贴激活码点确认，提示激活成功即可导出 GIF、精灵表和批量帧。",
  },
];

export default function RedeemPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("code");
    if (fromUrl) setCode(fromUrl.toUpperCase());

    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setLoggedIn(Boolean(data.user)));
  }, []);

  const bind = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setMsg({ ok: false, text: "站点尚未配置后端" });
      return;
    }
    const value = code.trim();
    if (!value) {
      setMsg({ ok: false, text: "请先输入激活码" });
      return;
    }
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("redeem_license", { p_code: value });
    setBusy(false);

    if (error) {
      setMsg({ ok: false, text: "查询失败：" + error.message });
      return;
    }
    if (data?.p_ok) {
      const label = TIER_LABEL[data.p_tier] ?? data.p_tier;
      setMsg({ ok: true, text: `已绑定到账号：${label}` });
    } else {
      const map: Record<string, string> = {
        code_not_found: "激活码不存在，请检查是否输错",
        code_already_redeemed: "这个码已经被绑定过账号了",
        auth_required: "请先用邮箱登录后再绑定",
      };
      setMsg({ ok: false, text: map[data?.p_error] ?? (data?.p_error || "绑定失败") });
    }
  }, [code]);

  return (
    <div className="shell" style={{ maxWidth: 760, paddingTop: 64, paddingBottom: 96 }}>
      <h1 className="page-title" style={{ marginBottom: 8 }}>
        激活 PixelArtist Pro
      </h1>
      <p className="page-sub" style={{ marginBottom: 30 }}>
        激活码在客户端本地校验，不需要联网、也不需要账号。三步就能用上 Pro。
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        {STEPS.map((s) => (
          <div
            key={s.n}
            style={{
              display: "flex",
              gap: 14,
              background: "var(--panel)",
              border: "1px solid var(--border, rgba(255,255,255,0.08))",
              borderRadius: 12,
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                flex: "0 0 28px",
                height: 28,
                borderRadius: 8,
                background: "var(--accent, #f2913d)",
                color: "#14161a",
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
                fontSize: 14,
              }}
            >
              {s.n}
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 14, color: "var(--muted, #8a929e)", lineHeight: 1.6 }}>
                {s.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 34,
          padding: "22px 22px 24px",
          background: "var(--panel)",
          border: "1px solid var(--border, rgba(255,255,255,0.08))",
          borderRadius: 14,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>可选：绑定到账号</div>
        <p style={{ fontSize: 14, color: "var(--muted, #8a929e)", marginBottom: 14, lineHeight: 1.6 }}>
          绑定只是让你在网站「账号」页看到 Pro 状态，方便以后找回。不绑定也完全不影响客户端使用。
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PA2-Y-0000000000-XXXXXXXX-XXXXXXXX"
            spellCheck={false}
            style={{
              flex: "1 1 320px",
              minWidth: 0,
              padding: "11px 13px",
              borderRadius: 9,
              border: "1px solid var(--border, rgba(255,255,255,0.12))",
              background: "var(--bg, #14161a)",
              color: "inherit",
              fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              fontSize: 14,
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={bind}
            disabled={busy}
          >
            {busy ? "绑定中…" : loggedIn ? "绑定到账号" : "登录后绑定"}
          </button>
        </div>

        {msg ? (
          <p
            style={{
              marginTop: 14,
              fontSize: 14,
              color: msg.ok ? "var(--ok, #5ee0a0)" : "#ff8080",
            }}
          >
            {msg.ok ? "✓ " : "✗ "}
            {msg.text}
          </p>
        ) : null}

        {!loggedIn ? (
          <p className="auth-note" style={{ marginTop: 14 }}>
            想绑定的话先去 <Link href="/account/">账号页</Link> 用邮箱登录。
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 30, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/download/" className="btn btn-ghost">
          下载客户端
        </Link>
        <Link href="/pricing/" className="btn btn-ghost">
          查看定价
        </Link>
      </div>
    </div>
  );
}
