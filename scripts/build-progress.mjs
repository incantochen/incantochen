// build-progress.mjs — 從 docs/tasks-todo.csv ＋ docs/tasks-done.md 產生 docs/progress.html
//
// 用途：把「開發進度」做成可分享的靜態儀表板。資料唯一權威仍是那兩個檔，
//       本 HTML 只是衍生視圖——想看最新就重跑：`node scripts/build-progress.mjs`（或 pnpm build:progress）。
// 特性：不改任何來源檔、無外部相依（純 Node 標準庫）、輸出單一自帶樣式 HTML。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TODO_PATH = resolve(ROOT, "docs/tasks-todo.csv");
const DONE_PATH = resolve(ROOT, "docs/tasks-done.md");
const OUT_PATH = resolve(ROOT, "docs/progress.html");

// ---- 里程碑呈現設定（純展示層）----
const PHASE_ORDER = ["M-1", "M0", "M1", "M2", "M3", "M4", "M5", "後續"];
const PHASE_LABEL = {
  "M-1": "規劃",
  M0: "基建",
  M1: "核心交易",
  M2: "品質／後台",
  M3: "商品後台",
  M4: "前台完善",
  M5: "上線準備",
  後續: "後續擴充",
};

// ---- 小工具 ----
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 引號感知的 CSV parser（處理欄位內逗號／換行／跳脫雙引號）
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      /* skip */
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---- 解析待辦 CSV ----
// 欄位：ID,階段,模組,任務,說明,依賴,預估(人天),累積人天,優先級,狀態
function loadTodo() {
  const rows = parseCsv(readFileSync(TODO_PATH, "utf8"));
  return rows
    .slice(1)
    .filter((r) => /^(T|P)\d+/.test((r[0] || "").trim()))
    .map((r) => {
      const rawTitle = r[3] || "";
      const launch = rawTitle.includes("🚀");
      const title = rawTitle
        .replace(/🚀/g, "")
        .replace(/^[◆●・\s]+/, "")
        .trim();
      return {
        id: r[0].trim(),
        phase: (r[1] || "").trim(),
        title,
        priority: (r[8] || "").trim(),
        rawStatus: (r[9] || "").trim(),
        launch,
      };
    });
}

// ---- 解析完成索引 md ----
// 章節：## M2（47）   條目：- **T##** 標題 · ✅完成 · PR #n — 摘要
function loadDone() {
  const items = [];
  let cur = null;
  for (const line of readFileSync(DONE_PATH, "utf8").split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)（\d+）/);
    if (h) {
      cur = h[1].trim();
      continue;
    }
    const b = line.match(/^-\s+\*\*((?:T|P)\d+)\*\*\s+(.*)$/);
    if (b && cur) {
      const rest = b[2];
      const cancelled = /🚫\s*取消/.test(rest);
      const title = rest.split("·")[0].trim();
      const prs = [...rest.matchAll(/PR\s*#(\d+)/g)].map((m) => m[1]);
      items.push({ id: b[1], phase: cur, title, cancelled, prs });
    }
  }
  return items;
}

// ---- 匯總 ----
const todo = loadTodo();
const done = loadDone();

const stats = PHASE_ORDER.map((p) => {
  const d = done.filter((x) => x.phase === p).length;
  const t = todo.filter((x) => x.phase === p).length;
  const total = d + t;
  return {
    phase: p,
    label: PHASE_LABEL[p] || p,
    done: d,
    todo: t,
    total,
    pct: total ? Math.round((d / total) * 100) : 0,
  };
}).filter((s) => s.total > 0);

const totalDone = done.length;
const totalTodo = todo.length;
const grand = totalDone + totalTodo;
const grandPct = grand ? Math.round((totalDone / grand) * 100) : 0;

const launchP0 = todo.filter((t) => t.launch && t.priority === "P0");
const inProgress = todo.filter((t) => /進行中/.test(t.rawStatus));

