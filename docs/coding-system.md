# coding-system.md — 寫程式的思考系統與檢核清單

> 建立日期：2026-07-04（源自 PR #30 三輪 code review 的完整檢討）
> 用途：把「產出可靠程式碼的思考方式」寫成任何模型（不限能力高低）都能照表執行的系統。
> 使用時機：**動手寫任何程式碼之前載入本檔**；PR 前逐條走一次 §5 檢核清單。
> 維護原則：每次 review 發現「本系統沒攔到的 bug 類型」，就把它提煉成新條目——本檔是活的，靠真實 bug 餵養。

---

## 0. 為什麼需要這份文件

2026-07 的 PR #30 經歷三輪雲端 review，每輪都挖出新 bug。回顧發現：**這些 bug 沒有一個需要高深知識才能避免**，全部源自兩個思考習慣的缺失：

1. **沒有逆向推理（Backward Reasoning）**：寫程式時只想「正常流程怎麼走」，沒有從「這裡失敗會怎樣」反推回來。
2. **沒有系統性思考（System Thinking）**：把每行程式碼當獨立的動作，沒有想「這個動作在整個系統的狀態機、時序、並發下會怎麼互動」。

能力強的模型「碰巧」比較常做這兩件事；能力弱的模型不做。**解法不是換模型，是把這兩件事變成不可跳過的步驟。**

---

## 1. 三大不可違背的基本原則（優先序由高到低）

任何取捨衝突時，依此排序裁決：

1. **金流零誤**：錢的流向、金額、付款狀態，任何情境下都不可錯、不可遺失、不可重複。寧可整個請求失敗重來，不可默默做一半。
2. **資安風險最小化**：不信任任何外部輸入（前端、webhook、URL 參數、email 內容）；個資最小揭露；金鑰不落地前端。
3. **好的使用者體驗**：在前兩者不被犧牲的前提下，讓失敗情境對使用者友善（明確的錯誤訊息、可重試、不遺失已填資料）。

推論範例：「付款成功但寄信失敗」→ 原則 1 說訂單狀態必須正確（已付款就是已付款），原則 3 說信要想辦法補寄——所以正解是「訂單標記成功＋信件進重試機制」，而不是「整筆回滾」也不是「當作都成功」。

---

## 1.5 開發六步流程（動手寫程式前，依風險分級執行）

寫在 plan mode 的 plan 檔裡（plan 本來就要寫，把六步當章節結構＝零額外成本），不另產文件：

1. **Requirement Analysis**：需求真正要解決什麼？有哪些隱含需求？（例：「加金額核對」的隱含需求是「不符時要能被發現並重試」，不只是「比對兩個數字」）
2. **Impact Analysis**：哪些模組、資料流、API、資料表、事件會受影響？grep 實際確認，不憑印象。
3. **Failure Analysis**：列出失敗情境（高風險任務至少 10 種）：Timeout、重複請求、部分成功、競態、回滾、外部服務降級……每種都要有明確答案。
4. **Invariant Definition**：哪些狀態必須永遠成立？（例：「付款成功的訂單最終恰好被升級一次」「同一訂單同一類型通知信最多寄一封」「payment.status=paid 必有 gateway_trade_no」）寫下來，測試要覆蓋它們。
5. **Implementation Plan**：以上做完才決定怎麼改，不是直接寫程式。有並發防護／重試機制的設計，**先分析 workload 再選型**（§3.2：正常請求平均走哪條路徑、付幾次 round trip），不要只驗證「race 修掉了」。
6. **Self Review**：完成後以 Reviewer 視角找潛在 bug、回歸風險、可維護性問題——用 `/code-review high` 代替純自審（更便宜、更客觀）。

**分級表**（控制成本靠分級，不靠省略）：

| 任務類型                                    | 執行深度                                          |
| ------------------------------------------- | ------------------------------------------------- |
| 金流／webhook／auth／訂單狀態（碰錢碰個資） | 全套六步；Failure ≥ 10 條；Invariant 明列並有測試 |
| 一般功能（會員頁、購物車邏輯）              | 精簡版：Impact＋Failure（≥ 5 條）＋Invariant      |
| 純 UI 樣式／文案／docs                      | 直接做，不跑分析                                  |

---

## 2. 核心思考法一：逆向推理（Backward Reasoning）

正向思考問「這段程式要做什麼」；逆向推理問「**這段程式怎樣會出錯，出錯後系統變成什麼狀態**」。

### 2.1 對每一個「外部呼叫」強制執行的四問

外部呼叫＝任何離開目前程式控制範圍的動作：DB 查詢/寫入、第三方 API（金流、email）、檔案/網路 IO。

