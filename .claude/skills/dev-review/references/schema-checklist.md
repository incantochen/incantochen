# Schema 審查：缺陷類別清單（第二遍用）

讀全部 `supabase/migrations/*.sql`（依序），對照 `src/types/database.types.ts` 與實際程式使用。

## 缺陷類別

- [ ] **S1 唯一性缺失**：每個「邏輯上應唯一」的欄位（token、單號、外部交易號、email）核對有無 unique 約束——程式層的唯一假設在併發下不成立。校準範例：T70（cart.guest_token 只有普通索引）
- [ ] **S2 FK 策略不一致**：帳務鏈（orders／order_item／payment／order_status_log／notification／support_request）一律 RESTRICT；設定圖與暫態（option 三層、cart→cart_item）CASCADE。新表核對是否遵循
- [ ] **S3 金額欄位**：`numeric(12,0)`＋`check >= 0`（整數新台幣元）；任何新金額欄位不得放寬
- [ ] **S4 enum vs text+check**：需要日後移除值的用 text+check（Postgres enum 值無法移除）；兩邊都要有理由註記。跨表同語意欄位型別要一致（校準範例：order_status_log 的 from/to 是 text、orders.status 是 enum）
- [ ] **S5 RLS 完整性**：新表必須 enable RLS＋依歸屬建 SELECT policy（deny-by-default，寫入走 service role）；帳務類表 revoke delete；policy 的 `auth.uid()` 包 `(select ...)` 
- [ ] **S6 快照契約**：訂單成立即契約——快照欄位（unit_price_snapshot／config_snapshot／product_name_snapshot）不可被現值覆蓋；顯示端快照優先、join 現值僅 null 窗口 fallback
- [ ] **S7 機制虛設（與 code G1 對照）**：每個約束／觸發器／特殊索引（如 partial unique `uq_payment_one_paid_per_order`）找到程式對應的使用或依賴點
- [ ] **S8 配對一致性**：冗餘欄位（如 support_request 同時存 order_id＋member_id）有沒有約束保證配對一致；沒有的話 app 層寫入點必須驗證（並考慮 `unique(id, owner_id)`＋複合 FK 兜底）
- [ ] **S9 migration 衛生**：已套用的 migration 不可改、一律新增；新表有 updated_at trigger（append-only 表除外）；索引覆蓋外鍵與查詢路徑
- [ ] **S10 資料清理路徑**：每張會長大的表（cart、log 類）有沒有清理／歸檔策略；個資刪除走匿名化（FK RESTRICT 下無法真刪）
