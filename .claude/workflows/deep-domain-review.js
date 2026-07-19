export const meta = {
  name: 'deep-domain-review',
  description: 'T47 退款 PR 的深度領域對抗審查（ultra 替代方案）：本 repo 專屬風險鏡頭 + 多視角對抗驗證',
  whenToUse: 'PR #86（T47 記錄式退款）需要比通用 code-review 更深的領域審查時',
  phases: [
    { title: 'Find', detail: '六個領域鏡頭平行發掘候選缺陷' },
    { title: 'Verify', detail: '每個候選由三位持不同視角的驗證者對抗覆核' },
    { title: 'Synthesize', detail: '完整性批判：檢查漏掉的模態' },
  ],
}

// ── 審查標的（單一出處，注入每個 agent） ─────────────────────────────
const TARGET = `審查標的：git branch claude/refine-local-plan-jn851k 相對 master 的 diff（PR #86）。
先跑 \`git diff master...HEAD\` 取得完整 diff，必要時 Read 相關檔案理解上下文。
核心檔案：
- src/lib/order/refund-order.ts（退款編排：payment→refunded、orders→refunded、冪等）
- src/lib/order/state-machine.ts（transitionOrder 退款守衛 RefundPaymentNotFlippedError、fetchCurrentStatus export）
- src/lib/order/order-status.ts（VALID_TRANSITIONS 加 completed→refunded）
- src/lib/order/find-paid-payment.ts（findRefundedPayment）
- src/app/admin/orders/[id]/actions.ts（refundOrderAction、changeStatus 擋 refunded）
- src/app/admin/orders/[id]/refund-section.tsx（UI、needsPaymentRepair 補登記）
- src/app/admin/orders/[id]/page.tsx（paidPayment 查詢）
- src/lib/notification/senders.ts（order_refunded 登記）
- src/lib/email/order-refunded-notification.ts（退款信、escapeHtml、Resend error）
- supabase/migrations/0019_support_request_status_check.sql（status check）

專案鐵律（違反即為缺陷）：伺服器端驗價；service-role 才可寫帳務鏈；SDK error 必檢（Supabase/Resend {data,error}）；並發去重用條件式 UPDATE 且 SET 改動 WHERE 欄位；serverless 禁 fire-and-forget（必 await）；客人輸入插 HTML 前必 escapeHtml；numeric 欄位比對/顯示前先 Number()。
權威文件：docs/coding-system.md、docs/security-foundation.md、docs/ops-runbook.md §6/§6.1/§8、CLAUDE.md §6。`

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          summary: { type: 'string', description: '一句話描述缺陷（中文）' },
          failure_scenario: { type: 'string', description: '具體觸發輸入/狀態 → 錯誤結果（中文）' },
        },
        required: ['file', 'summary', 'failure_scenario', 'severity'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'UNCERTAIN'] },
    reasoning: { type: 'string', description: '為何確認或駁回（中文，引用具體程式碼/契約）' },
  },
  required: ['verdict', 'reasoning'],
}