| #   | 問題                                                 | 沒問會發生的真實案例                                                                                                                                                           |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Q1  | **這個呼叫失敗時，是 throw 還是回傳錯誤值？**        | Supabase／Resend 都是回傳 `{data, error}` 不 throw。只寫 `await client.call()` 不接回傳值，等於把所有失敗當成功。（PR #30 三輪共 5 個 bug 同此根因）                           |
| Q2  | **「失敗」和「查無資料/條件不符」回傳值長一樣嗎？**  | Supabase 的 `{data: null, error: X}`（查詢失敗）和 `{data: null, error: null}`（沒有符合的列）都是 `data === null`。只判斷 `if (!data)` 會把 DB 故障誤判成業務上的「不存在」。 |
| Q3  | **失敗當下，系統已經做到哪一步？半完成狀態是什麼？** | payment 已標 paid、orders 還沒推進時掛掉 → 誰負責把 orders 補推進？答案必須具體（重試機制/冪等重入/人工），不能是「應該不會發生」。                                            |
| Q4  | **這個失敗會被誰看到？有重試路徑嗎？**               | webhook 回 `1                                                                                                                                                                  | OK` 之後 ECPay 永不重送——所以「回 OK 前」是最後一次自動重試機會，任何還沒完成的事在此之後只剩人工救援。 |

### 2.1b 外部呼叫失敗情境矩陣（每個 External Call 都必須逐格回答）

四問是思考起點；以下六種具體情境是**必答題**——每個外部呼叫（DB、金流 API、Email API、任何 HTTP 呼叫）都要能明確說出「程式此時怎麼辦」，說不出來＝還沒設計完：

| 情境                             | 必答的問題                                                                              | 常見正解模式                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Timeout**                      | 逾時 ≠ 失敗——對方可能已經做完了。程式當它成功還是失敗？                                 | 當「未知」處理：不可直接標失敗（金流尤其），改走查詢/對帳確認實際狀態；重試必須冪等。                                                          |
| **回 500**                       | 暫時性錯誤。就地重試？放棄？讓上游重送？                                                | 讓錯誤往上傳，由有重試能力的層級處理（webhook 回 `0                                                                                            | Error` 讓 ECPay 重送）；不可吞掉當成功。 |
| **回 404 / 查無**                | 「不存在」是業務上合法情境，還是資料不一致的訊號？兩者處理完全不同。                    | 合法（查無訂單→回錯誤頁）就正常分支；不該發生的（webhook 帶了我們沒有的單號）要告警，不可靜默略過。                                            |
| **回 Invalid JSON / 非預期格式** | 解析失敗會 throw 還是產生 NaN/undefined 繼續往下跑？                                    | 邊界處 Zod 驗證（本專案慣例：所有外部輸入過 Zod）；`parseInt`→`Number.isFinite` 防呆；解析失敗＝該請求失敗，不可帶著垃圾值繼續。               |
| **重複送達**                     | 同一個請求/回拋來兩次（重送、連點、並發），會產生兩次副作用嗎？                         | 冪等設計：unique constraint＋條件式 UPDATE＋「已處理過→直接回成功」短路。**收方負責冪等，不假設送方不重送。**                                  |
| **部分成功**                     | 多步驟操作（更新 payment＋更新 orders＋寄信）在中間掛掉，系統處於什麼狀態？誰把它修完？ | 每步各自冪等、可重入（ensure-style：重跑不重複副作用）；或包進 DB 交易；剩餘的半完成狀態必須有「會真的被觸發的」修復路徑（見 §3.3 重試迴路）。 |

實務作法：在 plan 的 Failure Analysis 段落，對每個外部呼叫直接畫這張表填答案。填不出來的格子就是設計缺口。

### 2.2 回傳值的完整枚舉

對每個函式回傳，枚舉**所有可能的值域**再寫處理，不要只處理你預期的那幾種：

- `parseInt` → 可能回 `NaN`（空字串、非數字）。比對前先 `Number.isFinite()`。
- Postgres `numeric` 欄位 → PostgREST 可能回**字串**（即使 TS 型別標 `number`）。比對前先 `Number()`。
- `Array.prototype.find`／`.maybeSingle()` → 可能 `undefined`/`null`，且「找不到」跟「查詢失敗」要分開處理（見 Q2）。
- 字串 slice/正規化 → 邊界情況（比預期短/長的輸入、含意外字元）。識別碼格式互轉只能有**單一出處**供 import，散落的複本必然失同步（T67 的 `slice(11)` bug）。

### 2.3 契約思考（Contract Thinking）

每個函式對呼叫端有一份「契約」——**改動任何一方前，先讀另一方**：

- 我這個函式承諾什麼？（回傳值意義、會不會 throw、副作用有哪些）
- 呼叫端依賴什麼假設？（例：`sendOnce` 假設 `send()` 失敗會 throw——那所有被當 `send` 傳入的函式都必須遵守「失敗即 throw」，包裝 Resend 時就有義務把 `{error}` 轉成 throw。）
- **包裝層負責契約轉換**：SDK 用錯誤回傳值、上層要 throw 契約時，轉換責任在包裝函式，不在呼叫端。

---

## 3. 核心思考法二：系統性思考（System Thinking）

單行程式碼沒有 bug 不代表系統沒有 bug。寫任何有狀態的功能前，先回答：

### 3.1 狀態機

- 這個實體（order/payment/notification）有哪些狀態？合法轉換是哪幾條邊？
- 每個轉換由誰觸發？同一個轉換可能被觸發**兩次**嗎（webhook 重送、使用者連點、並發請求）？
- **狀態只前進不後退**：條件式 UPDATE（`WHERE status='舊狀態'`）是預設寫法，不是加分項。

### 3.2 時序與並發

