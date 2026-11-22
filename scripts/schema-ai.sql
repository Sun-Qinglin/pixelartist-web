-- ============================================================
-- PixelArtist AI 素材生成 —— Supabase 增量 Schema
-- ============================================================
-- 依赖 scripts/schema.sql 里的 public.license_codes（激活码池）。
-- 在 Supabase Dashboard → SQL Editor 里执行本文件即可，可重复执行（幂等）。
--
-- 设计要点：
--   * 三张表全部只允许 service_role 访问（建 RLS 但不建 policy + 显式 revoke），
--     客户端即使拿到 publishable key 也读不到别人的额度。
--   * 额度按月计；匿名试用按天计。period_key 统一形如 "M:2026-02" / "D:2026-02-14"。
--   * 扣减走 RPC + for update 行锁，避免并发超发。
--   * 生成流水单独存一张表，出问题能按 subject 追溯每一次调用。
-- ============================================================

-- ---- 1. ai_devices：激活码 ↔ 设备绑定 ----
-- 一个激活码最多绑 N 台设备（N 在应用层配置，默认 3），防止一码多人群发。
create table if not exists public.ai_devices (
  device_id    text primary key,
  license_code text not null,          -- 已归一化：大写、去横线
  created_at   timestamptz default now(),
  last_seen    timestamptz default now()
);

create index if not exists idx_ai_devices_code on public.ai_devices (license_code);


-- ---- 2. ai_usage：额度用量 ----
create table if not exists public.ai_usage (
  subject    text not null,            -- 激活码（归一化）或 "anon:<device_id>"
  period_key text not null,            -- "M:2026-02" | "D:2026-02-14"
  used       int  not null default 0,
  quota      int  not null,
  updated_at timestamptz default now(),
  primary key (subject, period_key)
);


-- ---- 3. ai_generations：每次生成的流水（对账 / 风控 / 客诉追溯）----
create table if not exists public.ai_generations (
  id            bigserial primary key,
  subject       text not null,
  device_id     text,
  task_id       text unique,
  rd_request_id text,
  style         text,
  width         int,
  height        int,
  num_images    int default 1,
  cost          numeric(10, 4) default 0,
  quota_charged int default 0,
  prompt_user   text,
  prompt_final  text,
  status        text not null default 'created'
                check (status in ('created', 'running', 'succeeded', 'failed', 'refunded')),
  error         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_ai_generations_subject
  on public.ai_generations (subject, created_at desc);
create index if not exists idx_ai_generations_pending
  on public.ai_generations (status) where status in ('created', 'running');


-- ---- 4. RLS：锁死，只留 service_role ----
alter table public.ai_devices     enable row level security;
alter table public.ai_usage       enable row level security;
alter table public.ai_generations enable row level security;

-- 不创建任何 policy = anon / authenticated 一律读不到；
-- Next.js 路由用 SUPABASE_SECRET_KEY（service_role）绕过 RLS 读写。
revoke all on public.ai_devices     from anon, authenticated;
revoke all on public.ai_usage       from anon, authenticated;
revoke all on public.ai_generations from anon, authenticated;


-- ---- 5. ai_bind_device：把设备绑到激活码上，超过上限就拒绝 ----
-- 返回 ok=false 时 reason 取值：device_bound_elsewhere | device_limit
create or replace function public.ai_bind_device(
  p_device_id    text,
  p_license_code text,
  p_max_devices  int
)
returns table (ok boolean, reason text, bound int)
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner text;
  v_bound int;
begin
  select d.license_code into v_owner
    from public.ai_devices d
   where d.device_id = p_device_id;

  select count(*) into v_bound
    from public.ai_devices d
   where d.license_code = p_license_code;

  if v_owner is not null then
    if v_owner <> p_license_code then
      return query select false, 'device_bound_elsewhere'::text, v_bound;
      return;
    end if;
    update public.ai_devices d
       set last_seen = now()
     where d.device_id = p_device_id;
    return query select true, ''::text, v_bound;
    return;
  end if;

  if v_bound >= greatest(p_max_devices, 1) then
    return query select false, 'device_limit'::text, v_bound;
    return;
  end if;

  insert into public.ai_devices (device_id, license_code)
  values (p_device_id, p_license_code)
  on conflict (device_id) do update
     set license_code = excluded.license_code,
         last_seen    = now();

  return query select true, ''::text, v_bound + 1;
end;
$$;


-- ---- 6. ai_consume_quota：原子扣额度 ----
-- 行不存在时自动建行（首次使用），然后用 for update 锁行再判断，避免并发超发。
create or replace function public.ai_consume_quota(
  p_subject text,
  p_period  text,
  p_quota   int,
  p_amount  int
)
returns table (ok boolean, used int, quota int)
language plpgsql
security definer set search_path = public
as $$
declare
  v_used  int;
  v_quota int;
  v_ask   int := greatest(p_amount, 0);
begin
  insert into public.ai_usage (subject, period_key, used, quota)
  values (p_subject, p_period, 0, greatest(p_quota, 0))
  on conflict (subject, period_key) do update
     set quota = greatest(excluded.quota, ai_usage.quota);

  select u.used, u.quota into v_used, v_quota
    from public.ai_usage u
   where u.subject = p_subject and u.period_key = p_period
     for update;

  if v_used + v_ask > v_quota then
    return query select false, v_used, v_quota;
    return;
  end if;

  update public.ai_usage u
     set used = u.used + v_ask,
         updated_at = now()
   where u.subject = p_subject and u.period_key = p_period
   returning u.used into v_used;

  return query select true, v_used, v_quota;
end;
$$;


-- ---- 7. ai_refund_quota：生成失败时把额度退回去 ----
create or replace function public.ai_refund_quota(
  p_subject text,
  p_period  text,
  p_amount  int
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.ai_usage u
     set used = greatest(u.used - greatest(p_amount, 0), 0),
         updated_at = now()
   where u.subject = p_subject and u.period_key = p_period;
end;
$$;


-- ---- 8. 权限：函数只给 service_role ----
revoke all on function public.ai_bind_device(text, text, int) from public, anon, authenticated;
revoke all on function public.ai_consume_quota(text, text, int, int) from public, anon, authenticated;
revoke all on function public.ai_refund_quota(text, text, int) from public, anon, authenticated;

grant execute on function public.ai_bind_device(text, text, int) to service_role;
grant execute on function public.ai_consume_quota(text, text, int, int) to service_role;
grant execute on function public.ai_refund_quota(text, text, int) to service_role;

grant select, insert, update on public.ai_devices     to service_role;
grant select, insert, update on public.ai_usage       to service_role;
grant select, insert, update on public.ai_generations to service_role;
grant usage, select on sequence public.ai_generations_id_seq to service_role;


-- ============================================================
-- 自检：执行完可以跑下面两句确认表与函数都在
-- ============================================================
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name like 'ai_%';
-- select routine_name from information_schema.routines
--  where routine_schema = 'public' and routine_name like 'ai_%';