// ── 六個領域鏡頭（本 repo 專屬，與通用 code-review 角度互補） ──────────
const LENSES = [
  {
    key: 'state-interleaving',
    prompt: `${TARGET}

【鏡頭：狀態機交錯窮舉】窮舉退款流程與其他狀態變更路徑的時序交錯，找出金流漂移窗口：
- refundOrder（先翻 payment、後轉 orders）中途失敗/重試/並發重入的每一種收斂性。
- 退款 vs 逾期取消 cron、vs webhook 結算（payment 由 pending→paid）、vs shipOrder、vs adminOverrideStatus 的交錯——是否出現「payment 與 orders 狀態矛盾」或「錢收在已退款單/退款掛在未收款單」。
- transitionOrder 的 RefundPaymentNotFlippedError 守衛 + findRefundedPayment：§5 重複付款（同單多筆 paid 各自退刷）情境下，limit(1) 存在性檢查是否漏翻某筆 paid payment。
- needsPaymentRepair 補登記路徑（訂單已 refunded、payment 還 paid）的冪等與競態。
只報真實可觸發的時序缺陷，附具體交錯序列。`,
  },
  {
    key: 'security-invariants',
    prompt: `${TARGET}

【鏡頭：資安地基不變式】對照 docs/security-foundation.md 與 CLAUDE.md §6 的不變式，逐條驗證本 diff 是否繞過或失同步：
- 帳務鏈寫入是否全走 service-role（refund-order.ts、actions.ts）；有無前台可觸及的寫入路徑。
- requireAdmin 覆蓋每個新 server action（refundOrderAction）；有無漏驗。
- RLS/service-role 邊界；support_request status check（0019）是否與 app 層白名單一致。
- 伺服器端驗價紅線是否被本 diff 間接影響（退款金額來源＝orders.total_amount，是否可被竄改）。`,
  },
  {
    key: 'authz-bypass',
    prompt: `${TARGET}

【鏡頭：授權與旁路】把每個新/改動的 server action 當成可被攻擊者直接呼叫（繞過 UI）來分析：
- changeStatus 擋 to==='refunded' 是否完整封住旁路；overrideStatus 是否成為退款旁路（可繞過翻 payment/寄信）——這是文件化逃生口還是漏洞？
- refundOrderAction 的 reason 驗證、orderId 任意傳入（跨訂單）、狀態競態下的行為。
- UI 顯示條件（canRefund/needsPaymentRepair）與 server 端守衛是否一致，client 過濾是否被誤當安全邊界。`,
  },
  {
    key: 'notification-idempotency',
    prompt: `${TARGET}

【鏡頭：通知冪等鏈】追 order_refunded 通知從觸發到補寄的完整鏈路是否閉環：
- sendOnce 去重（notification unique(order_id,type)）：重複退款登記/補登記是否重複寄信。
- senders.ts NOTIFICATION_SENDERS 登記 order_refunded + eligibleStatuses:['refunded']：每日 reconcile sweep 補寄時，是否對非 refunded 訂單誤寄，或漏補。
- serverless 是否有 fire-and-forget（未 await）；寄信失敗的 warning 是否真的可被使用者看到。
- sendOrderRefundedNotification 的 Supabase 查詢 error 分類（PGRST116 vs 其他）、Resend {error} 轉 throw 是否正確。`,
  },
  {
    key: 'email-safety',
    prompt: `${TARGET}

【鏡頭：Email 安全與資料正確性】order-refunded-notification.ts：
- 所有客人衍生欄位（recipient_name 等）插入 HTML 前是否全部 escapeHtml；有無遺漏欄位（order_no、金額雖非自由輸入但仍檢查）。
- totalAmount 的 numeric→Number() 處理；toLocaleString 千分位；金額顯示是否可能錯排。
- member email 陣列/物件形狀的取值（Array.isArray 分支）是否正確；無 email 時的靜默跳過是否恰當。
- 退款原因刻意不進客人信件——確認 reason 真的沒洩漏到 email。`,
  },
  {
    key: 'migration-integrity',
    prompt: `${TARGET}

【鏡頭：Migration 與資料完整性】0019_support_request_status_check.sql：
- not valid → validate constraint 兩段式的正確性；validate 是否可能因歷史髒資料失敗。
- check 值域（pending/in_progress/completed/rejected）是否與所有寫入 support_request.status 的程式路徑一致（app 層 SUPPORT_STATUSES、admin action、有無其他寫入點）。
- 是否有任何路徑會寫入約束外的值（造成日後 UPDATE 失敗）。
- 還原註記、comment 更新、與 0006 的一致性。`,
  },
]

// ── Phase 1: 平行發掘 ────────────────────────────────────────────────
phase('Find')
const candidateSets = await parallel(
  LENSES.map((lens) => () =>
    agent(lens.prompt, {
      label: `find:${lens.key}`,
      phase: 'Find',
      schema: FINDING_SCHEMA,
      effort: 'high',
    }),
  ),
)