- 兩個相同請求**同時**到達，會發生什麼？逐步走一遍：A 讀 → B 讀 → A 寫 → B 寫。
- **check-then-act 在並發下必然有 race**（先 SELECT 再決定 INSERT/UPDATE）。一律改：條件式 UPDATE、`INSERT ... ON CONFLICT`、unique constraint 兜底。
- **先分析 workload，再決定 concurrency strategy**（2026-07-09 T70 教訓）：修 race 的方式不只一種，每種在「最常發生的呼叫情境（hot path）」上的成本不同。設計 get-or-create 流程時，不只問「是否 race-safe」，還要先問「**正常請求平均會走哪條路徑？需要幾次 round trip？**」，答案決定選型：
  - **read-first**（SELECT → miss 才 INSERT → 撞 23505 再 reselect）：大部分請求**已有資料**時，hot path 維持一次 SELECT；unique constraint 仍提供 race 保護（本專案案例：addToCart——回頭客重複加車是常態）。
  - **insert-first**（INSERT → 23505 retry）：大部分請求**是首次建立**時，hot path 維持一次 INSERT；若重複呼叫很多，則每次都先撞一次 23505 再 reselect＝2 round trips＋error log 雜訊＋dead tuple（本專案案例：send-once.ts 的 tryClaim——每張訂單每種通知一生只 claim 一次，insert-first 才是對的）。
  - **UPSERT**（`ON CONFLICT ... RETURNING`）：若資料庫與工具支援，通常可兼顧 race-safe 與單 round trip；但注意工具限制（PostgREST 的 upsert 無法指定 partial unique index 的 WHERE 述詞）。

  **不要因為需要 race-safe 就預設 write-first；也不要因為追求 read-first 就忽略首次建立的成本。** 同一個 pattern 在不同 workload 下正解相反（addToCart vs tryClaim 即是一對），所以規則是「依 hot path 選擇」而非「偏好某形態」。若刻意選了對 hot path 較貴的形態（如程式簡單性優先、流量小到無感），理由寫進 plan/PR——讓它是決策不是慣性。

  選完後用這句話驗收：**hot path 是否避免了「可預期但沒有價值」的資料庫 round trip？**（例如保證失敗的 INSERT、保證 miss 的 SELECT、呼叫前提已保證存在還先查一次的確認）一次 round trip 的價值在於帶回事前不知道的資訊、或造成需要的狀態改變——結果從 workload 就能預期的呼叫，兩者都沒做到，就是純粹的浪費。「可預期」以 workload 統計為準，不是邏輯絕對：insert-first 在「幾乎都是首次建立」的 workload 下偶爾撞一次 23505 是可接受的殘餘，不違反本條。

- 條件式 UPDATE 搶鎖時，**SET 必須改動至少一個 WHERE 用到的欄位**——否則 Postgres READ COMMITTED 下第二個並發請求重新檢查條件仍會命中（EvalPlanQual），兩邊都搶到。
- serverless 特有：HTTP 回應送出後 function 可能被凍結。**禁止 `void promise.catch()` fire-and-forget**，一律 `await`。

### 3.3 重試與冪等的整體迴路

設計任何「失敗要重試」的機制時，畫出完整迴路並確認**每一環都真的接得上**：

```
失敗發生 → 誰知道失敗了？ → 誰觸發重試？ → 重試怎麼找到未完成的工作？ → 重試成功後怎麼避免重複副作用？
```

PR #30 的 T88 缺口就是這裡斷鏈：寄信失敗有標記（failed）、有重試邏輯（reclaim）、**但沒有觸發者**——webhook 回了 `1|OK`，ECPay 永遠不會再來，重試邏輯成了永遠不會被呼叫的死碼。**有重試「機制」不等於有重試「迴路」；逐環驗證觸發鏈。**

### 3.4 修 bug 時的擴散檢查

發現一個 bug，**立刻問：同一個 pattern 還出現在哪裡？** 用 grep 全面掃，同批修完：

- PR #30 教訓：第二輪修了 `ensureOrderPaid` 忽略 `{error}`，第三輪 review 又抓到**同檔案 60 行外**的 payment UPDATE 一模一樣的問題。修的時候多花 2 分鐘 grep `\.update\(|\.insert\(|\.select\(`，就省掉一整輪 review。
- 修法本身也要問契約：修 A 處會不會讓依賴 A 舊行為的 B 處壞掉？（改 throw 契約前先 grep 所有呼叫端確認都有接。）

---

## 3.5 Bug 修復協定（動手改任何一行之前，強制執行）

**任何 bug，不要只修 bug。** 修 bug 的第一個動作不是打開編輯器，是回答三問並**寫下來**（plan 檔或 PR 描述，之後回填 §6 案例庫）：

### 三問（依序，答不出上一問不准進下一問）

1. **Root Cause 是什麼？**
   - 必須是**機制**，不是症狀。「信沒寄出」是症狀；「Resend SDK 對 API 錯誤回傳 `{error}` 不 throw，而呼叫端只看有沒有 throw」才是 root cause。
   - 檢驗標準：從輸入到錯誤結果，**因果鏈每一步都能指到具體程式碼行**。指不出來＝還在猜，不准修。
   - 連續問「為什麼」直到抵達**設計/契約層**：為什麼信沒寄出→因為錯誤被吞→為什麼被吞→因為只用 try/catch 判斷→為什麼這樣判斷→因為假設了「失敗會 throw」的契約而 SDK 不遵守→**這才是根**。停在中間任何一層修，都是修症狀。

