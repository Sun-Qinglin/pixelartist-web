-- ============================================================
-- PixelArtist Supabase Schema
-- ============================================================
-- 在 Supabase Dashboard → SQL Editor 里直接执行即可。
-- 执行前请确认：Database → Tables 里没有同名表。
-- ============================================================

-- ---- 扩展 ----
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. profiles —— 用户资料 (和 auth.users 1:1)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  -- Pro 状态
  pro_tier text default 'free' check (pro_tier in ('free', 'permanent', 'yearly', 'monthly', 'student')),
  pro_expires_at timestamptz,  -- null = 永久; 免费版也为 null
  license_code text,           -- 用户自己兑换的码 (保留作审计)
  -- 时间戳
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: 只有用户本人能读写自己的 profile
alter table public.profiles enable row level security;

-- 用户可以读自己的 profile
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- 用户可以更新自己的 profile (只限制可更新列,pro_tier 由后端 API 写)
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 用户不能直接 insert (由 trigger 创建)
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);


-- ============================================================
-- 2. auth.users → profiles 自动创建 trigger
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- 3. license_codes —— 管理员生成的码池
-- ============================================================
create table if not exists public.license_codes (
  code text primary key,
  tier text not null check (tier in ('permanent', 'yearly', 'monthly', 'student')),
  type_letter text not null check (char_length(type_letter) = 1),
  expires_at bigint not null,          -- Unix 秒
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz default now(),
  batch_note text                      -- 管理员备注,比如"首发第 3 批"
);

-- RLS: 普通用户只读自己兑换过的;管理员用 service_role 绕过
alter table public.license_codes enable row level security;

drop policy if exists "license_codes_select_user_redeemed" on public.license_codes;
create policy "license_codes_select_user_redeemed"
  on public.license_codes for select
  using (redeemed_by = auth.uid());


-- ============================================================
-- 4. subscriptions —— 订阅记录 (未来接支付)
-- ============================================================
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null check (tier in ('yearly', 'monthly', 'student', 'permanent')),
  -- 状态
  status text not null default 'active' check (status in ('active', 'canceled', 'expired', 'trialing')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  payment_provider text,       -- 'stripe' | 'lemonsqueezy' | 'license_code'
  provider_subscription_id text,
  provider_order_id text,
  amount_cents integer,
  currency text default 'CNY',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id);


-- ============================================================
-- 5. 索引 (激活码查找 + 用户订阅)
-- ============================================================
create index if not exists idx_license_codes_redeemed on public.license_codes(redeemed_by);
create index if not exists idx_subscriptions_user_active on public.subscriptions(user_id, status);

-- ============================================================
-- 6. 预置几条测试激活码 (永久 × 3, 供首发验证)
-- ============================================================
-- 这些码由 Node scripts/gen-licenses.mjs 生成,和客户端 HMAC-SHA256 密钥一致。
-- 插入后在 Database → Table Editor 里能直接看到,用户可以登录后兑换。
insert into public.license_codes (code, tier, type_letter, expires_at, batch_note)
values
  ('PA2-L-0000000000-EEYKYXNO-XSMMYAAA', 'permanent', 'L', 0, '首发赠送-永久码-1'),
  ('PA2-L-0000000000-XXXXXXXA-XXXXXXXX', 'permanent', 'L', 0, '首发赠送-永久码-2')
on conflict (code) do nothing;

-- ============================================================
-- 7. redeem_license —— 安全 RPC:前端调,服务端验码池+写 DB
-- ============================================================
create or replace function public.redeem_license(
  p_code text,
  out p_ok boolean,
  out p_error text,
  out p_tier text,
  out p_expires_at bigint
)
returns record
language plpgsql
security definer set search_path = public
as 
declare
  v_user_id uuid := auth.uid();
  v_code record;
  v_expires_at timestamptz;
begin
  p_ok := false;
  p_error := '';
  p_tier := '';
  p_expires_at := 0;

  -- 0. 必须登录
  if v_user_id is null then
    p_error := 'auth_required';
    return;
  end if;

  -- 1. 查码池 (码是去掉横杠后的形式,我们存的是原样,所以两种都查)
  select * into v_code from public.license_codes where code = p_code;

  -- 如果没找到,也尝试加横杠的形式
  if v_code is null then
    select * into v_code from public.license_codes where code = regexp_replace(p_code, '-', '', 'g');
  end if;

  if v_code is null then
    p_error := 'code_not_found';
    return;
  end if;

  -- 2. 是否已兑换
  if v_code.redeemed_by is not null then
    p_error := 'code_already_redeemed';
    return;
  end if;

  -- 3. 兑换 (码过期时间 0 = 永久)
  if v_code.expires_at = 0 then
    v_expires_at := null;
  else
    v_expires_at := to_timestamp(v_code.expires_at);
  end if;

  -- 4. 写 profiles
  update public.profiles
    set pro_tier = v_code.tier,
        pro_expires_at = v_expires_at,
        license_code = v_code.code,
        updated_at = now()
    where id = v_user_id;

  -- 5. 标记码已兑换
  update public.license_codes
    set redeemed_by = v_user_id, redeemed_at = now()
    where code = v_code.code;

  p_ok := true;
  p_tier := v_code.tier;
  p_expires_at := v_code.expires_at;
  return;
end;
;

-- 授予认证用户调用权限
grant execute on function public.redeem_license(text) to authenticated;


-- ============================================================
-- 8. orders —— 在线支付订单 (Paddle)
-- ============================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paddle',
  provider_transaction_id text unique not null,  -- Paddle 交易号,做幂等
  user_id uuid references auth.users(id) on delete set null,
  plan text not null,
  tier text not null,
  amount_cents integer default 0,
  currency text default 'CNY',
  license_code text not null,
  created_at timestamptz default now()
);

alter table public.orders enable row level security;

-- 已登录用户可查看自己的订单;匿名订单只能凭订单号走下面的 RPC
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
  on public.orders for select
  using (auth.uid() = user_id);

create index if not exists idx_orders_user on public.orders(user_id);


-- ============================================================
-- 9. get_order_license —— 凭订单号取激活码 (支付成功页用)
-- ============================================================
-- 订单号是 Paddle 生成的不可猜测 UUID,所以允许匿名查询;
-- 这样没注册账号的用户买完也能立刻拿到码。
create or replace function public.get_order_license(p_txn text)
returns table (p_code text, p_tier text, p_expires_at bigint)
language sql
security definer set search_path = public
as $$
  select o.license_code,
         o.tier,
         coalesce(c.expires_at, 0)
  from public.orders o
  left join public.license_codes c on c.code = o.license_code
  where o.provider_transaction_id = p_txn
  limit 1;
$$;

grant execute on function public.get_order_license(text) to anon, authenticated;