// ---- 建立統一任務表（待辦＋完成）----
const priRank = { P0: 0, P1: 1, P2: 2, P3: 3, "": 9 };
const idNum = (id) => parseInt(id.replace(/^\D+/, ""), 10) || 0;
const allTasks = [
  ...todo.map((t) => ({
    id: t.id,
    phase: t.phase,
    title: t.title,
    priority: t.priority,
    status: /進行中/.test(t.rawStatus) ? "進行中" : "待辦",
    launch: t.launch,
    prs: [],
  })),
  ...done.map((d) => ({
    id: d.id,
    phase: d.phase,
    title: d.title,
    priority: "",
    status: d.cancelled ? "取消" : "完成",
    launch: false,
    prs: d.prs,
  })),
].sort((a, b) => {
  const pa = PHASE_ORDER.indexOf(a.phase);
  const pb = PHASE_ORDER.indexOf(b.phase);
  if (pa !== pb) return pa - pb;
  return idNum(a.id) - idNum(b.id);
});

// ---- HTML 片段 ----
const buildStamp = new Date().toLocaleString("zh-TW", {
  timeZone: "Asia/Taipei",
  hour12: false,
});

const overviewCards = `
  <div class="cards">
    <div class="card"><div class="num">${grandPct}<span class="pct">%</span></div><div class="lbl">全專案完成度</div></div>
    <div class="card"><div class="num">${totalDone}</div><div class="lbl">已結案</div></div>
    <div class="card"><div class="num">${totalTodo}</div><div class="lbl">待辦</div></div>
    <div class="card"><div class="num">${grand}</div><div class="lbl">任務總數</div></div>
    <div class="card accent-card"><div class="num">${launchP0.length}</div><div class="lbl">🚀 上線前必做 (P0)</div></div>
  </div>`;

const milestoneRows = stats
  .map((s) => {
    const cls = s.pct === 100 ? "done" : s.done === 0 ? "empty" : "wip";
    return `
    <div class="ms ${cls}">
      <div class="ms-head">
        <span class="ms-name">${esc(s.phase)} · ${esc(s.label)}</span>
        <span class="ms-frac"><b>${s.done} / ${s.total}</b><span class="ms-pct">${s.pct}%</span></span>
      </div>
      <div class="bar"><div class="fill" style="width:${s.pct}%"></div></div>
    </div>`;
  })
  .join("");

const launchList = launchP0.length
  ? `<ul class="launch-list">${launchP0
      .map(
        (t) =>
          `<li><span class="tag ms-tag">${esc(t.phase)}</span><span class="tag pri P0">P0</span> <b>${esc(
            t.id
          )}</b> — ${esc(t.title)}</li>`
      )
      .join("")}</ul>`
  : `<p class="muted">目前無 🚀 P0 待辦。</p>`;

const inProgressList = inProgress.length
  ? `<ul class="launch-list">${inProgress
      .map(
        (t) =>
          `<li><span class="tag ms-tag">${esc(t.phase)}</span><span class="tag pri ${esc(
            t.priority
          )}">${esc(t.priority)}</span> <b>${esc(t.id)}</b> — ${esc(t.title)}</li>`
      )
      .join("")}</ul>`
  : `<p class="muted">目前無標記「進行中」的任務。</p>`;

const taskRows = allTasks
  .map((t) => {
    const search = (t.id + " " + t.title).toLowerCase();
    const mp = t.priority ? `${t.phase}, ${t.priority}` : t.phase;
    const prLinks = t.prs
      .map(
        (n) =>
          `<a href="https://github.com/incantochen/incantochen/pull/${n}">#${n}</a>`
      )
      .join(" ");
    return `<tr data-search="${esc(search)}" data-status="${esc(
      t.status
    )}" data-pri="${esc(t.priority)}" data-ms="${esc(t.phase)}">
      <td class="c-id">${t.launch ? '<span class="rocket">🚀</span>' : ""}${esc(
      t.id
    )}</td>
      <td class="c-mp">${esc(mp)}</td>
      <td class="c-title">${esc(t.title)}</td>
      <td class="c-status"><span class="st st-${esc(t.status)}">${esc(
      t.status
    )}</span></td>
      <td class="c-pr">${prLinks}</td>
    </tr>`;
  })
  .join("");