2. **為什麼 Architecture 沒擋住？**
   - 逐層問：型別系統為什麼沒擋？（`await` 不接回傳值是合法 TS）測試為什麼沒抓？（mock 行為與真實 SDK 不一致）review 為什麼沒看到？（pattern 不在 checklist 上）本檔 §6 案例庫哪條該攔卻沒攔？
   - 答案決定修復範圍：如果某一層「本該擋住」，這次除了修 bug 本體，**還要修那一層**（補 lint 規則/補測試慣例/補 checklist 條目）。

3. **怎麼避免下一次？**
   - 至少做到：①grep 同 pattern 全部出現處同批修（§3.4）；②寫一個「沒有這個修法就會轉紅」的測試（§5.4 反向驗證）；③回填 §6 案例庫。
   - 如果 root cause 在契約/架構層而這次只能先止血：止血可以，但**架構修復必須立刻開任務列管**（如 T88），不可只留在腦中。

### 特別警告：不可照單全收別人給的修法

Review 工具/審查者/issue 回報者建議的修法，是**假設**不是**答案**。實例：PR #30 第二輪 review 建議加 `.is("sent_at", null)` 區分兩種失敗——實際核對程式碼後發現 `sent_at` 與 `status` 由同一個 UPDATE 寫入，兩種情況下都是 null，該修法完全無效。照單全收會產生「看起來修了、實際沒修」的程式碼，製造虛假安全感。**收到任何建議修法，先自己走一遍因果鏈驗證它真的打中 root cause，驗證不過就回報並提替代方案。**

### 症狀修 vs 根因修的判別

| 訊號                                   | 你可能在修症狀                                 |
| -------------------------------------- | ---------------------------------------------- |
| 修法是「加一個 if 擋住這個特例」       | 問：為什麼會出現這個特例？上游哪裡讓它進來的？ |
| 修法只讓回報的那條測試/情境變綠        | 問：同 pattern 的其他路徑呢？grep 了嗎？       |
| 修法你自己解釋不出「為什麼這樣就好了」 | 停下。解釋不出來＝沒找到 root cause。          |
| 修完 review 又在附近抓到類似問題       | 上次就是修症狀。回到三問重來。                 |

---

## 4. 領域鐵律（本專案特化）

- **金額**：一律伺服器端依 DB 白名單重算，任何前端/webhook 傳來的金額只能用於「核對」，不能用於「記帳」。核對不符 → 拒絕處理＋回錯誤碼觸發重送，不可默默採用任一方。
- **Webhook**：驗章是第一道關卡（過不了直接拒絕，零副作用）；冪等查核第二道（已處理過直接回成功）；狀態轉換用條件式 UPDATE 第三道。回 `1|OK` = 「我已完整處理完畢」，任何未完成的工作回 `0|Error` 讓對方重送。
- **Email/通知**：客人自由輸入插進 HTML 前必先 escape；寄送去重靠 DB unique constraint（不靠記憶體/判斷式）；寄送失敗不可阻塞金流主流程，但必須留下可被重試機制找到的紀錄。
- **個資**：預設遮罩、揭示走 server action 留稽核；任何憑識別碼（order_no 等）直接揭露個資的頁面都要問「識別碼可猜嗎？」（`Math.random` 可猜，`crypto` 不可猜）。
- **識別碼**：格式互轉（含 slice/replace）單一出處；產生用 crypto 級亂數。

---

## 4.5 部署順序與完成定義

**部署順序思考**（任何 schema/契約變更）：

- 新舊程式碼會短暫並存（部署滾動中、preview vs production）。新程式寫的資料，舊程式讀得懂嗎？反過來呢？
- 順序鐵律：**先擴充後收縮**——migration 先上（加欄位、nullable）、程式再上、確認穩定後才收緊（加 NOT NULL、刪舊欄位）。本專案既有規則「migration 先 `db push` 再 merge」是它的特例。
- 回滾預想：這個變更上線後發現問題，退回上一版程式時，新格式的資料會不會讓舊程式爆炸？

**完成定義（Definition of Done）**：

- 測試全綠 ≠ 完成。金流/webhook 改動的 DoD 明文包含：**ECPay sandbox 實際走一次完整流程**（下單→付款→webhook→狀態→信件）。
- 「留給使用者本機做」的驗證項不可無限懸置：merge 後、下個任務開始前補做，或在 tasks.csv 留下明確的待驗證註記。

---

## 5. 檢核清單（PR 前逐條走，不可跳過）

### 5.1 寫码前

- [ ] 依 §1.5 分級表跑過對應深度的六步流程（分析寫進 plan 檔）？涉及金流/webhook/auth → 先進 plan mode＋全套六步。
- [ ] Invariant 列出來了？每條都有對應的測試計畫？
- [ ] 這個功能的狀態機畫出來了嗎？哪些轉換可能被觸發兩次？
- [ ] 每個外部呼叫的六情境矩陣（§2.1b：Timeout/500/404/格式錯誤/重複送/部分成功）都填完、沒有空格？

### 5.2 每寫完一個函式

