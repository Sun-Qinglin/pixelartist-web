/**
 * AI 网关的身份层：激活码 → 短期 JWT，之后每次请求只认 Bearer token。
 *
 * 为什么不用 Supabase 账号登录：
 *   Godot 客户端现在的登录是纯本地（user://identity.cfg），没有云端账号。
 *   而激活码本身已经带 HMAC 签名 + 过期时间，服务端能独立验真，
 *   所以「填一个激活码就换到一张 12 小时的通行证」是最贴合当前产品形态的做法，
 *   用户不用注册第二套账号，客户端也不用保存 RD 的 key。
 *
 * token 用 HS256 自签，不引入任何新依赖（node:crypto 自带）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { TOKEN_TTL_SECONDS } from "./policy";

export interface TokenClaims {
  /** 归一化激活码；匿名试用为 "anon:<device_id>" */
  sub: string;
  tier: string;
  /** 设备指纹，用于风控与设备绑定 */
  dev: string;
  iat: number;
  exp: number;
}

export type AuthResult =
  | { ok: true; claims: TokenClaims }
  | { ok: false; status: number; error: string };

/** 部署平台粘贴环境变量时容易混入引号、反引号或空白，先清洗再使用 */
function jwtSecret(): string {
  return (process.env.AI_JWT_SECRET || "").trim().replace(/[`"'\s]/g, "");
}

export function isAuthConfigured(): boolean {
  // 太短的密钥等价于没配，直接当未配置处理，避免上线跑一个可被爆破的签名
  return jwtSecret().length >= 16;
}

/** 激活码归一化：统一成大写、去掉横线与空白，作为数据库里的 subject */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[-\s]/g, "");
}

export function anonSubject(deviceId: string): string {
  return `anon:${deviceId}`;
}

export function isAnonSubject(subject: string): boolean {
  return subject.startsWith("anon:");
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const rest = input.length % 4;
  const padded = rest === 0 ? input : input + "=".repeat(4 - rest);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * 签发 token。secret 未配置时抛错，由路由层翻译成 500。
 */
export function signToken(sub: string, tier: string, dev: string): { token: string; exp: number } {
  const secret = jwtSecret();
  if (!secret) throw new Error("AI_JWT_SECRET 未配置");
  const now = Math.floor(Date.now() / 1000);
  const claims: TokenClaims = {
    sub,
    tier,
    dev,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64urlEncode(JSON.stringify(claims));
  const signature = b64urlEncode(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  return { token: `${header}.${payload}.${signature}`, exp: claims.exp };
}

/** 校验 token；任何异常一律返回 null（调用方翻译成 401） */
export function verifyToken(token: string): TokenClaims | null {
  const secret = jwtSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const given = b64urlDecode(signature);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  let claims: TokenClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString("utf8")) as TokenClaims;
  } catch {
    return null;
  }

  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  if (typeof claims.tier !== "string" || !claims.tier) return null;
  if (typeof claims.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= claims.exp) return null;

  return claims;
}

/** 从 Authorization: Bearer xxx 里取 token */
export function bearerFrom(request: Request): string | null {
  const raw = request.headers.get("authorization") || "";
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** 路由的第一道关卡：配置检查 + Bearer 校验 */
export function authenticate(request: Request): AuthResult {
  if (!isAuthConfigured()) {
    return { ok: false, status: 500, error: "AI 服务未配置" };
  }
  const token = bearerFrom(request);
  if (!token) {
    return { ok: false, status: 401, error: "未授权，请先激活" };
  }
  const claims = verifyToken(token);
  if (!claims) {
    return { ok: false, status: 401, error: "登录已过期，请重新激活" };
  }
  return { ok: true, claims };
}
