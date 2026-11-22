# AI 素材生成网关

PixelArtist 客户端内置了「AI 素材」面板，但**不持有任何模型厂商的 key**。
所有生成请求都发到这里的 `/api/ai/*`，由服务端换取额度和转发到 Retro Diffusion。

```
Godot 客户端                   本网关 (Next.js)              Retro Diffusion
  │ 激活码 → 换 JWT             │                              │
  ├── POST /api/ai/session ─────>│ 验 HMAC 签名 + 绑设备         │
  │<── token (12h) + 额度 ──────┤                              │
  ├── POST /api/ai/generate ────>│ 扣额度 → 翻提示词 ───────────>│ POST /v2/inferences
  │<── task_id ─────────────────┤                              │
  ├── GET /api/ai/task/{id} ────>│ 校验归属 ───────────────────>│ GET /v2/inferences/tasks/{id}
  │<── base64 PNG ──────────────┤                              │
```

## 部署三步

**1. 建表**

Supabase Dashboard → SQL Editor → 执行 `scripts/schema-ai.sql`。
幂等，可以重复跑。执行完确认能看到 `ai_devices` / `ai_usage` / `ai_generations` 三张表
和 `ai_bind_device` / `ai_consume_quota` / `ai_refund_quota` 三个函数。

> 这三张表只给 `service_role` 用，客户端（publishable key）读不到，
> 所以别人拿不到你的客户额度数据，也改不了用量。

**2. 配环境变量**

复制 `.env.example` 里「AI 素材生成网关」那一段到 `.env.local`（或部署平台）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `RETRO_DIFFUSION_API_KEY` | ✅ | `retrodiffusion.ai` → Account → API 创建，形如 `rdpk-...` |
| `AI_JWT_SECRET` | ✅ | 给客户端通行证签名，≥32 位随机串；换掉会让所有已发出的通行证失效 |
| `AI_TRANSLATE_PROVIDER` | ❌ | `deepseek` / `openai` / `gemini`，不配就原样使用用户输入 |
| `AI_TRANSLATE_KEY` | ❌ | 翻译模型 key；不配时中文提示词直传，理解质量会差一些 |
| `RETRO_DIFFUSION_BASE_URL` | ❌ | 只在自建代理 / 测试环境时才需要 |
| `AI_QUOTA_STORE` | ❌ | `supabase`（默认，生产）或 `memory`（仅本地开发，见下） |

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**3. 部署**

和网站一起部署（Vercel 等）。没有额外的服务、没有额外的数据库，四个路由都是动态路由。

> ⚠️ `/api/ai/generate` 一定是 `async=true` 转发——同步等 RD 出图要 10–20 秒，
> 会被 Serverless 函数超时掐断。客户端自己轮询 `/api/ai/task/{id}` 取图。

## 本地开发：连不上 Supabase 怎么办

Supabase 在国内经常被网络阻断，表现为 DNS 解析正常但 TCP 被重置：

```
dns   : OK  [104.18.38.10, 172.64.246]
fetch : FAIL  ECONNRESET read ECONNRESET
```

这种情况下把 `.env.local` 设成：

```
AI_QUOTA_STORE=memory
```

额度、设备绑定、任务归属全部改存在 Node 进程内存里：

- **不需要 Supabase，也不需要跑 `schema-ai.sql`**，整条链路（换通行证 → 扣额度 → 轮询 → 退款）都能在本地验证
- `next dev` 热重载或重启后清零 —— 对调 UI 来说反而是优点
- Supabase 那几项环境变量留着不管，memory 模式不会碰它们

> ⚠️ **生产环境绝不能设 `memory`**，那等于完全没有额度限制。
> Vercel 不读 `.env.local`，所以只要不把它写进 Vercel 的环境变量，线上就一直是安全的 `supabase`。

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/ai/session` | 激活码 | 换 12h 通行证 + 当前额度；不传激活码则按设备走匿名试用 |
| GET | `/api/ai/styles` | Bearer | 代理 RD 风格目录，只暴露 `rd_fast` / `rd_core`，缓存 24h |
| POST | `/api/ai/generate` | Bearer | 扣额度 → 翻译提示词 → 提交任务；`check_cost_only:true` 只询价 |
| GET | `/api/ai/task/{id}` | Bearer | 轮询转发；失败自动退额度并把流水标成 `refunded` |

**为什么客户端不直接用 RD：** key 不落地客户端、能计量能限流、能封号、
能随时换模型或改提示词策略而不用发新版本。

## 额度与成本

数值都在 `lib/ai/policy.ts`，改一处全生效：

| 档位 | 额度 | RD 成本（Fast $0.03/张） |
| --- | --- | --- |
| permanent / yearly | 200 张/月 | ≈ $6/月 |
| monthly | 100 张/月 | ≈ $3/月 |
| student | 80 张/月 | ≈ $2.4/月 |
| 匿名试用 | 2 张/天 | ≈ $0.06/天/设备 |

`MONTHLY_QUOTA` 里的数字是按「最便宜的 Fast 档」算的。如果用户把模型切到
`rd_core`（$0.10/张），实际成本是 3 倍多——调整额度或按档位分额度之前，先算一遍单位经济。

其它策略：一码最多 3 台设备（`MAX_DEVICES_PER_CODE`）、通行证 12 小时（`TOKEN_TTL_SECONDS`）、
单次最多 4 张（`MAX_IMAGES_PER_REQUEST`）。

## 运维

**看某个客户的用量 / 流水**

```sql
select * from ai_usage where subject = 'PA2L0000000000XXXXXXXX' order by period_key desc;
select * from ai_generations where subject = 'PA2L0000000000XXXXXXXX' order by created_at desc limit 20;
```

`subject` 是**归一化后的激活码**（大写、去掉横线），例如
`PA2-L-0000000000-EEYKYXNO-XSMMYAAA` → `PA2L0000000000EEYKYXNOXSMMYAAA`。
匿名试用的 subject 形如 `anon:<sha256 设备指纹>`。

**手动补额度**

```sql
update ai_usage set used = 0 where subject = '...' and period_key = 'M:2026-02';
```

**给某台设备解绑**

```sql
delete from ai_devices where device_id = '...';
```

**排错对照**

| 现象 | 原因 |
| --- | --- |
| 客户端提示「AI 服务未配置（缺少 AI_JWT_SECRET）」 | 服务端没配密钥，或密钥不足 16 位 |
| 「该激活码已绑定 N 台设备」 | 超设备上限，删 `ai_devices` 记录或调大 `MAX_DEVICES_PER_CODE` |
| 「风格目录获取失败」 | RD key 无效 / 网络不通；客户端会退回内置风格列表继续可用 |
| 一直 `pending` / 最后超时 | RD 队列慢；客户端 150 秒后放弃，但图可能还在生成，可在 `ai_generations` 里按 `task_id` 追 |
| 生成失败但额度没退 | 检查 `ai_generations.status` 是否已经 `refunded`（重复轮询不会重复退） |

## 上线前必须确认的事

**Retro Diffusion 的商用条款**。你的付费用户拿到的是生成结果的商用授权，
要确认 RD 的服务条款允许把输出转售 / 交付给终端用户。这属于商业授权问题，
代码层面无法规避——先查条款或直接问他们要书面授权，再开卖。
