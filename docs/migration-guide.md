# Migration 規範 — Supabase CLI（v1）

> 任務：M1/M0 前置（T03 建表前必備）。依賴 `jewelry_mvp_ER.pdf`（13 張表）、repo `CLAUDE.md`（安全邊界／工作流程）、`memory.md`（已定決策）。
> 範圍：DB schema 的 migration 工具選型、命名／拆分規則、可回滾策略、正式環境套用流程、種子資料。
> 下游：T03（建 13 張表）、T46（RLS）、之後所有改 schema 的任務。
> 原則：已套用的 migration 不可改、只加新支；改 schema 一律先 plan mode；正式套用前確認備份（紅線 T34）。

---

## 0. 決策（已定）

**DB migration 工具 → Supabase CLI（手寫 SQL 於 `supabase/migrations/`）。**

理由：RLS（T46）本就是 SQL，schema 與 RLS 同一套 SQL 最一致、零阻抗；型別走
`supabase gen types typescript`，不靠 ORM 也有端到端型別安全；現有 hooks 與
`CLAUDE.md` 已假設此路徑（`supabase/migrations/`、`.claude/.allow-migration`、
`supabase db reset`）；相依最少，貼「單人・骨架優先」。

> 🚫 不引入 ORM 管 migration。日後若要查詢手感，supabase-js 已有型別，再選配
> Drizzle **純當 query builder（不管 migration）**，列 Phase 2。

---

## 1. 工具與前提

| 項目 | 內容 |
|---|---|
| CLI | Supabase CLI（已列 `CLAUDE.md` 尚未安裝清單——T03 前先裝） |
| migration 位置 | `supabase/migrations/*.sql`（進 git） |
| 種子資料 | `supabase/seed.sql`（dev 用，進 git） |
| 型別生成 | 每次改完 schema 跑 `pnpm supabase gen types typescript`，更新 13 張表型別 |
| 本機驗證 | 用 local stack（`supabase start`）或 linked 專案，先在本機／staging 跑過再上正式 |

---

## 2. 命名規則

用 CLI 產生帶 timestamp 的檔：

```bash
supabase migration new create_product_option_tables
# → supabase/migrations/20260623120000_create_product_option_tables.sql
```

- 檔名：`<timestamp>_<動詞>_<對象>.sql`，snake_case、動詞起頭
  （`create` / `add` / `alter` / `drop` / `enable_rls` / `seed`）。
- 一支檔名只描述一件事；對象用既有表名（`product`、`order`…，DB 命名以小寫
  複數或單數依 ER 定稿為準，**全專案一致**）。
- 範例：`..._create_core_product_tables.sql`、`..._enable_rls_orders.sql`。

---

## 3. 一個 migration 一件事（拆分）

- **一支 migration = 一個邏輯變更**，不要把建表與無關的 alter 混在一起。
- 建議 T03 依 ER 的 13 張表**分組建表**，再獨立做 RLS（T46）便於審：

| 順序 | migration | 內容 | 任務 |
|---|---|---|---|
| 1 | `create_core_product_tables` | `Product`、`OptionType`、`OptionValue`、`ProductOption`、`ProductOptionValue` | T03 |
| 2 | `create_member_cart_tables` | `Member`、`Cart`、`CartItem` | T03 |
| 3 | `create_order_payment_tables` | `Order`、`OrderItem`、`Payment` | T03 |
| 4 | `create_notification_status_tables` | `OrderStatusLog`、`Notification` | T03 |
| 5 | `enable_rls_and_policies` | 全表 RLS＋policy（見 §6 安全） | T46 |
| 6 | `seed_option_catalog`（dev） | 選項白名單、一筆示範戒指 | — |

> 快照欄位務必建：`CartItem`／`OrderItem` 的 `unit_price_snapshot` ＋
> `config_snapshot`(JSONB)。白名單三層 `applies_to → ProductOption →
> ProductOptionValue` 的外鍵與唯一鍵要到位。

---

## 4. 可回滾策略

Supabase CLI 的 migration 是**前進式**（無自動 down）。規則：

- ✅ **已套用的 migration 永不修改**——要改就**新增一支**（`alter`／`drop`）。
- ⚠️ 風險高的變更（drop column／改型別／改約束），在該支 SQL **頂部用註解寫出
  對應的還原 SQL**，或另備一支 revert migration，方便緊急回退。
- 本機重置用 `supabase db reset`（重跑全部＋seed）——**僅限 local**，且此指令被
  `dangerous-bash` hook 硬擋，需明確放行；**絕不對正式環境 reset**。
- 破壞性 DDL（`DROP TABLE` 等）受 hook 阻擋，需建 `.claude/.allow-migration`
  放行，並先 plan mode 給人看。

---

## 5. 正式環境套用流程

1. 本機寫 migration → `supabase db reset`（local）或對 local stack 套用，驗證無誤。
2. `supabase gen types typescript` 更新型別，跑 `pnpm lint` / 相關測試。
3. Conventional Commit（如 `feat(db): create core product tables`），一個任務一支
   有意義的 commit。
4. 先上 **staging（Vercel preview / linked 專案）** 套用驗證。
5. ⚠️ **正式環境套用前確認備份可用（紅線 T34）**；正式收單前已升 Supabase Pro
   （含備份）。
6. 套用：`supabase db push`（或 `supabase migration up` 對 linked 專案）。
7. 涉及 schema／auth／金流／session 的任務**一律先 plan mode**，經確認再動手
   （`CLAUDE.md` §7）。

---

## 6. 種子資料（seed）

- `supabase/seed.sql`：**dev／local 用**，不放正式顧客資料。
- 內容：`OptionType`／`OptionValue` 與各款 `ProductOptionValue` 白名單、一筆示範
  戒指（含寶石色／金屬色／戒圍可選值），讓配置器（T16）本機就能跑。
- **冪等**：可重複執行不重複插入（用固定主鍵或 `on conflict do nothing`）。

---

## 7. 與 hooks／CLAUDE.md 的對齊

- `protect-migration`：schema 變更被擋，需 `.claude/.allow-migration` 放行。
- `dangerous-bash`：`DROP TABLE`、`supabase db reset` 等硬擋。
- migration／RLS 屬高風險任務：**先 plan mode → 放行 → 套用 → gen types → lint →
  commit → 停下回報**。

---

## 8. 待辦／下一步

- 🆕 T03 前先 `pnpm add -D supabase`（或對應安裝方式）裝 CLI、`supabase init`。
- 🔁 本規範定案後，於 `CLAUDE.md` 加一行指向本檔＋硬規則（已套用不可改、正式前
  確認備份、migration 先 plan mode）；`memory.md` 已定決策補「migration 工具＝
  Supabase CLI」。
- ⏭️ **下一步**：T03 依 ER 分 4 組建 13 張表 → T46 RLS → dev seed。
