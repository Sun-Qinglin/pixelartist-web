"use client";

import { useEffect, useState } from "react";
import { createClient, type User } from "@supabase/supabase-js";

// 环境变量在部署平台粘贴时容易混入引号、反引号或空白,先清洗再使用。
const clean = (v?: string) => (v ?? "").replace(/[`"'\s]/g, "");

const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const anonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) || clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const CONFIGURED = Boolean(url && anonKey);
const supabase = CONFIGURED ? createClient(url, anonKey, {
  auth: {
    persistSession: true,
    detectSessionInUrl: false,  // 禁用自动检测, 全靠 useEffect 里手动 exchangeCodeForSession 处理, 避免竞争
    autoRefreshToken: true,
  },
}) : null;

type Profile = {
  pro_tier: string;
  pro_expires_at: string | null;
  license_code: string | null;
};



const TIER_LABEL: Record<string, string> = {
  free: "免费版",
  permanent: "永久 Pro",
  yearly: "年付 Pro",
  monthly: "月付 Pro",
  student: "学生 Pro",
};

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 拿当前登录用户 + profile
  // 直接查 profiles (RLS 只允许读自己)
  const fetchMe = async () => {
    if (!supabase) return;
    setMeLoading(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) { setUser(null); setProfile(null); return; }
      const { data: prof } = await supabase
        .from("profiles").select("*").eq("id", uid).single();
      if (prof) setProfile(prof);
    } catch {} finally { setMeLoading(false); }
  };

  useEffect(() => {
    if (!supabase) return;

    // 显式处理 magic link 跳转: URL 里带 ?ticket=xxx&type=xxx
    // Supabase SDK 自动 detectSessionInUrl 默认开启,但这里加显式调用 + 日志方便排查
    const params = new URLSearchParams(window.location.search);
    const ticket = params.get("ticket");
    const type = params.get("type");
    const errorDesc = params.get("error_description");

    if (errorDesc) {
      setError(decodeURIComponent(errorDesc));
      console.warn("[auth] Supabase 回调错误:", errorDesc);
    }

    if (ticket) {
      console.log("[auth] 检测到 magic link ticket,开始交换 session, type=", type);
      supabase.auth.exchangeCodeForSession(ticket).then(({ data, error }) => {
        if (error) {
          console.error("[auth] exchangeCodeForSession 失败:", error);
          setError("登录链接已失效或服务器拒绝: " + error.message);
        } else {
          console.log("[auth] exchangeCodeForSession 成功, user:", data.session?.user?.email);
          // 交换完成后清掉 URL 里的 ticket,防止刷新时重复交换
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("ticket");
          cleanUrl.searchParams.delete("type");
          window.history.replaceState({}, "", cleanUrl.toString());
          setUser(data.session?.user ?? null);
          setTimeout(fetchMe, 150);
        }
      }).catch((err) => {
        console.error("[auth] exchangeCodeForSession 异常:", err);
        setError("登录流程异常,请刷新重试");
      });
      return; // ticket 交换完再走后续订阅,避免状态竞争
    }

    // 常规路径: 已有 session 就同步 + 订阅变化
    supabase.auth.getUser().then(({ data }) => {
      console.log("[auth] 初始 getUser:", data.user ? data.user.email : "无用户");
      setUser(data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[auth] onAuthStateChange:", event, session?.user?.email ?? "");
      setUser(session?.user ?? null);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setTimeout(fetchMe, 100);
      }
    });
    setTimeout(fetchMe, 100);
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend() {
    if (!supabase || !email) return;
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/account" },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handleSignOut() {
    await supabase?.auth.signOut();
    setProfile(null);
  }

  async function handleRedeem() {
    if (!supabase) return;
    const code = redeemCode.trim();
    if (!code || redeeming) return;
    setRedeeming(true); setRedeemMsg(null);
    try {
      const { data, error } = await supabase.rpc("redeem_license", { p_code: code });
      if (error) { setRedeemMsg({ ok: false, text: "RPC 错误: " + error.message }); }
      else if (data && data.p_ok) {
        const tl = TIER_LABEL[data.p_tier] ?? data.p_tier;
        setRedeemMsg({ ok: true, text: "✅ 激活成功:" + tl });
        setRedeemCode(""); fetchMe();
      } else {
        const m = data?.p_error ?? "兑换失败";
        const map: Record<string,string> = { code_not_found: "激活码无效", code_already_redeemed: "此码已兑换", auth_required: "请先登录" };
        const f = map[m] ?? m;
        setRedeemMsg({ ok: false, text: "✗ " + f });
      }
    } catch { setRedeemMsg({ ok: false, text: "✗ 网络错误" }); }
    finally { setRedeeming(false); }
  }
  // ============================================
  // Supabase 未配置 —— 占位
  // ============================================
  if (!CONFIGURED) {
    return (
      <section className="card">
        <h2 className="release-title" style={{ marginTop: 0, fontSize: 18 }}>
          登录 / 注册
        </h2>
        <p className="auth-note" style={{ marginTop: 8 }}>
          账号系统即将开放。部署 Supabase 后,在 <code>.env.local</code> 填入{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> 和{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> 即可启用邮箱魔法链接登录。
        </p>
        <p className="auth-note">
          在此之前,客户端支持离线使用与激活码解锁 Pro,无需注册。
        </p>
      </section>
    );
  }

  // ============================================
  // 已登录 —— 显示状态 + 激活码兑换
  // ============================================
  if (user) {
    const tier = profile?.pro_tier ?? "free";
    const isPro = tier !== "free";
    const tierLabel = TIER_LABEL[tier] ?? tier;
    const expiresStr =
      profile?.pro_expires_at === null || profile?.pro_expires_at === undefined
        ? "永久"
        : tier === "free"
          ? "—"
          : new Date(profile!.pro_expires_at!).toLocaleDateString("zh-CN");

    return (
      <>
        <section className="card">
          <h2 className="release-title" style={{ marginTop: 0, fontSize: 18 }}>
            账号
          </h2>
          <div className="pro-status" style={{ marginTop: 16 }}>
            <div>
              <div className="pro-status-name">{user.email ?? user.id}</div>
              <div className="pro-status-sub">
                {meLoading ? "加载中…" : `Pro: ${tierLabel}`}
              </div>
            </div>
            <span
              className="status-pill"
              style={
                isPro
                  ? { background: "var(--ok)", color: "#000" }
                  : undefined
              }
            >
              {isPro ? "Pro" : "免费版"}
            </span>
          </div>

          <div className="download-actions" style={{ marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
              退出登录
            </button>
          </div>
        </section>

        {/* 激活码兑换 */}
        <section className="card" style={{ marginTop: 16 }}>
          <h2 className="release-title" style={{ marginTop: 0, fontSize: 18 }}>
            激活码兑换
          </h2>
          <p className="auth-note" style={{ marginTop: 8 }}>
            如果你有 PixelArtist Pro 激活码,输入下方解锁你的账号 Pro 状态。
          </p>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="redeem-code">激活码</label>
            <input
              id="redeem-code"
              className="input"
              type="text"
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              placeholder="PA2-L-0000000000-XXXXXXXX-XXXXXXXX"
              style={{ fontFamily: "monospace", letterSpacing: 1 }}
              autoComplete="off"
            />
          </div>

          {redeemMsg && (
            <p
              className="auth-note"
              style={{
                marginTop: 10,
                color: redeemMsg.ok ? "var(--ok)" : "#ff6b6b",
              }}
            >
              {redeemMsg.text}
            </p>
          )}

          <div className="download-actions" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={redeeming || !redeemCode.trim()}
              onClick={handleRedeem}
            >
              {redeeming ? "兑换中…" : "兑换激活码"}
            </button>
          </div>

          {profile?.license_code && (
            <p className="auth-note" style={{ marginTop: 14, fontSize: 12 }}>
              当前激活码: <code>{profile.license_code}</code>
              {profile.pro_expires_at && (
                <>
                  <br />
                  到期时间: {expiresStr}
                </>
              )}
            </p>
          )}
        </section>
      </>
    );
  }

  // ============================================
  // 未登录 —— magic-link 表单
  // ============================================
  return (
    <section className="card">
      <h2 className="release-title" style={{ marginTop: 0, fontSize: 18 }}>
        登录 / 注册
      </h2>
      <p className="auth-note" style={{ marginTop: 8 }}>
        输入邮箱,我们会发送一次性登录链接,无需记密码。
      </p>

      {sent && (
        <p className="auth-note" style={{ color: "var(--ok)", marginTop: 10 }}>
          ✓ 链接已发送,请查收 <strong>{email}</strong> 的邮箱。
        </p>
      )}
      {error && (
        <p className="auth-note" style={{ color: "#ff6b6b", marginTop: 10 }}>
          ✗ {error}
        </p>
      )}

      <div className="field">
        <label htmlFor="account-email">邮箱</label>
        <input
          id="account-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>

      <div className="download-actions" style={{ marginTop: 18 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || !email}
          onClick={handleSend}
        >
          {loading ? "发送中…" : sent ? "重新发送链接" : "发送登录链接"}
        </button>
      </div>
    </section>
  );
}
