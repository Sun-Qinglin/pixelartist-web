// ============================================================
// 激活码导出工具（A 路线：激活码 + 发卡平台）
// ------------------------------------------------------------
// 把 scripts/_batch 下生成好的码，导出成发卡平台可直接导入的格式。
//
// 用法:
//   node scripts/export-cards.mjs --tier yearly --batch 20 --out cards
//   node scripts/export-cards.mjs --tier permanent
//
// 参数:
//   --tier   yearly | permanent | student | monthly（默认 yearly）
//   --batch  每批多少个码切一个文件（默认 0 = 不切）
//   --out    输出目录（默认 scripts/_batch/cards）
//   --format single(默认) | pair
//           single = 一行一个卡密（独角数卡/发卡喵等通用）
//           pair   = 卡号+卡密两列，卡号自动编号
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const tier = arg("tier", "yearly");
const batchSize = parseInt(arg("batch", "0"), 10);
const outDir = arg("out", join("scripts", "_batch", "cards"));
const format = arg("format", "single");

// 允许显式指定源文件，否则自动挑最新的 {tier}*.csv
const explicit = arg("src", "");
const batchDir = join("scripts", "_batch");
function pickSource() {
  if (explicit) return explicit;
  if (!existsSync(batchDir)) return "";
  const candidates = readdirSync(batchDir)
    .filter((f) => f.startsWith(tier) && f.endsWith(".csv"))
    .map((f) => join(batchDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] || "";
}

const csvPath = pickSource();
if (!csvPath) {
  console.error(`✗ ${batchDir} 下找不到 ${tier}*.csv`);
  console.error("  请先运行: node scripts/gen-licenses.mjs --tier " + tier + " --count N");
  process.exit(1);
}
console.log(`源文件: ${csvPath}`);

const rows = readFileSync(csvPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1) // 去掉表头
  .map((line) => line.split(","))
  .filter((cols) => cols[0]);

const codes = rows.map((cols) => cols[0]);
const expiresAt = Number(rows[0]?.[2] || 0);

mkdirSync(outDir, { recursive: true });

function render(lines) {
  if (format === "pair") {
    return lines.map((code, i) => `PA-${String(i + 1).padStart(4, "0")},${code}`).join("\n") + "\n";
  }
  return lines.join("\n") + "\n";
}

const written = [];
if (batchSize > 0 && batchSize < codes.length) {
  let n = 0;
  for (let i = 0; i < codes.length; i += batchSize) {
    n += 1;
    const slice = codes.slice(i, i + batchSize);
    const name = `${tier}-batch-${String(n).padStart(2, "0")}.txt`;
    writeFileSync(join(outDir, name), render(slice), "utf8");
    written.push({ name, count: slice.length });
  }
} else {
  const name = `${tier}-all.txt`;
  writeFileSync(join(outDir, name), render(codes), "utf8");
  written.push({ name, count: codes.length });
}

console.log(`✓ 档位: ${tier}   有效期: ${expiresAt === 0 ? "永久" : new Date(expiresAt * 1000).toISOString().slice(0, 10)}`);
console.log(`✓ 共 ${codes.length} 个码，输出目录: ${outDir}`);
for (const w of written) console.log(`   ${w.name}  (${w.count} 个)`);
console.log("");
console.log("下一步: 在发卡平台「商品 → 库存/卡密」里粘贴 txt 内容，或直接上传文件。");
