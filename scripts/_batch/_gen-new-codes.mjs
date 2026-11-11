// 生成 130 个唯一新格式激活码 + SQL 批量导入脚本
import fs from "node:fs";
import { issueCode, validateCode } from "../../lib/license.mjs";

const now = Math.floor(Date.now() / 1000);
const yearlyExp = now + 365 * 86400;
const studentExp = now + 180 * 86400;

const codes = [];
for (let i = 0; i < 100; i++)
  codes.push({
    code: issueCode("yearly", yearlyExp),
    tier: "yearly",
    type_letter: "Y",
    expires_at: yearlyExp,
    batch_note: `首发年付第1批 #${i + 1}`,
  });
for (let i = 0; i < 10; i++)
  codes.push({
    code: issueCode("permanent", 0),
    tier: "permanent",
    type_letter: "L",
    expires_at: 0,
    batch_note: `首发永久赠送 #${i + 1}`,
  });
for (let i = 0; i < 20; i++)
  codes.push({
    code: issueCode("student", studentExp),
    tier: "student",
    type_letter: "S",
    expires_at: studentExp,
    batch_note: `首发学生优惠 #${i + 1}`,
  });

// 唯一性 + 自验
const unique = new Set(codes.map((c) => c.code)).size;
console.log(`总码数: ${codes.length}, 唯一: ${unique === codes.length ? "✅" : "❌"}`);
for (const c of codes.slice(0, 3)) {
  const v = validateCode(c.code);
  console.log(`  ${c.code} → valid=${v.ok} tier=${v.tier}`);
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

const rows = codes.map(
  (c) =>
    `  ('${esc(c.code)}', '${esc(c.tier)}', '${esc(c.type_letter)}', ${
      c.expires_at
    }, '${esc(c.batch_note)}')`
);

const sql = `-- PixelArtist 激活码批量导入 (新格式, 每个码唯一)
-- 生成时间: ${new Date().toISOString()}
-- yearly × 100 (过期 ${new Date(yearlyExp * 1000)
  .toISOString()
  .slice(0, 10)}) + permanent × 10 + student × 20 (过期 ${new Date(
  studentExp * 1000
).toISOString().slice(0, 10)})

begin;
delete from public.license_codes;

insert into public.license_codes (code, tier, type_letter, expires_at, batch_note)
values
${rows.join(",\n")}
on conflict (code) do nothing;

commit;

-- 验证: select count(*), tier from public.license_codes group by tier;
`;

fs.writeFileSync("scripts/_batch/import-codes.sql", sql, "utf8");

// 同时写 CSV 方便发卡平台导入
const yearlyCsv = "code,tier,expires_at\n" + codes.filter(c => c.tier==="yearly").map(c=>`${c.code},${c.tier},${c.expires_at}`).join("\n") + "\n";
const permCsv = "code,tier,expires_at\n" + codes.filter(c => c.tier==="permanent").map(c=>`${c.code},${c.tier},${c.expires_at}`).join("\n") + "\n";
const stuCsv = "code,tier,expires_at\n" + codes.filter(c => c.tier==="student").map(c=>`${c.code},${c.tier},${c.expires_at}`).join("\n") + "\n";
fs.writeFileSync("scripts/_batch/yearly-100.csv", yearlyCsv, "utf8");
fs.writeFileSync("scripts/_batch/permanent-10.csv", permCsv, "utf8");
fs.writeFileSync("scripts/_batch/student-20.csv", stuCsv, "utf8");

// 同时生成 TXT
fs.writeFileSync("scripts/_batch/yearly-100.txt", codes.filter(c=>c.tier==="yearly").map((c,i)=>`${String(i+1).padStart(4,' ')}.  ${c.code}`).join("\n")+"\n", "utf8");
fs.writeFileSync("scripts/_batch/permanent-10.txt", codes.filter(c=>c.tier==="permanent").map((c,i)=>`${String(i+1).padStart(4,' ')}.  ${c.code}`).join("\n")+"\n", "utf8");
fs.writeFileSync("scripts/_batch/student-20.txt", codes.filter(c=>c.tier==="student").map((c,i)=>`${String(i+1).padStart(4,' ')}.  ${c.code}`).join("\n")+"\n", "utf8");

console.log(`✅ SQL: scripts/_batch/import-codes.sql (${codes.length} 个码)`);
console.log(`✅ CSV/TXT: yearly-100, permanent-10, student-20 均已刷新`);
