"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

type OrderLicense = {
  p_code: string;
  p_tier: string;
  p_expires_at: number;
};

const TIER_LABEL: Record<string, string> = {
  permanent: "永久版",
  yearly: "年付版",
  monthly: "月付版",
  student: "学生版",
};

export default function PurchaseSuccessPage() {
  const [txn, setTxn] = useState("");
  const [data, setData] = useState<OrderLicense | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (txnId: string) => {
    const supabase = getSupabase();
    if (!supabase) {
      setError("站点尚未配置 Supabase");
      setLoading(false);
      return;
    }
    const { data: rows, error: rpcErr } = await supabase.rpc("get_order_license", {
      p_txn: txnId,
    });
    if (rpcErr) {
      setError(rpcErr.message);
    } else if (rows && rows.length > 0) {
      setData(rows[0] as OrderLicense);
      setError("");
    } else {
      // 支付成功但 webhook 还没处理完,给个友好提示
      setError("订单还在确认中，通常几秒后就好。");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("_ptxn") || params.get("txn") || "";
    setTxn(id);
    if (!id) {
      setError("缺少订单号");
      setLoading(false);
      return;
    }
    load(id);
    // webhook 可能有延迟,自动重试三次
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > 3) {
        clearInterval(timer);
        return;
      }
      load(id);
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function copyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.p_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 剪贴板不可用时让用户手动选
    }
  }

  return (
    <div className="shell" style={{ maxWidth: 720, paddingTop: 72, paddingBottom: 96 }}>
      <h1 className="page-title" style={{ marginBottom: 10 }}>
        {data ? "支付成功" : loading ? "正在确认订单…" : "订单确认中"}
      </h1>

      {data ? (
        <>
          <p className="page-sub" style={{ marginBottom: 26 }}>
            你的激活码已经生成。复制后在客户端
            <strong> 帮助 → 输入激活码… </strong>
            里粘贴即可解锁 Pro。
          </p>

          <div
            style={{
              background: "var(--panel)",
              border: "1px solid rgba(94,224,160,0.35)",
              borderRadius: 14,
              padding: "22px 24px",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--muted, #8a929e)", marginBottom: 10 }}>
              {TIER_LABEL[data.p_tier] ?? data.p_tier}
              {data.p_expires_at > 0
                ? ` · 有效期至 ${new Date(data.p_expires_at * 1000).toLocaleDateString("zh-CN")}`
                : " · 永久有效"}
            </div>
            <div
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 19,
                letterSpacing: "0.5px",
                wordBreak: "break-all",
                color: "var(--ok, #5ee0a0)",
                lineHeight: 1.5,
              }}
            >
              {data.p_code}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={copyCode}
              style={{ marginTop: 18 }}
            >
              {copied ? "已复制 ✓" : "复制激活码"}
            </button>
          </div>

          <p className="auth-note" style={{ marginTop: 22 }}>
            如果你在付款前已经登录本站，Pro 已自动开通，无需再手动输入。
          </p>

          <div style={{ marginTop: 30, display: "flex", gap: 12 }}>
            <Link href="/download/" className="btn btn-ghost">
              下载客户端
            </Link>
            <Link href="/account/" className="btn btn-ghost">
              我的账号
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="page-sub">
            {error || "正在向支付服务确认这笔订单。"}
          </p>
          {txn ? (
            <p className="auth-note" style={{ wordBreak: "break-all" }}>
              订单号：{txn}
            </p>
          ) : null}
          <div style={{ marginTop: 28, display: "flex", gap: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (!txn) return;
                setLoading(true);
                load(txn);
              }}
            >
              重新查询
            </button>
            <Link href="/pricing/" className="btn btn-ghost">
              返回定价
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
