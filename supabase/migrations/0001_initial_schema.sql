-- =============================================================================
-- incantochen MVP — 0001_initial_schema
-- 依 docs/data-model.md（v1 定稿）建立 13 張表（不增不刪表）
-- 對應任務：T03（建表）。RLS 屬 T46，不在本支。
-- migration 工具：Supabase CLI（手寫 SQL，docs/migration-guide.md）
-- -----------------------------------------------------------------------------
-- ⚠️  RLS 尚未啟用：本支只建表，未 ENABLE ROW LEVEL SECURITY、未建任何 policy。
--     依 migration-guide §3/§7，RLS 排在 T46 獨立 migration、且須先 plan mode。
--     在 T46 完成前，這些表「不可」對前端 anon/authenticated 公開——
--     所有存取一律走後端 / service role。請勿在此窗口期接上前端讀寫。
-- -----------------------------------------------------------------------------
-- 命名定稿：實體表名 snake_case 單數，對齊 13 張表詞彙；唯一例外——
--     `Order` 為 SQL 保留字，實體表命名為 `orders`（避免全專案 SQL 加引號）。
--     其餘 order_item / order_status_log 維持 `order_` 前綴（非保留字）。
-- -----------------------------------------------------------------------------
-- 外鍵刪除策略（兩類）：
--   • 帳務鏈一律 RESTRICT（保留，不連動刪）：orders / order_item / payment /
--     order_status_log / notification 對 orders；items・cart_item 對 product。
--   • 設定圖與暫態 CASCADE：option 三層圖、cart→cart_item、member profile→auth。
-- -----------------------------------------------------------------------------
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop table if exists notification, order_status_log, payment, order_item,
--     orders, cart_item, cart, member, product_option_value, product_option,
--     option_value, option_type, product cascade;
--   drop function if exists public.set_updated_at();
--   drop type if exists invoice_status, payment_status, order_status,
--     product_status, option_applies_to, product_category;
-- =============================================================================


-- =============================================================================
-- 0. 列舉型別（enum）——三個 status 一律 enum，杜絕非法狀態
-- =============================================================================

-- 品類（Product.category）
create type product_category as enum ('ring', 'earring', 'bracelet', 'necklace');

-- 選項適用品類（OptionType.applies_to，層1）；all = 全品類共通
create type option_applies_to as enum ('all', 'ring', 'earring', 'bracelet', 'necklace');

-- 商品上下架狀態
create type product_status as enum ('draft', 'active', 'archived');

-- 訂單狀態（code 形式；中文對照：
--   pending_payment 待付款 / paid 已付款 / in_production 製作中 /
--   shipped 已出貨 / completed 已完成 / cancelled 已取消 / refunded 已退款）
create type order_status as enum (
  'pending_payment', 'paid', 'in_production', 'shipped',
  'completed', 'cancelled', 'refunded'
);

-- 付款狀態（含 refunded，對應 T47 退款）
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');

-- 發票狀態（佔位；allowance 折讓 / voided 作廢之會計流程 ⚖️ 待會計確認，
-- 屆時可 ALTER TYPE ... ADD VALUE 擴充，不需改本支）
create type invoice_status as enum ('none', 'issued', 'allowance', 'voided');


-- =============================================================================
-- 1. 共用：updated_at 自動更新函式
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =============================================================================
-- 2. 商品與選項（白名單三層：applies_to → ProductOption → ProductOptionValue）
-- =============================================================================