const msChips = PHASE_ORDER.filter((p) => stats.some((s) => s.phase === p))
  .map((p) => `<button class="chip" data-group="ms" data-val="${esc(p)}">${esc(p)}</button>`)
  .join("");

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>incantochen · 開發進度</title>
<style>
:root{
  --bg:#f7f6f3; --panel:#ffffff; --ink:#1c211f; --muted:#6b726e; --line:#e5e3dd;
  --accent:#0B6E63; --accent-soft:#0b6e6318; --rocket:#b8632a;
  --p0:#b23b3b; --p1:#b8862b; --p2:#2f6f9e; --p3:#7a807c;
  --ok:#2e7d54; --wip:#b8862b; --todo:#7a807c; --cancel:#a7aaa6;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#14171a; --panel:#1c2024; --ink:#e8eae7; --muted:#9aa19c; --line:#2b3035;
    --accent:#4cb8a8; --accent-soft:#4cb8a822; --rocket:#e0894f;
    --p0:#e07070; --p1:#ddb15a; --p2:#6fa6cf; --p3:#9aa19c;
    --ok:#5fc38a; --wip:#ddb15a; --todo:#9aa19c; --cancel:#6c716d;
  }
}
:root[data-theme="light"]{ --bg:#f7f6f3; --panel:#ffffff; --ink:#1c211f; --muted:#6b726e; --line:#e5e3dd; --accent:#0B6E63; --accent-soft:#0b6e6318; }
:root[data-theme="dark"]{ --bg:#14171a; --panel:#1c2024; --ink:#e8eae7; --muted:#9aa19c; --line:#2b3035; --accent:#4cb8a8; --accent-soft:#4cb8a822; }
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;
  line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:32px 20px 80px}
header.top{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;border-bottom:2px solid var(--accent);padding-bottom:14px;margin-bottom:8px}
header.top h1{margin:0;font-size:22px;letter-spacing:.02em}
header.top .stamp{color:var(--muted);font-size:12.5px}
h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:34px 0 14px;font-weight:700}
.muted{color:var(--muted)}
/* 卡片 */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.card .num{font-size:30px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.1}
.card .num .pct{font-size:17px;font-weight:600;margin-left:2px}
.card .lbl{color:var(--muted);font-size:12.5px;margin-top:4px}
.accent-card{background:var(--accent-soft);border-color:var(--accent)}
/* 里程碑條 */
.ms{margin:14px 0}
.ms-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;font-size:14px}
.ms-name{font-weight:600}
.ms-frac{font-variant-numeric:tabular-nums;color:var(--muted)}
.ms-frac b{color:var(--ink)}
.ms-pct{display:inline-block;min-width:44px;text-align:right;margin-left:10px;font-weight:700;color:var(--accent)}
.bar{height:9px;background:var(--line);border-radius:99px;overflow:hidden}
.fill{height:100%;background:var(--accent);border-radius:99px;transition:width .4s ease}
.ms.done .fill{background:var(--ok)}
.ms.empty .ms-pct{color:var(--muted)}
/* 清單 */
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px 18px}
.launch-list{list-style:none;margin:0;padding:8px 0}
.launch-list li{padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.launch-list li:last-child{border-bottom:0}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:6px;margin-right:5px;vertical-align:middle;font-variant-numeric:tabular-nums}
.ms-tag{background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent)}
.pri{color:#fff}
.pri.P0{background:var(--p0)} .pri.P1{background:var(--p1)} .pri.P2{background:var(--p2)} .pri.P3{background:var(--p3)}
/* 篩選＋表格 */
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
#search{flex:1;min-width:200px;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:9px 12px;color:var(--ink);font-size:14px}
#search:focus{outline:2px solid var(--accent);outline-offset:1px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:99px;padding:4px 11px;font-size:12.5px;cursor:pointer;font-weight:600}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:640px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:var(--panel);color:var(--muted);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;z-index:1}
tr:last-child td{border-bottom:0}
.c-id{white-space:nowrap;font-weight:700;font-variant-numeric:tabular-nums}
.c-mp{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
.c-pr{white-space:nowrap}
.c-pr a{color:var(--accent);text-decoration:none}
.c-pr a:hover{text-decoration:underline}
.rocket{margin-right:3px}
.st{font-size:11.5px;font-weight:700;white-space:nowrap}
.st-完成{color:var(--ok)} .st-待辦{color:var(--todo)} .st-進行中{color:var(--wip)} .st-取消{color:var(--cancel);text-decoration:line-through}
.count-note{color:var(--muted);font-size:12.5px;margin:10px 2px 0}
footer{margin-top:40px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
footer code{background:var(--accent-soft);padding:1px 6px;border-radius:5px;color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>incantochen · 開發進度</h1>
    <span class="stamp">產生於 ${esc(buildStamp)}（台北）</span>
  </header>
  <p class="muted" style="margin-top:8px">資料來源：<code style="all:unset">docs/tasks-todo.csv</code> ＋ <code style="all:unset">docs/tasks-done.md</code>（唯一權威）。本頁為衍生快照，重跑 build 即刷新。</p>

  ${overviewCards}

  <h2>里程碑進度</h2>
  ${milestoneRows}

  <h2>🚀 上線前必做（P0）</h2>
  <div class="panel">${launchList}</div>

  <h2>進行中</h2>
  <div class="panel">${inProgressList}</div>

  <h2>全部任務（${allTasks.length}）</h2>
  <div class="controls">
    <input id="search" type="search" placeholder="搜尋 ID 或標題…（例：T106、購物車）" autocomplete="off">
  </div>
  <div class="controls">
    <div class="chips" id="chips-ms">${msChips}</div>
  </div>
  <div class="controls">
    <div class="chips" id="chips-status">
      <button class="chip" data-group="status" data-val="待辦">待辦</button>
      <button class="chip" data-group="status" data-val="進行中">進行中</button>
      <button class="chip" data-group="status" data-val="完成">完成</button>
      <button class="chip" data-group="status" data-val="取消">取消</button>
    </div>
    <div class="chips" id="chips-pri">
      <button class="chip" data-group="pri" data-val="P0">P0</button>
      <button class="chip" data-group="pri" data-val="P1">P1</button>
      <button class="chip" data-group="pri" data-val="P2">P2</button>
      <button class="chip" data-group="pri" data-val="P3">P3</button>
    </div>
  </div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>ID</th><th>(M, P)</th><th>任務</th><th>狀態</th><th>PR</th></tr></thead>
      <tbody id="tbody">${taskRows}</tbody>
    </table>
  </div>
  <p class="count-note" id="count-note"></p>

  <footer>
    刷新方式：<code>node scripts/build-progress.mjs</code>（或 <code>pnpm build:progress</code>）→ 重開本頁。
    (M, P)＝里程碑, 優先級；完成任務不標優先級。
  </footer>
</div>
<script>
(function(){
  var rows = Array.prototype.slice.call(document.querySelectorAll('#tbody tr'));
  var search = document.getElementById('search');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var note = document.getElementById('count-note');
  var active = { ms:new Set(), status:new Set(), pri:new Set() };

  function apply(){
    var q = search.value.trim().toLowerCase();
    var shown = 0;
    rows.forEach(function(r){
      var okText = !q || r.getAttribute('data-search').indexOf(q) !== -1;
      var okMs = active.ms.size === 0 || active.ms.has(r.getAttribute('data-ms'));
      var okSt = active.status.size === 0 || active.status.has(r.getAttribute('data-status'));
      var okPr = active.pri.size === 0 || active.pri.has(r.getAttribute('data-pri'));
      var vis = okText && okMs && okSt && okPr;
      r.style.display = vis ? '' : 'none';
      if(vis) shown++;
    });
    note.textContent = '顯示 ' + shown + ' / ' + rows.length + ' 筆';
  }
  search.addEventListener('input', apply);
  chips.forEach(function(c){
    c.addEventListener('click', function(){
      var g = c.getAttribute('data-group'), v = c.getAttribute('data-val');
      if(active[g].has(v)){ active[g].delete(v); c.classList.remove('on'); }
      else { active[g].add(v); c.classList.add('on'); }
      apply();
    });
  });
  apply();
})();
</script>
</body>
</html>`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, html, "utf8");
console.log(
  `✅ 已產生 ${OUT_PATH}\n   里程碑 ${stats.length} 個｜已結案 ${totalDone}｜待辦 ${totalTodo}｜總數 ${grand}｜完成度 ${grandPct}%\n   🚀 P0 上線必做 ${launchP0.length}｜進行中 ${inProgress.length}`
);