- [ ] 每個外部呼叫都跑過 §2.1 四問？沒有任何 `await client.xxx()` 不接回傳值。
- [ ] 回傳值域完整枚舉過（NaN／null vs undefined／字串型 numeric／空陣列）？
- [ ] 這個函式的契約寫清楚了（註解或型別）？改了既有函式契約 → grep 過所有呼叫端？

### 5.3 並發與重試（有狀態寫入時）

- [ ] 沒有 check-then-act？寫入都是條件式 UPDATE / ON CONFLICT？
- [ ] 並發防護選型前有先分析 **workload**（§3.2）？**hot path 有沒有「可預期但沒有價值」的資料庫 round trip**（保證失敗的 INSERT、保證 miss 的 SELECT、前提已保證存在還先查一次）？若刻意選了對 hot path 較貴的形態，理由寫進 plan/PR？
- [ ] 條件式 UPDATE 的 SET 有改動 WHERE 欄位？
- [ ] 重試迴路逐環走過（§3.3）？每個「失敗紀錄」都有真實存在的觸發者會來重試它？
- [ ] serverless 下沒有 fire-and-forget？

### 5.4 測試

- [ ] 關鍵路徑的失敗分支有測試（不只 happy path）：外部服務回錯誤值（不是 throw）、金額不符、重複請求、並發搶鎖。
- [ ] **反向驗證**：把修法暫時還原，確認測試真的會轉紅再改回來。綠的測試不代表有效的測試。
- [ ] Mock 的行為跟真實 SDK 一致？（用 `mockRejectedValue` 模擬一個實際上回傳 `{error}` 的 SDK ＝ 測試給你虛假信心——PR #30 第一輪就是這樣漏掉的。）

### 5.5 PR 前

- [ ] `pnpm lint`＋`pnpm test` 全綠；`tsc --noEmit` 無新增錯誤。
- [ ] 修 bug 的 PR：§3.5 三問已寫下（root cause 因果鏈可指到具體行／哪一層本該擋住／防再發措施）？收到的建議修法有自己驗證過因果鏈？
- [ ] 修 bug 的 PR：grep 過同 pattern 的所有出現處，同批修完（§3.4）。
- [ ] 金流/webhook/auth/訂單/email 改動：先跑 `/code-review high` 修完 findings 再開 PR（CLAUDE.md §7）＝六步流程的 Self Review。
- [ ] 自問：「如果我是攻擊者/是 ECPay 重送機制/是一個手很快連點兩下的客人，這個 diff 哪裡會壞？」寫下答案放進 PR 描述。
- [ ] 部署順序想過（§4.5）？schema 變更遵循先擴充後收縮？
- [ ] DoD：sandbox 實走驗證已完成或已在 tasks.csv 留明確待驗證註記？

---

## 6. 案例庫（每個 bug 對應「哪一條會攔到它」）

