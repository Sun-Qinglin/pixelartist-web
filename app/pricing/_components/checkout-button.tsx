"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";

export function CheckoutButton({ planId }: { planId: string }) {
  const [loading, setLoading] = useState(false);
  const isFree = planId === "free";

  async function handleBuy() {
    if (isFree || loading) return;
    setLoading(true);
    try {
      // 已登录时带上 token,支付成功后 Pro 自动开通
      let token: string | undefined;
      const supabase = getSupabase();
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token;
      }

      const res = await fetch("/api/paddle/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();

      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      alert(
        data.error === "支付未配置"
          ? "在线支付尚未开通，请先在「账号」页用激活码兑换。"
          : "打开支付页失败：" + (data.error || "未知错误")
      );
    } catch (e: any) {
      alert("网络错误：" + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={"btn " + (isFree ? "btn-ghost" : "btn-primary")}
      disabled={loading || isFree}
      onClick={handleBuy}
      style={{ width: "100%" }}
    >
      {isFree ? "免费版" : loading ? "跳转支付中…" : "立即购买 →"}
    </button>
  );
}