-- 2.1 Product
create table public.product (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  category    product_category not null,
  base_price  numeric(12, 0) not null check (base_price >= 0),   -- 底價（NT$ 整數元）
  status      product_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2.2 OptionType（層1）
-- 註：數量(quantity)不是選項，已移除——數量走 cart_item / order_item.quantity。
create table public.option_type (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,        -- gem_color / metal_color / ring_size / length / earring_back
  name        text not null,
  applies_to  option_applies_to not null,  -- 層1 適用品類
  input_type  text not null check (input_type in ('swatch', 'select', 'stepper')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2.3 OptionValue
create table public.option_value (
  id              uuid primary key default gen_random_uuid(),
  option_type_id  uuid not null references public.option_type (id) on delete cascade,
  code            text not null,
  label           text not null,           -- 祖母綠 / 18K黃金 / #11
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (option_type_id, code)
);

-- 2.4 ProductOption（層2：此款套用哪些選項）
create table public.product_option (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.product (id) on delete cascade,
  option_type_id  uuid not null references public.option_type (id) on delete restrict,
  required        bool not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (product_id, option_type_id)
);

-- 2.5 ProductOptionValue（層3：此款此值的白名單＋加價）
create table public.product_option_value (
  id                 uuid primary key default gen_random_uuid(),
  product_option_id  uuid not null references public.product_option (id) on delete cascade,
  option_value_id    uuid not null references public.option_value (id) on delete restrict,
  price_delta        numeric(12, 0) not null default 0 check (price_delta >= 0),  -- 此值加價
  is_default         bool not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (product_option_id, option_value_id)
);


-- =============================================================================
-- 3. 會員與購物車
-- =============================================================================

-- 3.1 Member —— 共用 PK：id = auth.users.id（id = auth.uid()）
create table public.member (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  name        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3.2 Cart —— 會員或訪客；訪客以 guest_token 識別（放 httpOnly cookie）
create table public.cart (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid references public.member (id) on delete cascade,  -- 可空：訪客
  guest_token  uuid,                                                  -- 訪客識別子
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 會員或訪客至少一個有值（結帳即會員時可由 guest_token 併入）
  constraint cart_owner_present check (member_id is not null or guest_token is not null)
);

-- 3.3 CartItem —— 加車當下寫快照
create table public.cart_item (
  id                   uuid primary key default gen_random_uuid(),
  cart_id              uuid not null references public.cart (id) on delete cascade,
  product_id           uuid not null references public.product (id) on delete restrict,
  quantity             int not null check (quantity > 0),
  unit_price_snapshot  numeric(12, 0) not null check (unit_price_snapshot >= 0),  -- 快照單價
  config_snapshot      jsonb not null,                                            -- 快照規格（契約見 data-model §4.2）
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);


-- =============================================================================
-- 4. 訂單與金流（注意：實體表名為 orders）
-- =============================================================================

-- 4.1 Order（orders）—— 內嵌收件與物流；發票欄位佔位
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.member (id) on delete restrict,  -- 帳務：不連動刪
  order_no         text not null unique,
  status           order_status not null default 'pending_payment',
  -- 內嵌收件
  recipient_name   text not null,
  recipient_phone  text not null,
  shipping_address text not null,
  tracking_no      text,                       -- 人工填（黑貓宅配單號）
  -- 金額（NT$ 整數元）
  subtotal         numeric(12, 0) not null check (subtotal >= 0),
  shipping_fee     numeric(12, 0) not null default 0 check (shipping_fee >= 0),
  total_amount     numeric(12, 0) not null check (total_amount >= 0),
  -- 客製例外同意（T57）
  custom_consent   bool not null default false,
  consent_at       timestamptz,
  -- 電子發票佔位（T42；折讓/作廢會計流程 ⚖️ 待會計確認）
  invoice_no       text,
  invoice_status   invoice_status not null default 'none',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 4.2 OrderItem —— 下單當下釘住價格與規格（不可變，故無 updated_at）
create table public.order_item (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete restrict,
  product_id           uuid not null references public.product (id) on delete restrict,
  quantity             int not null check (quantity > 0),
  unit_price_snapshot  numeric(12, 0) not null check (unit_price_snapshot >= 0),
  config_snapshot      jsonb not null,
  created_at           timestamptz not null default now()
);

-- 4.3 Payment —— 重試換新 merchant_trade_no、掛同一張訂單；含綠界 gateway 欄位
create table public.payment (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete restrict,
  merchant_trade_no text not null unique,        -- 我方交易號（重試換新）
  gateway_trade_no  text,                         -- 綠界 TradeNo（對帳 T27 / 退刷 T47）
  provider          text not null default 'ecpay',
  status            payment_status not null default 'pending',
  amount            numeric(12, 0) not null check (amount > 0),
  raw_callback      jsonb,                        -- 回拋／訂單查詢原始內容（稽核、防重放）
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 冪等鎖：每張訂單最多一筆 status='paid'（落實「狀態只前進一次」，T53）
create unique index uq_payment_one_paid_per_order
  on public.payment (order_id)
  where (status = 'paid');


-- =============================================================================
-- 5. 通知與狀態
-- =============================================================================

-- 5.1 OrderStatusLog —— append-only 稽核（不可變，故無 updated_at）
create table public.order_status_log (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete restrict,
  from_status  text,
  to_status    text not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- 5.2 Notification —— 寄信紀錄（append-only）；關鍵信去重
create table public.notification (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete restrict,
  channel    text not null default 'email',
  type       text not null,
  status     text not null default 'sent',   -- sent / failed
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  -- 同一訂單同一類型只寄一次（防重寄，呼應 T53 冪等）
  unique (order_id, type)
);


-- =============================================================================
-- 6. 索引（外鍵與查詢路徑；唯一鍵已自帶索引）
-- =============================================================================

create index idx_product_category_status   on public.product (category, status);
create index idx_option_value_type         on public.option_value (option_type_id);
create index idx_product_option_product    on public.product_option (product_id);
create index idx_pov_product_option        on public.product_option_value (product_option_id);
create index idx_cart_member               on public.cart (member_id);
create index idx_cart_guest_token          on public.cart (guest_token);
create index idx_cart_item_cart            on public.cart_item (cart_id);
create index idx_cart_item_product         on public.cart_item (product_id);
create index idx_orders_member             on public.orders (member_id);
create index idx_orders_status             on public.orders (status);
create index idx_order_item_order          on public.order_item (order_id);
create index idx_order_item_product        on public.order_item (product_id);
create index idx_payment_order             on public.payment (order_id);
create index idx_status_log_order          on public.order_status_log (order_id);
create index idx_notification_order        on public.notification (order_id);


-- =============================================================================
-- 7. updated_at 觸發器（僅掛在會變動的表；
--    order_item / order_status_log / notification 為不可變／append-only，不掛）
-- =============================================================================

create trigger trg_product_updated_at
  before update on public.product
  for each row execute function public.set_updated_at();

create trigger trg_option_type_updated_at
  before update on public.option_type
  for each row execute function public.set_updated_at();

create trigger trg_option_value_updated_at
  before update on public.option_value
  for each row execute function public.set_updated_at();

create trigger trg_product_option_updated_at
  before update on public.product_option
  for each row execute function public.set_updated_at();

create trigger trg_product_option_value_updated_at
  before update on public.product_option_value
  for each row execute function public.set_updated_at();

create trigger trg_member_updated_at
  before update on public.member
  for each row execute function public.set_updated_at();

create trigger trg_cart_updated_at
  before update on public.cart
  for each row execute function public.set_updated_at();

create trigger trg_cart_item_updated_at
  before update on public.cart_item
  for each row execute function public.set_updated_at();

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger trg_payment_updated_at
  before update on public.payment
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 0001_initial_schema 結束。下一支：0002 enable_rls_and_policies（T46，先 plan mode）。
-- 套用後記得：supabase gen types typescript → pnpm lint → commit。
-- =============================================================================