| Bug（PR #30 實錄）                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 會攔到它的條目                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| Resend `{error}` 被忽略，客人確認信 100% 靜默漏寄                                                                                                                                                                                                                                                                                                                                                                                                                                              | §2.1 Q1、§5.2                                                                  |
| `ensureOrderPaid` 忽略 Supabase `{error}`，DB 故障誤判成功                                                                                                                                                                                                                                                                                                                                                                                                                                     | §2.1 Q1+Q2                                                                     |
| 修了 ensureOrderPaid 卻漏掉 60 行外同 pattern 的 payment UPDATE                                                                                                                                                                                                                                                                                                                                                                                                                                | §3.4 擴散檢查                                                                  |
| `slice(11)` 把隨機後綴帶進訂單號（散落複本失同步）                                                                                                                                                                                                                                                                                                                                                                                                                                             | §2.2 識別碼單一出處                                                            |
| webhook 外層 catch 回 `1                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | OK`，暫時性故障 → 付款通知永久遺失                                             | §2.1 Q4、§4 Webhook 鐵律 |
| `void sendXxx().catch()` serverless 凍結漏寄                                                                                                                                                                                                                                                                                                                                                                                                                                                   | §3.2                                                                           |
| stale-pending reclaim 的 SET 沒改 WHERE 欄位，並發雙重寄信                                                                                                                                                                                                                                                                                                                                                                                                                                     | §3.2 條件式 UPDATE 規則                                                        |
| numeric 欄位字串型別 + NaN 讓金額核對誤判                                                                                                                                                                                                                                                                                                                                                                                                                                                      | §2.2 值域枚舉                                                                  |
| 測試用 `mockRejectedValue` 模擬實際回傳 `{error}` 的 SDK，全綠但無效                                                                                                                                                                                                                                                                                                                                                                                                                           | §5.4 mock 一致性                                                               |
| 自癒機制存在但觸發鏈斷裂（T88：failed 紀錄永遠沒人來重試）                                                                                                                                                                                                                                                                                                                                                                                                                                     | §3.3 重試迴路逐環驗證                                                          |
| **讀取路徑**忽略 `{error}`：DB 抖動時已付款客人在成功頁被 redirect 回首頁、付款中客人被踢回空購物車（2026-07-07 審查 F-008／T95）——「只看 data」在寫入路徑弄壞資料，在讀取路徑則是**誤導使用者離開**；error 分支不可 redirect 走人，要 render「系統忙碌」讓使用者留在原地重試                                                                                                                                                                                                                  | §2.1 Q1+Q2、§3.4 擴散檢查（T68 修了 webhook 側、客人端讀取路徑漏套同 pattern） |
| client 端 `disabled={isPending}` 被當成防重複提交的全部——跨分頁併發送出建出兩張訂單、可能重複扣款（2026-07-07 審查 F-011／T98）——**client 防護只是 UX，冪等鎖必須在伺服器端**（條件式 UPDATE 搶鎖／DB unique），與「絕不信任前端價格」同一精神：絕不信任前端的請求去重                                                                                                                                                                                                                         | §3.2 條件式 UPDATE 規則、§5.3                                                  |
| 沒先分析 workload 就選 concurrency strategy：T70 addToCart 修 race 時改盲目 insert-first，但它的 hot path 是「回頭客重複加車＝資料已存在」——每次都吃一次保證失敗的 INSERT＋reselect（2 round trips＋error log 雜訊＋dead tuple）；read-first＋unique constraint 兜底一樣 race-safe 且 hot path 1 round trip。對照 send-once.ts 的 tryClaim：hot path 是首次建立，insert-first 反而正確（2026-07-09 PR #45 review、merge 前才發現，與使用者確認暫不回改）——**依 hot path 選型，不預設任一形態** | §3.2 workload 選型、§5.3                                                       |
| Server Action 直接 `throw new Error("友善中文訊息")` 想讓 client 顯示——production 環境 Next.js 會把 Server Action 拋出的錯誤訊息遮罩成通用 digest 字串，client 端只看到英文通用訊息，dev 環境測不出來（PR #51 深度審查發現，`admin/orders/[id]/actions.ts`）。**Server Action 要把訊息帶到 client，一律 `return { ok: false, error }`，絕不 `throw`**（throw 只用於「client 不需要理解的內部錯誤」） | §2.2 回傳值完整枚舉、§5.4（dev 測試無法暴露 prod-only 行為差異）              |
| Postgres RPC（`.rpc()`）的 jsonb 參數在 TS 端型別是 `Json`（等同 `any`），改用 RPC 前若是直接 `.insert()` 到 table，欄位名稱打錯或被生成型別擋下——換成 RPC 後同一個打錯的欄位編譯期不會報錯，只有跑到 DB 端才會因型別轉換失敗或（更糟）安靜寫入錯值（PR #51，本專案第一支 RPC，`create_order_with_items`）。**導入任何 RPC 前，在 TS 呼叫端用 Zod schema 驗證 jsonb 參數的形狀，把生成型別失去的端到端檢查用 runtime 驗證補回來** | §2.2 值域枚舉、§4 領域鐵律（新技術模式導入時的縱深防禦）                       |
| 併發清除／掃除（sweep）邏輯只顧著清掉「別人的舊資料」，沒想過自己剛建立的新資料也可能被另一個並發請求同樣的邏輯掃掉——兩個並發請求互相把對方剛發的 row 標成 failed（mutual kill），比殘留孤兒 row 更糟：客人拿到的 ECPay 表單對應的 payment 已經死了（PR #51，`checkout/pay/page.tsx` 的 stale-payment sweep）。**寫「清除比我舊的東西」邏輯時，過濾條件要嚴格排除「跟我同時或比我晚建立」的資料**（用時間戳而非「不是我」來界定範圍），否則兩邊都自認自己是倖存者 | §3.2 時序與並發、§5.3                                                          |
| dedup／冪等檢查只比對「是否已存在同一個 ID／同一筆紀錄」，沒檢查那筆紀錄代表的**內容**是否還跟使用者現在的意圖一致——客人結帳後回頭改了購物車內容，重複結帳的 dedup 邏輯找到舊的 pending 訂單就直接復用，讓客人被導去付「舊內容的錢」而非「現在購物車的錢」（PR #51 三個獨立審查代理交叉命中，`checkout/actions.ts`）。**dedup／復用邏輯除了比對存不存在，還要比對「代表狀態」有沒有在等待期間被使用者動過**（如比較 updated_at／version），不一致就重新產生而非盲目復用 | §2.3 契約思考、§3.1 狀態機（隱含的「這筆紀錄仍代表當下意圖」不變量未被檢查）  |
| 補 CAS 守衛時只顧著「WHERE 有沒有帶 `.eq("status", from)`」，沒想過 `to===from`（覆寫成同一個狀態）這個 edge case：SET 的值跟原值一樣，WHERE 用到的欄位沒被真的改動，Postgres READ COMMITTED 下 EvalPlanQual 重新檢查條件仍會命中，CAS 對「兩個並發請求都想覆寫成同一狀態」完全無效（T92／PR #53，`adminOverrideStatus`，本機 code-review 兩個獨立 finder agent 交叉命中）。**加 CAS 守衛時要連 `to===from` 一起想：不是只問「WHERE 有沒有綁 from」，要問「SET 的值是否保證跟 WHERE 檢查的欄位不同」，不保證就要在 UPDATE 之前另外擋下這個 edge case** | §3.2 條件式 UPDATE 規則（SET 必須改動 WHERE 用到的欄位，需涵蓋 to===from）    |
| 為修 CAS bug 而在 client 端濾掉某個選項，卻忘了濾掉清單所依賴的欄位（prop）事後會變——`useState` 初始值只在 mount 時算一次，後續 prop 更新不會自動重算，導致「顯示的選項清單」跟「實際綁定的 state」悄悄不同步、下拉選單顯示 A 但送出的是舊值 B（T92／PR #53 max effort review，`order-actions.tsx` 的 `overrideTo`，三個獨立 finder agent 交叉命中）。**用 prop 過濾出的候選清單去約束一個 `useState` 值時，不能只在初始化時對齊一次——要嘛用衍生值（每次 render 重新檢查目前值是否還在候選清單內，不在則 fallback）取代存起來的 state，要嘛用 `useEffect` 明確在依賴變動時重新同步** | §3.1 狀態機、§5.4（單元測試測不出這類 UI state／prop 不同步，需 code review 補） |
| **同一類 bug 第 3／4 次出現**：客人自由輸入插進 email HTML 前忘記 escape——`order-shipped-notification.ts` 先修過一次，之後 `order-confirmation.ts`／`new-order-notification.ts`／`support-request-notification.ts` 三支寄信程式各自新增時又漏套（T72／T84），根因是「每個新模板都要靠人記得手動呼叫 `escapeHtml()`」，沒有語言層級或 lint 層級的強制機制，本機 code-review high 的 altitude angle 指出：這類手動慣例注定會有第 5 次（`docs/coding-system.md` 案例庫本身在前幾次修復時也沒回填，導致後面的作者看不到「這裡已經犯過三次」的訊號）。**同一根因的 bug 第 2 次以上出現時，案例庫必須回填**（即使當下修法仍是手動慣例、沒有升級成強制機制）——回填本身就是留給下一個作者的訊號，讓 code review 時知道這個檔案類別要多看一眼；若這類重複達到 3 次以上，應考慮把慣例升級為結構強制（如自動跳脫的 tagged template），而不是繼續加案例庫條目 | §3.5／§5.5 bug 修復後必回填案例庫（本條目是「回填」這個步驟本身漏做的案例）    |
| **借用外部系統的重試機制當自己的重試迴路，沒盤點它的終止條件**（T88／PR #66 max review）：用「webhook 對 ECPay 回 ERR → ECPay 重送」當 email 補寄的重試迴路，只驗證了 happy path 閉環（失敗→ERR→重送→reclaim→補寄成功），沒窮舉「這個迴路在哪些條件下被切斷」——ECPay 重送額度有限且任何一次回 1\|OK 即永久停止；訂單被推進到 paid 以後的狀態（`status!=='paid'→return true`）就把重試靜默掐斷；由 reconcile 兜底推進的訂單根本沒有 webhook 重送可用。三個切斷點都讓問題回到原點（信永久卡 failed）。**借用不歸自己管的重試機制（webhook 重送、上游 retry、queue redelivery）時，必須逐條列出它的終止條件並確認每一條都有兜底**；不能兜底的，自己要有一個終止條件完全受控的迴路（如每日 cron sweep）當最終防線，外部重送只當加速器 | §3.3 重試迴路逐環驗證（「逐環」要包含迴路的**終止**條件，不只推進條件）        |
| **測試 mock 的失敗模式與真實 SDK 不符，測試全綠但真實失敗路徑零覆蓋**（T88／PR #66 max review，§5.4 mock 一致性的變體再犯）：send-once 測試用 mock 內 `throw` 模擬「標記 sent 失敗」，但 supabase-js 對 DB 層失敗（timeout／連線池耗盡）是 **resolve `{error}` 不 throw**，throw 只發生在網路層——被測程式的 try/catch 對真實失敗模式是死碼，`{error}` 沒人檢查、靜默略過，而測試因為 mock 用 throw 反而通過。PR #30 已把「mockRejectedValue 模擬回傳 `{error}` 的 SDK」寫進案例庫，這次是同根因在**新寫的測試**再現。**寫 SDK mock 前先確認：這個 SDK 各層失敗各是什麼形態（resolve error／throw／both）？mock 必須至少覆蓋 resolve `{error}` 這種「不會進 catch」的形態**，只測 throw 等於只測網路故障、漏掉最常見的 DB 故障 | §5.4 mock 一致性、§2.1 Q1（每種失敗形態都要有對應的檢查與測試）                |
| **`vi.mock()` 抽成共用 helper 檔想被多個測試檔 import，跑起來直接爆掉**（`Error: This module cannot be imported from a Client Component module`）：T72／T84 review 發現三支 email 測試檔各自手刻近乎一樣的 Resend／service-role mock，嘗試抽出 `resend-test-helpers.ts` 供三檔 import，結果 `server-only`／`resend` 沒被正確攔截——Vitest 的 `vi.mock()` 靜態轉換只把呼叫「提升」到**同一個檔案**的最頂端，不會連帶讓引入該共用檔的測試檔也套用那些 mock；ES module 依序求值下，真正的模組載入順序不保證共用檔的 `vi.mock()` 搶先其他檔案對同一個模組的 import 生效。**`vi.mock()` 必須留在每個實際 import 被測模組的測試檔自己裡面，不能抽到共用檔跨檔套用**——這也解釋了本 repo 9+ 支測試檔各自手刻幾乎一樣的 mock 樣板並非疏漏，是 Vitest 這個限制下唯一可靠的寫法；真的要共用只能共用「產生 mock 資料」的 helper 函式本身（如 `mockOrdersRow`），`vi.mock()` 呼叫仍要複製貼上 | §5.4 測試（mock 機制限制，非邏輯錯誤）                                       |
| **錯誤碼判讀被完整 schema 驗形搶先，明確拒絕降級成 fail-open 放行**（T42 dev 走查實測）：ECPay 對無效統編回 `{ RtnCode:1200125, CompanyName:null }`，但 `postInvoiceApi` 先套完整 response schema（`CompanyName` 寫 `z.string().optional()`——**optional 接受「缺席」但不接受 `null`**）→ 解析失敗被歸類「形狀不符」、`rtnCode` 遺失 → `checkCompanyIdentifier` 的 1200125 阻擋形同虛設，無效統編 12345678 一路建單付款、到開立發票才爆——正是該驗證原本要防的事。單元測試全綠沒攔到：mock 回應只放了 `RtnCode`/`RtnMsg`，沒放真實 API 的 `CompanyName:null`。**修在單一出處而非逐 schema 補 nullable**：先用最小 envelope（`RtnCode`＋`RtnMsg` nullish）判業務失敗並保留錯誤碼，RtnCode=1 成功時才套完整 schema——失敗回應的伴隨欄位（null／空字串）本就不該參與驗形。兩個教訓：①「fail-open＋依錯誤碼分流」的設計裡，解析層失敗會吃掉錯誤碼，順序必須是「先讀錯誤碼、再驗全形」；②測試 mock 要用**真實 API 失敗回應的原樣**（含 null 伴隨欄位），不是自己想像的最小形狀 | §2.2 值域枚舉（`null` 與「缺席」是不同值域）、§5.4 mock 一致性 |
| **把「部分成功可容忍」的多步驟寫入改成原子交易時，忘了盤點交易外已獨立提交的狀態**（T110／PR #72，max review 獨立 finder 交叉命中，跨 `ecpay/notify`＋`pending-payment-expire`＋`ecpay-reconcile` 三檔）：T110 把「UPDATE orders＋INSERT order_status_log」包進單一 RPC 交易後，webhook 卻是**先**翻 payment=paid（獨立一次提交）**再**推進訂單；推進段因 log 寫入失敗而 rollback 時只回滾 order＋log，交易**外**先提交的 payment=paid 不跟著回滾——留下 payment=paid／order=pending_payment 分歧。舊版此情境只是「訂單仍 paid、稽核缺漏」（可容忍），改原子後反而更糟：下游安全網以「被回滾那半」為鍵（reconcile 撈 payment=pending）撈不到，逾期取消 cron 又把它推向 cancelled＝「錢收了、單卻取消、無告警」的靜默 P0。單檔審查看不到（三檔交互），靠 max review 獨立 finder 才交叉命中。**改任何寫入的原子性／順序前先問三題：①這步 rollback 後，本交易外已經提交了什麼狀態？②有沒有兩個相關狀態方向相反而分歧？③哪個兜底以哪個欄位為鍵、撈得到這個新的中間態嗎？** 修法＝分歧兩端各加防護（expire cron 取消前排除已收款訂單、reconcile 新增分歧 sweep 補推進） | §3.1 狀態機（跨表狀態不變量：payment 與 order 的相對狀態）、§3.3 重試迴路（兜底候選鍵要涵蓋新中間態）、§3.4 擴散檢查（改一處語意要掃依賴它的其他模組） |
| **「未碰 DB」斷言在 fixture 讓該路徑本就不可達時，變成永遠成立的空話**（T131／PR #82 max re-review 二次審查抓到前一輪測試強化自身的漏洞，M1）：cart-cleanup 的 401 測試想斷言「未授權請求不得碰 SELECT／DELETE」，但 fixture 的 `candidates=[]` 讓 route 在 `ids.length===0` 就提前 return、DELETE 永遠到不了——即使把認證整段刪掉，`deleteFilters.ids` 仍恆 null，斷言永遠綠、零保護（真正抓到 reorder 的只有 `selectFilters.limit`）。這是 §5.4「反向驗證」存在的理由：把被測防線暫時移除，確認斷言真的轉紅。**寫「某路徑沒被走到」的斷言前，先確認 fixture 有讓那條路徑在防線失效時真的會被走到**（此例＝種一筆非空候選車讓 DELETE 可達），否則斷言測的是 fixture 形狀而非防線。延伸兩個同批（M2／M3）教訓：斷言值別硬寫魔術數字（改 import 常數，失敗訊息才有指向）；守衛只斷言「非 null／存在」抓不到值算錯或多份守衛脫鉤，關鍵值要斷言「相等／正確」（此例＝SELECT 與 DELETE 的 cutoff 必須相等） | §5.4 反向驗證（綠測試≠有效測試——先確認失效路徑在 fixture 下真的可達，再確認斷言值鎖的是「正確」不只「存在」） |

> 新 bug 進來時：先問「上表哪一條該攔到它卻沒攔到」——是條目缺失（補條目）還是沒執行（檢討流程）。兩者都不是才算真正的新知識。
