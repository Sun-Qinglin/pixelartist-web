// PixelArtist 激活码签名模块
// 与 Godot 客户端 LicenseValidator.gd 使用相同密钥、相同 base32、相同 HMAC-SHA256 截前 8 字节。
// 本模块为 Next.js API Route 和 scripts/gen-licenses.mjs 共用的单一可信源。
//
// 码格式: PA2-{type}{10位过期秒}-{sig前8}-{sig后8}
// 示例:   PA2-L-0000000000-EEYKYXNO-XSMMYAAA

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = Buffer.from([
  0x32, 0x77, 0x8a, 0xc4, 0x51, 0x9e, 0x0d, 0xb6,
  0x4f, 0x2a, 0x71, 0x88, 0x15, 0xc3, 0x09, 0xdd,
  0x82, 0xa6, 0xef, 0x4b, 0x17, 0x3c, 0x6d, 0x90,
  0x21, 0xb4, 0x7e, 0x58, 0xfa, 0x03, 0x6c, 0xa9,
]);

const MAGIC = "PA2";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TIER_LETTERS = {
  permanent: "L",
  yearly: "Y",
  monthly: "M",
  student: "S",
};

// ==== Base32 (RFC 4648, 零填充 'A') ====

function base32Encode(buf) {
  let out = "";
  let bitBuf = 0;
  let bitCount = 0;
  for (const b of buf) {
    bitBuf = (bitBuf << 8) | b;
    bitCount += 8;
    while (bitCount >= 5) {
      const idx = (bitBuf >>> (bitCount - 5)) & 0x1f;
      out += BASE32_ALPHABET[idx];
      bitCount -= 5;
    }
  }
  if (bitCount > 0) {
    const idx = (bitBuf << (5 - bitCount)) & 0x1f;
    out += BASE32_ALPHABET[idx];
  }
  while (out.length < 16) out += "A";
  return out;
}

function base32Decode(str) {
  const out = [];
  let bitBuf = 0;
  let bitCount = 0;
  for (const c of str.toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx < 0) return null;
    bitBuf = (bitBuf << 5) | idx;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      out.push((bitBuf >>> bitCount) & 0xff);
    }
  }
  return Buffer.from(out);
}

// ==== HMAC-SHA256 截前 8 字节 ====

function sign(payload) {
  const hmac = createHmac("sha256", SECRET);
  hmac.update(payload, "ascii");
  const full = hmac.digest();
  const first8 = full.subarray(0, 8);
  return base32Encode(first8);
}

// ==== 随机 nonce (6 字符 base32 = 30 bit 熵,避免同档位同过期时间的码相互重复) ====

function randomNonce6() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let n = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  // 取低 30 bit,转 6 字符 base32 (每 5 bit 一个字符)
  n = n >>> 2;
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += BASE32_ALPHABET[(n >>> ((5 - i - 1) * 5)) & 0x1f];
  }
  return out;
}

// ==== 发码 ====
// 码格式: PA2-{type}-{10位过期秒}-{nonce6}-{sig8}-{sig8}
// payload(签名对象) = type + expStr + nonce = 17 字符

export function issueCode(tier, expiresAt, nonce) {
  const type = TIER_LETTERS[tier];
  if (!type) throw new Error(`未知档位: ${tier}`);
  const expStr = String(Math.max(0, Math.min(9999999999, Math.floor(expiresAt)))).padStart(10, "0");
  const n = nonce || randomNonce6();
  const payload = type + expStr + n;
  const sig = sign(payload);
  return `${MAGIC}-${type}-${expStr}-${n}-${sig.slice(0, 8)}-${sig.slice(8, 16)}`;
}

// ==== 验码 ====
// 新格式: PA2-{type}-{10位过期秒}-{nonce6}-{sig8}-{sig8}
// 去掉横线后总长度: 35 (MAGIC=3 + body=32)
//   body: 1 type + 10 exp + 6 nonce + 16 sig = 33 ??? 算一下
// 其实去掉横线后: PA2 Y 10字符 6字符 16字符 = 3+1+10+6+16 = 36
// 让我再数一遍：PA2-Y-1825755004-XXXXXX-XXXXXXXX-XXXXXXXX
// 去掉横线: PA2Y1825755004XXXXXX XXXXXXXX XXXXXXXX → 等下让我数
//   PA2 + Y + 10(exp) + 6(nonce) + 16(sig) = 3+1+10+6+16 = 36
//   body = 36 - 3 = 33
export function validateCode(code, { checkExpired = true } = {}) {
  const cleaned = code.trim().toUpperCase().replace(/-/g, "");
  if (!cleaned.startsWith(MAGIC))
    return { ok: false, reason: "格式不对: 必须以 PA2 开头" };
  const body = cleaned.slice(MAGIC.length);
  if (body.length !== 33)
    return { ok: false, reason: "长度不对: 去掉横线后 PA2 + 33 字符" };

  // payload = type(1) + exp(10) + nonce(6) = 17
  const payload = body.slice(0, 17);
  const sig = body.slice(17);

  const type = payload[0];
  if (!Object.values(TIER_LETTERS).includes(type))
    return { ok: false, reason: `未知类型字母: ${type}` };

  const expiresAt = parseInt(payload.slice(1, 11), 10);
  if (isNaN(expiresAt) || expiresAt < 0)
    return { ok: false, reason: "过期时间字段无效" };

  // nonce: payload.slice(11, 17) —— 不用单独存, 因为签名已包含它

  // HMAC 签名校验 (constant-time)
  const expectedSig = sign(payload);
  const given = base32Decode(sig);
  const exp = base32Decode(expectedSig);
  if (!given || !exp || given.length < 8 || exp.length < 8)
    return { ok: false, reason: "签名无法解码" };

  try {
    if (!timingSafeEqual(given.subarray(0, 8), exp.subarray(0, 8)))
      return { ok: false, reason: "签名不匹配" };
  } catch {
    return { ok: false, reason: "签名校验失败" };
  }

  // 过期校验
  if (checkExpired && expiresAt > 0 && Math.floor(Date.now() / 1000) >= expiresAt)
    return { ok: false, reason: "码已过期", tier: "", expiresAt };

  const tierName = Object.entries(TIER_LETTERS).find(([, v]) => v === type)?.[0];
  return { ok: true, tier: tierName, type, expiresAt };
}
