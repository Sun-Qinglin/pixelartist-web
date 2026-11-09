#!/usr/bin/env node
/**
 * PixelArtist 激活码批量生成器
 * —— 与 Godot 客户端 LicenseValidator.gd + Next.js API 路由
 *    使用同一密钥 + 同一 HMAC-SHA256 + 同一 base32 编码。
 *
 * 用法:
 *   node scripts/gen-licenses.mjs --tier yearly --count 10 --days 365
 *   node scripts/gen-licenses.mjs --tier permanent --count 3
 *   node scripts/gen-licenses.mjs --tier student --count 5 --days 180
 *   node scripts/gen-licenses.mjs --verify PA2-L-0000000000-EEYKYXNO-XSMMYAAA
 */

import { writeFileSync } from "node:fs";
import { issueCode, validateCode } from "../lib/license.mjs";

const TIER_DEFAULT_DAYS = { yearly: 365, monthly: 30, student: 180 };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      out[k] = argv[i + 1] ?? true;
      if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) i++;
    }
  }
  return out;
}

function help() {
  const tty = process.stdout.isTTY;
  const B = tty ? "\x1b[1m" : "";
  const R = tty ? "\x1b[0m" : "";
  console.log(`${B}PixelArtist 激活码生成器${R}

${B}用法:${R}
  node scripts/gen-licenses.mjs --tier <tier> --count <n> [--days <d>] [--out file.txt]
  node scripts/gen-licenses.mjs --verify <code>

${B}档位:${R}
  permanent  永久 (L)
  yearly     年付 (Y)
  monthly    月付 (M)
  student    学生 (S)

${B}示例:${R}
  node scripts/gen-licenses.mjs --tier yearly --count 10
  node scripts/gen-licenses.mjs --tier permanent --count 3
  node scripts/gen-licenses.mjs --verify PA2-L-0000000000-EEYKYXNO-XSMMYAAA`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) { help(); return; }

  // --verify 模式
  if (args.verify) {
    const v = validateCode(args.verify);
    if (v.ok) {
      const exp = v.expiresAt === 0 ? "永久" : new Date(v.expiresAt * 1000).toISOString().slice(0, 10);
      console.log(`✅ 有效激活码`);
      console.log(`   档位    : ${v.tier}`);
      console.log(`   类型    : ${v.type}`);
      console.log(`   过期时间: ${exp}`);
    } else {
      console.log(`❌ 无效激活码 — ${v.reason}`);
    }
    return;
  }

  const tier = args.tier;
  const count = parseInt(args.count || "1", 10);
  const days = parseInt(args.days || "0", 10);
  const outFile = args.out || null;

  const VALID_TIERS = ["permanent", "yearly", "monthly", "student"];
  if (!tier || !VALID_TIERS.includes(tier)) {
    console.error(`错误: --tier 必须是 ${VALID_TIERS.join(" | ")}`);
    process.exit(1);
  }
  if (!count || count < 1 || count > 10000) {
    console.error(`错误: --count 范围 1-10000`);
    process.exit(1);
  }

  // 计算过期秒
  let expiresAt = 0;
  if (tier !== "permanent") {
    const actualDays = days > 0 ? days : TIER_DEFAULT_DAYS[tier];
    expiresAt = Math.floor(Date.now() / 1000) + actualDays * 86400;
  }

  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(issueCode(tier, expiresAt));
  }

  const expiresLabel =
    tier === "permanent" ? "永久" : new Date(expiresAt * 1000).toISOString().slice(0, 10);

  const header = `PixelArtist 激活码 - ${tier} × ${count} - 过期 ${expiresLabel}\n`;
  const body = codes.map((c, i) => `${String(i + 1).padStart(4, " ")}.  ${c}`).join("\n") + "\n";
  const output = header + "\n" + body + "\n";

  if (outFile) {
    writeFileSync(outFile, output, "utf8");
    console.log(`✅ 已写入 ${outFile} (${count} 个码)`);
  } else {
    process.stdout.write("\n" + output);
  }

  // 同目录生成 CSV
  if (outFile) {
    const csvPath = outFile.replace(/\.[^.]+$/, ".csv");
    const csv = "code,tier,expires_at\n" +
      codes.map((c) => `${c},${tier},${expiresAt}`).join("\n") + "\n";
    writeFileSync(csvPath, csv, "utf8");
    console.log(`   同目录还生成了 CSV: ${csvPath}`);
  }
}

main();