// 攤平 + 去重（同 file 近 line 視為同一缺陷）——barrier 正當：需要全部候選才能 dedup
const raw = candidateSets
  .filter(Boolean)
  .flatMap((r) => r.findings ?? [])
const seen = new Set()
const candidates = []
for (const f of raw) {
  const key = `${f.file}:${Math.round((f.line ?? 0) / 5)}:${(f.summary ?? '').slice(0, 24)}`
  if (seen.has(key)) continue
  seen.add(key)
  candidates.push(f)
}
log(`發掘 ${raw.length} 筆候選，去重後 ${candidates.length} 筆進入對抗驗證`)

if (candidates.length === 0) {
  return { verified: [], note: '六個領域鏡頭均未發掘候選缺陷' }
}

// ── Phase 2: 多視角對抗驗證（每候選三位持不同視角、預設駁回） ─────────
const VERIFY_LENSES = [
  { key: 'correctness', angle: '正確性：這個缺陷描述的程式行為是否真實存在？逐行讀實際程式碼，別信 finder 的轉述。' },
  { key: 'reproduce', angle: '可重現性：能否構造出具體輸入/狀態序列真的觸發它？若構造不出來就是 REFUTED。' },
  { key: 'context', angle: '上下文/契約：現有守衛、DB 約束、上游呼叫端契約、或註解中已說明的取捨是否早已擋掉它？' },
]

const verified = await pipeline(
  candidates,
  (cand) =>
    parallel(
      VERIFY_LENSES.map((v) => () =>
        agent(
          `${TARGET}

【對抗驗證 — ${v.key} 視角】預設立場：這個 finding 是誤報（REFUTED），除非你能用實際程式碼證明它為真。
${v.angle}

待驗證 finding：
- 檔案：${cand.file}${cand.line ? `:${cand.line}` : ''}
- 嚴重度：${cand.severity}
- 描述：${cand.summary}
- 失效情境：${cand.failure_scenario}

讀實際程式碼與相關契約後裁決。不確定或無法重現一律 REFUTED/UNCERTAIN，不放水。`,
          {
            label: `verify:${v.key}:${cand.file.split('/').pop()}`,
            phase: 'Verify',
            schema: VERDICT_SCHEMA,
            effort: 'high',
          },
        ),
      ),
    ).then((votes) => {
      const valid = votes.filter(Boolean)
      const confirmed = valid.filter((x) => x.verdict === 'CONFIRMED').length
      // 三票需至少兩票 CONFIRMED 才算存活（多數對抗）
      return {
        ...cand,
        survives: confirmed >= 2,
        votes: valid.map((x) => ({ verdict: x.verdict, reasoning: x.reasoning })),
      }
    }),
)

const survivors = verified.filter(Boolean).filter((f) => f.survives)
log(`對抗驗證後存活 ${survivors.length}/${candidates.length} 筆`)

// ── Phase 3: 完整性批判 ──────────────────────────────────────────────
phase('Synthesize')
const critique = await agent(
  `${TARGET}

【完整性批判】以上六個領域鏡頭已跑完，存活的確認缺陷如下：
${survivors.length ? survivors.map((s, i) => `${i + 1}. [${s.severity}] ${s.file} — ${s.summary}`).join('\n') : '（無存活缺陷）'}

請批判這次審查的覆蓋完整性：有沒有哪個風險模態沒被上述六鏡頭涵蓋？（例如：Sentry 告警語意是否正確、revalidatePath 快取是否漏刷、error boundary 行為、型別安全的邊界、測試是否漏掉關鍵情境）。
若你發現任何六鏡頭遺漏的、且你能用實際程式碼佐證的真實缺陷，列出來（附 file/line/失效情境）；沒有就明說「覆蓋完整、無遺漏」。`,
  { label: 'completeness-critic', phase: 'Synthesize', effort: 'high' },
)

const severityRank = { blocker: 0, high: 1, medium: 2, low: 3 }
survivors.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))

return {
  verified: survivors,
  totalCandidates: candidates.length,
  survived: survivors.length,
  completenessCritique: critique,
}
