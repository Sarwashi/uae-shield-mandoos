const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ✅ Render/Railway use PORT env
const PORT = process.env.PORT || 4646;
const HOST = "0.0.0.0";
const TOTAL = 30;

// غيّر PIN إذا تبي حماية للوحة التحكم
const ADMIN_PIN = "U-S";

// =====================
// FX (Overlay) - ONE FILE (Video + Audio inside)
// =====================
// ✅ حط داخل /assets ملفات فيها صوت داخل الفيديو
const WIN_FX    = "/assets/win_fx.webm";
const LOSE_FX   = "/assets/lose_fx.webm";
const LEGEND_FX = "/assets/legend_fx.webm";

// =====================
// PRIZES (Royal / Emirati)
// =====================
// الجوائز الأيقونية = legendary:true
const PRIZES = [
  // 🏆 LEGENDARY (جوائز كبرى)
  { label: "👑 مرشح للاداره العليا ", legendary: true,  icon: "👑" },
  { label: "🦅 100$ CASH ",         legendary: true,  icon: "🦅" },
  { label: "🗡️  ID ثلاثي ",        legendary: true,  icon: "🗡️" },
  { label: "💎 150$ مشتريات المتجر", legendary: true, icon: "💎" },

  // ⭐ Regular prizes
  { label: "🦸 حزمة سوبر هيرو", legendary: false, icon: "🦸" },
  { label: "🦸 حزمة هاي كلاس", legendary: false, icon: "🦸" },
  { label: "🎖️ ترقية", legendary: false, icon: "🎖️" },
  { label: "🎖️ ID رباعي", legendary: false, icon: "🎖️" },
  { label: "🎖️ ترقيتين ", legendary: false, icon: "🎖️" },
  { label: "🎖️ V2-m", legendary: false, icon: "🎖️" },
  { label: "🎖️ ترقية إلى رتبة ماجستيك", legendary: false, icon: "🎖️" },
  { label: "🎁 nitro game", legendary: false, icon: "🎁" },
  { label: "🎁 steam gift 10$", legendary: false, icon: "🎁" },
  { label: "🎁 amazon gift 25$", legendary: false, icon: "🎁" },
  { label: "🎁 noon gift 20$", legendary: false, icon: "🎁" },
  { label: "🎁 اختار صندوق آخر", legendary: false, icon: "🎁" },
  { label: "💰 25$ cash", legendary: false, icon: "💰" },
];

// =====================
// LOG SETUP
// =====================
const LOG_FILE = path.join(__dirname, "logs.json");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));

function readLogs() {
  try { return JSON.parse(fs.readFileSync(LOG_FILE, "utf-8")); }
  catch { return []; }
}
function addLog(entry) {
  const data = readLogs();
  data.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

// =====================
// GAME STATE
// =====================
// boxes: each index = { type:"EMPTY" } or { type:"PRIZE", prize:{...} }
let boxes = [];
let picked = new Set();

// المشاركين (IDs)
let participants = []; // array of strings

// lastResult: يظهر في الأوفرلاي
let lastResult = {
  time: Date.now(),
  text: "جاهزين… اكتب اسم اللاعب واختر رقم 🎁",
  box: null,
  player: "",
  isWin: false,
  isLegend: false,
  fx: null
};

function shuffleRound() {
  // initialize empty
  boxes = Array.from({ length: TOTAL }, () => ({ type: "EMPTY" }));
  picked = new Set();

  // place prizes randomly without overlap
  const used = new Set();
  for (const prize of PRIZES) {
    if (used.size >= TOTAL) break;
    let idx;
    do idx = Math.floor(Math.random() * TOTAL);
    while (used.has(idx));
    used.add(idx);
    boxes[idx] = { type: "PRIZE", prize };
  }

  lastResult = {
    time: Date.now(),
    text: "✅ راوند جديد بدأ! اكتب اسم اللاعب واختر رقم 🎁",
    box: null,
    player: "",
    isWin: false,
    isLegend: false,
    fx: null
  };
}

shuffleRound();

// =====================
// HELPERS
// =====================
function send(res, status, body, type = "text/html; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function json(res, obj) {
  send(res, 200, JSON.stringify(obj), "application/json; charset=utf-8");
}
function isAuthed(url) {
  const pin = url.searchParams.get("pin");
  return !ADMIN_PIN || pin === ADMIN_PIN;
}
function normId(s) { return String(s || "").trim(); }

function addParticipant(id) {
  id = normId(id);
  if (!id) return { ok: false, msg: "❌ اكتب ID صحيح" };
  if (participants.includes(id)) return { ok: false, msg: "⚠️ هذا الـID موجود مسبقاً" };
  participants.push(id);
  return { ok: true, msg: `✅ تم إضافة ID: ${id}` };
}
function removeParticipant(id) {
  id = normId(id);
  const before = participants.length;
  participants = participants.filter(x => x !== id);
  return before !== participants.length;
}
function pickRandomFromParticipants(count = 1, removeAfter = false) {
  const pool = [...participants];
  if (pool.length === 0) return { ok: false, msg: "⚠️ ما في IDs بالقائمة" };
  count = Math.max(1, Math.min(count, pool.length));

  const winners = [];
  while (winners.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool[idx]);
    pool.splice(idx, 1);
  }

  if (removeAfter) {
    const winSet = new Set(winners);
    participants = participants.filter(x => !winSet.has(x));
  }

  return { ok: true, winners };
}

// Serve files (assets)
function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".mp3" ? "audio/mpeg" :
    ext === ".wav" ? "audio/wav" :
    ext === ".ogg" ? "audio/ogg" :
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".webp" ? "image/webp" :
    ext === ".svg" ? "image/svg+xml" :
    ext === ".gif" ? "image/gif" :
    ext === ".webm" ? "video/webm" :
    ext === ".mp4" ? "video/mp4" :
    "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not Found", "text/plain; charset=utf-8");
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(data);
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

// =====================
// ROYAL / EMIRATI UI
// =====================
function uiPage(pin) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>UAE SHIELD • MANDOOS Control</title>
<style>
  :root{
    --bg:#05050a; --card:#0f1017; --border:rgba(255,255,255,.08);
    --gold:#d6b25e; --gold2:#f3dd9d; --text:#fff; --muted:rgba(255,255,255,.65);
    --danger:#ff4d6d; --ok:#39ffb6; --shadow: 0 18px 60px rgba(0,0,0,.55);
    --radius:18px;
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    font-family: system-ui, "Segoe UI", Tahoma, Arial;
    color:var(--text);
    background:
      radial-gradient(1200px 600px at 50% 0%, rgba(214,178,94,.20) 0%, rgba(0,0,0,0) 55%),
      radial-gradient(900px 450px at 80% 20%, rgba(120,80,255,.10) 0%, rgba(0,0,0,0) 60%),
      linear-gradient(180deg, #05050a, #05050a);
    min-height:100vh;
  }
  .pattern{
    position:fixed; inset:0; pointer-events:none; opacity:.15;
    background-image:
      radial-gradient(circle at 20% 20%, rgba(214,178,94,.18), transparent 45%),
      radial-gradient(circle at 80% 30%, rgba(214,178,94,.12), transparent 45%),
      radial-gradient(circle at 50% 80%, rgba(214,178,94,.10), transparent 55%);
    mix-blend-mode: screen;
  }
  .arabesque{
    position:fixed; inset:-20px; pointer-events:none; opacity:.10;
    background-image: url("/assets/pattern.svg");
    background-size: 520px;
    background-repeat: repeat;
  }
  .wrap{max-width:1180px;margin:18px auto;padding:16px;}
  .header{
    display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;
    background: linear-gradient(180deg, rgba(214,178,94,.16), rgba(15,16,23,.92));
    border:1px solid rgba(214,178,94,.24);
    border-radius:22px;
    padding:14px 16px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(10px);
  }
  .brand{display:flex;gap:12px;align-items:center;}
  .brand img{height:50px;width:auto;filter: drop-shadow(0 0 10px rgba(214,178,94,.55));}
  .brand h1{margin:0;font-size:18px;}
  .brand p{margin:2px 0 0 0;color:var(--muted);font-size:12px}
  .meta{
    display:flex;gap:10px;align-items:center;flex-wrap:wrap;
    color:var(--muted);font-size:12px;
  }
  .pill{
    padding:7px 10px;border-radius:999px;
    border:1px solid rgba(214,178,94,.28);
    background: rgba(0,0,0,.25);
  }
  .pill b{color:var(--gold2)}
  .links a{color:var(--gold2);text-decoration:none;font-weight:900}
  .grid{
    margin-top:14px;
    display:grid;
    grid-template-columns: 1.3fr .7fr;
    gap:14px;
  }
  @media (max-width: 980px){ .grid{grid-template-columns:1fr} }
  .card{
    background: linear-gradient(180deg, rgba(18,20,35,.88), rgba(10,10,16,.75));
    border:1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 10px 35px rgba(0,0,0,.45);
    overflow:hidden;
  }
  .cardHead{
    padding:12px 14px;
    border-bottom:1px solid rgba(255,255,255,.08);
    display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  }
  .cardHead h2{margin:0;font-size:14px;color:var(--gold2)}
  .tabs{display:flex;gap:8px;flex-wrap:wrap}
  .tab{
    border:1px solid rgba(214,178,94,.25);
    background: rgba(0,0,0,.25);
    color:#fff;
    padding:9px 12px;
    border-radius:14px;
    cursor:pointer;
    font-weight:1000;
    transition:.15s;
  }
  .tab.active{
    background: rgba(214,178,94,.20);
    border-color: rgba(214,178,94,.62);
    transform: translateY(-1px);
  }
  .cardBody{padding:14px}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  input, select{
    padding:11px 12px;border-radius:14px;
    border:1px solid rgba(214,178,94,.20);
    background: rgba(0,0,0,.25);
    color:#fff;
    font-weight:900;
    outline:none;
    min-width: 200px;
  }
  input::placeholder{color: rgba(255,255,255,.45)}
  .btn{
    padding:11px 12px;border-radius:14px;
    border:1px solid rgba(214,178,94,.28);
    background: rgba(0,0,0,.25);
    color:#fff;font-weight:1000;
    cursor:pointer;
    transition:.15s;
    display:inline-flex;align-items:center;gap:8px;
  }
  .btn:hover{transform:translateY(-1px);border-color:rgba(243,221,157,.78)}
  .btn.ok{border-color: rgba(57,255,182,.35)}
  .btn.danger{border-color: rgba(255,77,109,.40)}
  .btn.small{padding:8px 10px;border-radius:12px;font-weight:1000}
  .resultBox{
    margin-top:10px;
    padding:14px 14px;
    border-radius:16px;
    border:1px solid rgba(214,178,94,.18);
    background: rgba(0,0,0,.22);
    font-size:16px;
    line-height:1.4;
  }
  .stats{
    display:grid;
    grid-template-columns: repeat(3,1fr);
    gap:10px;
    margin-top:12px;
  }
  @media (max-width: 520px){
    .stats{grid-template-columns:1fr}
    input{min-width: 100%}
  }
  .stat{
    padding:12px 12px;border-radius:16px;
    border:1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.04);
  }
  .stat .k{color:var(--muted);font-size:12px}
  .stat .v{font-size:18px;font-weight:1100;margin-top:4px}
  .stat .v b{color:var(--gold2)}
  .boxes{
    display:grid;
    grid-template-columns: repeat(7, 1fr);
    gap:10px;
  }
  @media (max-width: 700px){ .boxes{grid-template-columns: repeat(5, 1fr);} }
  @media (max-width: 520px){ .boxes{grid-template-columns: repeat(4, 1fr);} }
  .boxbtn{
    padding:14px 0;border-radius:18px;
    border:1px solid rgba(214,178,94,.28);
    background: linear-gradient(180deg, rgba(214,178,94,.16), rgba(0,0,0,.25));
    color:#fff;
    font-size:16px;
    font-weight:1100;
    cursor:pointer;
    transition:.15s;
    box-shadow: 0 8px 22px rgba(0,0,0,.25);
  }
  .boxbtn:hover{transform:translateY(-2px);border-color:rgba(243,221,157,.80)}
  .boxbtn.picked{
    opacity:.42; cursor:not-allowed;
    background: rgba(255,255,255,.04);
    border-color: rgba(255,255,255,.10);
    box-shadow:none; transform:none;
  }
  .list{display:flex;flex-direction:column;gap:10px;}
  .idItem{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:10px 12px;border-radius:16px;
    border:1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.04);
  }
  .idItem b{font-size:14px}
  .muted{color:var(--muted);font-size:12px}
  .toast{
    position:fixed;left:16px;bottom:16px;z-index:9999;
    min-width: 260px;
    max-width: min(420px, 92vw);
    background: rgba(15,16,23,.92);
    border:1px solid rgba(214,178,94,.25);
    box-shadow: var(--shadow);
    padding:12px 14px;
    border-radius:16px;
    display:none;
    backdrop-filter: blur(10px);
  }
  .toast.show{display:block;animation:pop .2s ease-out}
  @keyframes pop{from{transform:translateY(8px);opacity:.4}to{transform:translateY(0);opacity:1}}
  .toast .t{font-weight:1100}
  .toast .s{margin-top:4px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
  <div class="pattern"></div>
  <div class="arabesque"></div>

  <div class="wrap">
    <div class="header">
      <div class="brand">
        <img src="/assets/logo.png" alt="logo" />
        <div>
          <h1>🧰 UAE SHIELD • لعبة المندوس — ${TOTAL} صندوق</h1>
          <p>Royal Emirati Theme • جوائز أسطورية بأثر خاص (فيديو + صوت)</p>
        </div>
      </div>
      <div class="meta">
        <div class="pill">Opened: <b id="opened">0</b> • Left: <b id="left">0</b></div>
        <div class="pill">IDs: <b id="idsCount">0</b></div>
        <div class="pill links">
          <a target="_blank" href="/overlay">Overlay</a> •
          <a target="_blank" href="/logs?pin=${pin || ""}">Logs</a>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="cardHead">
          <h2>🎁 التحكم باللعبة</h2>
          <div class="tabs">
            <button class="tab active" data-tab="play">اللعب</button>
            <button class="tab" data-tab="ids">IDs</button>
            <button class="tab" data-tab="tools">أدوات</button>
          </div>
        </div>

        <div class="cardBody">
          <div id="tab-play">
            <div class="row">
              <input id="player" placeholder="اسم اللاعب (مثال: جهيمان)" />
              <button class="btn ok" onclick="newRound()">🔄 راوند جديد</button>
              <button class="btn danger" onclick="resetLast()">🧼 تصفير الأوفرلاي</button>
            </div>

            <div class="resultBox" id="result">جاري التحميل…</div>

            <div class="stats">
              <div class="stat"><div class="k">آخر لاعب</div><div class="v"><b id="lastPlayer">—</b></div></div>
              <div class="stat"><div class="k">آخر صندوق</div><div class="v"><b id="lastBox">—</b></div></div>
              <div class="stat"><div class="k">آخر نوع</div><div class="v"><b id="lastType">—</b></div></div>
            </div>

            <div style="margin-top:14px" class="boxes" id="boxes"></div>
          </div>

          <div id="tab-ids" style="display:none">
            <div class="row">
              <input id="pid" placeholder="ID المشارك (مثال: -774)" style="min-width:170px" />
              <button class="btn ok" onclick="addId()">➕ إضافة</button>
              <button class="btn danger" onclick="clearIds()">🗑️ تصفير IDs</button>
            </div>

            <div class="row" style="margin-top:10px">
              <select id="drawCount">
                <option value="1">سحب 1</option>
                <option value="2">سحب 2</option>
                <option value="3">سحب 3</option>
                <option value="5">سحب 5</option>
              </select>
              <label class="btn" style="cursor:default">
                <input id="removeAfter" type="checkbox" style="min-width:auto;margin-left:8px;accent-color: var(--gold)" checked />
                حذف بعد السحب
              </label>
              <button class="btn ok" onclick="draw()">🎲 سحب عشوائي</button>
            </div>

            <div style="margin-top:12px" class="muted">القائمة (تحديث مباشر):</div>
            <div style="margin-top:10px" class="list" id="idList"></div>
          </div>

          <div id="tab-tools" style="display:none">
            <div class="row">
              <button class="btn" onclick="reveal()">👁️ Reveal الجوائز</button>
              <button class="btn" onclick="openLogs()">📜 فتح السجلات</button>
            </div>
            <div class="muted" style="margin-top:12px">
              Overlay بدون PIN: <b>/overlay</b><br/>
              لوحة التحكم مع PIN: <b>/?pin=...</b>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="cardHead"><h2>⚡ تحكم سريع</h2></div>
        <div class="cardBody">
          <div class="muted">اختصارات للستريم:</div>

          <div style="margin-top:10px" class="row">
            <button class="btn ok" style="flex:1" onclick="newRound()">🔄 راوند جديد</button>
            <button class="btn danger" style="flex:1" onclick="resetLast()">🧼 تصفير</button>
          </div>

          <div style="margin-top:10px" class="row">
            <button class="btn ok" style="flex:1" onclick="draw()">🎲 سحب IDs</button>
            <button class="btn" style="flex:1" onclick="reveal()">👁️ Reveal</button>
          </div>

          <div class="resultBox" style="margin-top:12px">
            <div class="muted">🎬 Overlay</div>
            <div style="margin-top:6px;font-weight:1100">
              <a style="color:var(--gold2);text-decoration:none" target="_blank" href="/overlay">افتح /overlay</a>
            </div>
          </div>

          <div class="resultBox" style="margin-top:12px">
            <div class="muted">📜 Logs</div>
            <div style="margin-top:6px;font-weight:1100">
              <a style="color:var(--gold2);text-decoration:none" target="_blank" href="/logs?pin=${pin || ""}">افتح /logs</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">
    <div class="t" id="toastT">—</div>
    <div class="s" id="toastS">—</div>
  </div>

<script>
const PIN = "${pin || ""}";
const boxesEl = document.getElementById("boxes");
const resultEl = document.getElementById("result");
const playerEl = document.getElementById("player");
const pidEl = document.getElementById("pid");
const idsCountEl = document.getElementById("idsCount");
const openedEl = document.getElementById("opened");
const leftEl = document.getElementById("left");

const lastPlayer = document.getElementById("lastPlayer");
const lastBox = document.getElementById("lastBox");
const lastType = document.getElementById("lastType");
const idList = document.getElementById("idList");

const toast = document.getElementById("toast");
const toastT = document.getElementById("toastT");
const toastS = document.getElementById("toastS");
let toastTimer = null;

function showToast(title, sub){
  toastT.textContent = title || "";
  toastS.textContent = sub || "";
  toast.classList.add("show");
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toast.classList.remove("show"), 2200);
}

function setTab(name){
  document.getElementById("tab-play").style.display = name==="play" ? "" : "none";
  document.getElementById("tab-ids").style.display  = name==="ids" ? "" : "none";
  document.getElementById("tab-tools").style.display= name==="tools" ? "" : "none";
  document.querySelectorAll(".tab").forEach(b=> b.classList.toggle("active", b.dataset.tab===name));
}
document.querySelectorAll(".tab").forEach(b=> b.addEventListener("click", ()=> setTab(b.dataset.tab)));

function makeButtons(state){
  boxesEl.innerHTML = "";
  const pickedSet = new Set(state.picked || []);
  for(let i=1;i<=${TOTAL};i++){
    const btn = document.createElement("button");
    const isPicked = pickedSet.has(i);
    btn.className = "boxbtn" + (isPicked ? " picked" : "");
    btn.textContent = i.toString().padStart(2,"0");
    btn.disabled = isPicked;
    btn.onclick = () => pick(i);
    boxesEl.appendChild(btn);
  }
  const opened = (state.picked || []).length;
  openedEl.textContent = opened;
  leftEl.textContent = ${TOTAL} - opened;

  const idsCount = (state.participants || []).length;
  idsCountEl.textContent = idsCount;

  const l = state.last || {};
  lastPlayer.textContent = l.player ? l.player : "—";
  lastBox.textContent = (l.box!==null && l.box!==undefined) ? l.box : "—";
  if(l.isLegend===true) lastType.textContent = "LEGENDARY";
  else if(l.box===null && l.player) lastType.textContent = "DRAW";
  else if(l.isWin===true) lastType.textContent = "WIN";
  else if(l.box!==null) lastType.textContent = "LOSE";
  else lastType.textContent = "—";
}

function renderIds(state){
  const arr = state.participants || [];
  if(arr.length===0){
    idList.innerHTML = '<div class="muted">لا توجد IDs حالياً.</div>';
    return;
  }
  idList.innerHTML = "";
  arr.slice().reverse().forEach(id=>{
    const row = document.createElement("div");
    row.className = "idItem";
    row.innerHTML = \`
      <div><b>\${id}</b><div class="muted">جاهز للسحب</div></div>
      <button class="btn small danger" onclick="removeId('\${id.replaceAll("'", "\\\\'")}')">حذف</button>
    \`;
    idList.appendChild(row);
  });
}

async function getState(){
  const r = await fetch("/state");
  const s = await r.json();
  makeButtons(s);
  renderIds(s);
  resultEl.textContent = (s.last && s.last.text) ? s.last.text : "—";
}

async function pick(n){
  const player = (playerEl.value || "").trim();
  if(!player){
    showToast("⚠️ لازم اسم اللاعب", "اكتب الاسم ثم اختر الصندوق");
    resultEl.textContent = "⚠️ اكتب اسم اللاعب أولاً";
    return;
  }
  const r = await fetch("/pick?box="+n+"&player="+encodeURIComponent(player)+"&pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("✅ تم فتح صندوق", "رقم: " + n.toString().padStart(2,"0"));
  await getState();
}

async function newRound(){
  const r = await fetch("/new?pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("🔄 راوند جديد", "تم خلط الجوائز");
  await getState();
}

async function reveal(){
  const r = await fetch("/reveal?pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("👁️ Reveal", "تم عرض أماكن الجوائز");
}

async function resetLast(){
  const r = await fetch("/reset_last?pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("🧼 تم التصفير", "الأوفرلاي رجع للوضع الافتراضي");
  await getState();
}

function openLogs(){
  window.open("/logs?pin="+encodeURIComponent(PIN), "_blank");
}

async function addId(){
  const id = (pidEl.value || "").trim();
  if(!id){ showToast("⚠️ اكتب ID", "مثال: -774"); return; }
  const r = await fetch("/add_id?id="+encodeURIComponent(id)+"&pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("➕ IDs", t);
  pidEl.value = "";
  await getState();
  setTab("ids");
}

async function removeId(id){
  const r = await fetch("/remove_id?id="+encodeURIComponent(id)+"&pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("🗑️ حذف ID", t);
  await getState();
}

async function clearIds(){
  const r = await fetch("/clear_ids?pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("🗑️ IDs", "تم التصفير");
  await getState();
  setTab("ids");
}

async function draw(){
  const count = document.getElementById("drawCount").value || "1";
  const removeAfter = document.getElementById("removeAfter").checked ? "1" : "0";
  const r = await fetch("/draw?count="+encodeURIComponent(count)+"&remove="+encodeURIComponent(removeAfter)+"&pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  showToast("🎲 سحب عشوائي", t);
  await getState();
  setTab("play");
}

getState();
setInterval(getState, 900);
</script>
</body>
</html>`;
}

function overlayPage() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Overlay - Mandoos</title>
<style>
  html,body{margin:0;padding:0;background:transparent;font-family:system-ui,Segoe UI,Tahoma,Arial;color:#fff;overflow:hidden}
  .pattern{
    position:fixed;inset:0;pointer-events:none;opacity:.10;
    background-image:url("/assets/pattern.svg");
    background-size:560px;
    background-repeat:repeat;
  }
  .wrap{
    position:fixed;left:50%;top:6%;
    transform:translateX(-50%);
    width:min(980px,92vw);
    border-radius:24px;
    background: linear-gradient(180deg, rgba(18,20,35,.76), rgba(0,0,0,.22));
    border:1px solid rgba(214,178,94,0.34);
    box-shadow: 0 18px 50px rgba(0,0,0,.60);
    backdrop-filter: blur(10px);
    padding:16px 18px;
  }
  .row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}
  .left{display:flex;align-items:center;gap:12px;}
  .left img{height:58px;width:auto;filter:drop-shadow(0 0 12px rgba(214,178,94,.65));}
  .badge{
    padding:8px 12px;border-radius:999px;
    background:rgba(214,178,94,0.16);
    border:1px solid rgba(214,178,94,0.35);
    font-weight:1000;font-size:13px;
  }
  .time{opacity:.75}
  .main{
    margin-top:10px;
    font-size:28px;
    font-weight:1100;
    line-height:1.25;
    text-shadow:0 10px 24px rgba(0,0,0,0.55);
  }
  .sub{margin-top:6px;opacity:.70;font-size:13px;}
  .pop{animation:pop .22s ease-out;}
  @keyframes pop{from{transform:translateY(10px);opacity:.4}to{transform:translateY(0);opacity:1}}

  .crown{
    position:fixed; left:50%; top:18%;
    transform:translateX(-50%);
    font-size:64px;
    filter: drop-shadow(0 0 18px rgba(243,221,157,.65));
    display:none; z-index:9998;
  }
  .crown.show{display:block; animation:crownPop .25s ease-out;}
  @keyframes crownPop{from{transform:translateX(-50%) translateY(8px) scale(.92);opacity:.3}to{transform:translateX(-50%) translateY(0) scale(1);opacity:1}}

  .flash{
    position:fixed;inset:0;
    background: radial-gradient(circle at 50% 40%, rgba(243,221,157,.45), rgba(0,0,0,0) 55%);
    opacity:0; pointer-events:none; z-index:9997;
  }
  .flash.on{animation:flash .75s ease-out;}
  @keyframes flash{0%{opacity:0}20%{opacity:1}100%{opacity:0}}

  .fx{
    position:fixed; left:50%; top:56%;
    transform:translate(-50%,-50%);
    width:min(620px,92vw);
    pointer-events:none;
    display:none;
    z-index:9999;
    filter: drop-shadow(0 18px 55px rgba(0,0,0,.70));
  }
  .fx.show{display:block;animation:fxPop .2s ease-out;}
  @keyframes fxPop{from{transform:translate(-50%,-45%) scale(.95);opacity:.35}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
  video{width:100%;height:auto;border-radius:18px}

  .legendBar{
    margin-top:10px;
    display:none;
    padding:10px 12px;
    border-radius:16px;
    border:1px solid rgba(243,221,157,.55);
    background: linear-gradient(180deg, rgba(214,178,94,.28), rgba(0,0,0,.18));
    font-weight:1200;
    letter-spacing:.6px;
    text-align:center;
    text-shadow:0 0 12px rgba(243,221,157,.35);
  }
  .legendBar.show{display:block; animation:pop .22s ease-out;}
</style>
</head>
<body>
  <div class="pattern"></div>
  <div class="flash" id="flash"></div>
  <div class="crown" id="crown">👑</div>

  <div class="wrap">
    <div class="row">
      <div class="left">
        <img src="/assets/logo.png" alt="logo" />
        <div class="badge">🦅 UAE SHIELD • MANDOOS ${TOTAL} • 🗡️</div>
      </div>
      <div class="badge time" id="time">—</div>
    </div>

    <div class="main pop" id="txt">جاهزين…</div>
    <div class="legendBar" id="legendBar">👑 LEGENDARY PRIZE 👑</div>
    <div class="sub">FX فيه صوت داخل الفيديو (مو ملفات منفصلة)</div>
  </div>

  <div class="fx" id="fx">
    <!-- ✅ لا muted: الصوت يطلع من نفس الفيديو -->
    <video id="fxVid" playsinline preload="auto"></video>
  </div>

<script>
let lastTime = 0;
let fallbackTimer = null;

function triggerLegendUI(){
  const crown = document.getElementById("crown");
  const flash = document.getElementById("flash");
  const bar = document.getElementById("legendBar");

  crown.classList.add("show");
  bar.classList.add("show");

  flash.classList.remove("on"); void flash.offsetWidth;
  flash.classList.add("on");

  // UI effects (اختياري) — ممكن تخليهم أطول لو تبي
  setTimeout(()=> crown.classList.remove("show"), 2500);
  setTimeout(()=> bar.classList.remove("show"), 2800);
}

function showFx(src){
  const fx = document.getElementById("fx");
  const v  = document.getElementById("fxVid");

  fx.classList.add("show");

  // تنظيف أي تايمر قديم
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }

  // اضمن ما يكرر
  v.loop = false;

  // ✅ شغل الصوت من الفيديو
  v.muted = false;
  v.volume = 1.0;

  // فك روابط قديمة
  v.onended = null;
  v.oncanplay = null;

  // إعادة تحميل
  v.pause();
  v.src = src + "?t=" + Date.now();
  v.currentTime = 0;

  // ✅ اخفاء بعد نهاية الفيديو
  v.onended = () => {
    fx.classList.remove("show");
    v.pause();
  };

  // ✅ fallback: لو onended ما اشتغل لأي سبب
  v.oncanplay = () => {
    v.play().catch(()=>{});
    const ms = Math.ceil(((v.duration || 5) * 1000)) + 500;
    fallbackTimer = setTimeout(() => {
      fx.classList.remove("show");
      v.pause();
    }, ms);
  };
}

async function tick(){
  const r = await fetch("/state");
  const s = await r.json();

  const t = (s.last && s.last.time) ? s.last.time : 0;
  if(t && t !== lastTime){
    lastTime = t;

    const txt = document.getElementById("txt");
    txt.classList.remove("pop"); void txt.offsetWidth; txt.classList.add("pop");
    txt.textContent = s.last.text || "";

    const d = new Date(t);
    document.getElementById("time").textContent = d.toLocaleTimeString();

    if (s.last.isLegend === true) triggerLegendUI();

    if (s.last.fx) showFx(s.last.fx);
  }
}

tick();
setInterval(tick, 350);
</script>
</body>
</html>`;
}

function logsPage(pin) {
  const data = readLogs().slice().reverse();
  const rows = data.map(l => {
    const cls = l.result === "WIN" ? "win" : (l.result === "LEGENDARY" ? "legend" : "lose");
    return `
      <tr>
        <td>${l.id}</td>
        <td>${escapeHtml(l.player)}</td>
        <td>${escapeHtml(l.box)}</td>
        <td class="${cls}">${escapeHtml(l.result)}</td>
        <td>${escapeHtml(l.prize)}</td>
        <td>${escapeHtml(l.time)}</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Logs - Mandoos</title>
<style>
  body{font-family:system-ui,Segoe UI,Tahoma,Arial;background:#0b0b10;color:#fff;padding:18px;}
  .top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
  .btn{border:1px solid rgba(214,178,94,.35);background:rgba(18,18,26,.85);color:#fff;padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:1100}
  table{width:100%;border-collapse:collapse;margin-top:10px;overflow:hidden;border-radius:14px}
  th,td{border:1px solid #2a2a33;padding:9px;text-align:center}
  th{background:#14141c}
  .win{color:#66ffb2;font-weight:1100}
  .lose{color:#ff5a7a;font-weight:1100}
  .legend{color:#f3dd9d;font-weight:1200;text-shadow:0 0 10px rgba(243,221,157,.35)}
  .muted{opacity:.75}
</style>
</head>
<body>
  <div class="top">
    <div>
      <h2 style="margin:0">📜 Win / Lose / Legendary / Draw Log</h2>
      <div class="muted">عدد السجلات: ${data.length}</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn" href="/download_logs?pin=${encodeURIComponent(pin || "")}">⬇️ Download JSON</a>
      <a class="btn" href="/clear_logs?pin=${encodeURIComponent(pin || "")}" onclick="return confirm('حذف كل السجلات؟')">🗑️ Clear</a>
    </div>
  </div>

  <table>
    <tr>
      <th>ID</th>
      <th>اللاعب / IDs</th>
      <th>الصندوق</th>
      <th>النتيجة</th>
      <th>الجائزة / تفاصيل</th>
      <th>الوقت</th>
    </tr>
    ${rows || `<tr><td colspan="6">لا يوجد سجلات بعد</td></tr>`}
  </table>
</body>
</html>`;
}

// =====================
// SERVER
// =====================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Static assets
  if (url.pathname.startsWith("/assets/")) {
    const localPath = path.join(__dirname, url.pathname);
    return serveFile(res, localPath);
  }

  // Pages
  if (url.pathname === "/") {
    const pin = url.searchParams.get("pin") || "";
    if (ADMIN_PIN && pin !== ADMIN_PIN) {
      return send(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>PIN</title>
      <style>
        body{background:#0b0b10;color:#fff;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
        .c{background:#12121a;border:1px solid rgba(214,178,94,.25);padding:22px;border-radius:18px;width:min(420px,90vw)}
        input{width:100%;padding:12px;border-radius:12px;border:1px solid rgba(214,178,94,.25);background:#0b0b10;color:#fff;font-size:16px}
        button{margin-top:10px;width:100%;padding:12px;border-radius:12px;border:1px solid rgba(214,178,94,.35);background:rgba(214,178,94,.15);color:#fff;font-weight:1100;cursor:pointer}
        .t{opacity:.7;font-size:12px;margin-top:8px}
      </style></head>
      <body><div class="c">
        <h3 style="margin:0 0 10px 0">🔒 أدخل PIN للوحة التحكم</h3>
        <input id="p" placeholder="PIN" />
        <button onclick="go()">دخول</button>
        <div class="t">Overlay بدون PIN: <b>/overlay</b></div>
      </div>
      <script>
        function go(){
          const p=document.getElementById('p').value.trim();
          if(!p) return;
          location.href='/?pin='+encodeURIComponent(p);
        }
      </script>
      </body></html>`);
    }
    return send(res, 200, uiPage(pin));
  }

  if (url.pathname === "/overlay") return send(res, 200, overlayPage());

  // API
  if (url.pathname === "/state") {
    return json(res, {
      picked: Array.from(picked).sort((a,b)=>a-b),
      last: lastResult,
      participants
    });
  }

  if (url.pathname === "/new") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    shuffleRound();
    return send(res, 200, "✅ راوند جديد بدأ وتم خلط الجوائز");
  }

  if (url.pathname === "/reset_last") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    lastResult = {
      time: Date.now(),
      text: "جاهزين… اكتب اسم اللاعب واختر رقم 🎁",
      box: null,
      player: "",
      isWin: false,
      isLegend: false,
      fx: null
    };
    return send(res, 200, "✅ تم تصفير رسالة الأوفرلاي");
  }

  // IDs
  if (url.pathname === "/add_id") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    const id = url.searchParams.get("id");
    const r = addParticipant(id);
    if (r.ok) {
      addLog({ id: Date.now(), player: "", box: "", result: "ADD_ID", prize: normId(id), time: new Date().toLocaleString() });
    }
    return send(res, r.ok ? 200 : 400, r.msg, "text/plain; charset=utf-8");
  }

  if (url.pathname === "/remove_id") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    const id = url.searchParams.get("id");
    const ok = removeParticipant(id);
    if (ok) {
      addLog({ id: Date.now(), player: "", box: "", result: "REMOVE_ID", prize: normId(id), time: new Date().toLocaleString() });
      return send(res, 200, `✅ تم حذف ID: ${normId(id)}`, "text/plain; charset=utf-8");
    }
    return send(res, 404, "⚠️ ID غير موجود", "text/plain; charset=utf-8");
  }

  if (url.pathname === "/clear_ids") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    participants = [];
    addLog({ id: Date.now(), player: "", box: "", result: "CLEAR_IDS", prize: "ALL", time: new Date().toLocaleString() });
    return send(res, 200, "✅ تم تصفير جميع الـIDs", "text/plain; charset=utf-8");
  }

  if (url.pathname === "/draw") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");

    const count = parseInt(url.searchParams.get("count") || "1", 10);
    const removeAfter = url.searchParams.get("remove") === "1";

    const r = pickRandomFromParticipants(count, removeAfter);
    if (!r.ok) return send(res, 400, r.msg, "text/plain; charset=utf-8");

    lastResult = {
      time: Date.now(),
      text: `🎲 اختيار عشوائي: ${r.winners.join(" , ")}` + (removeAfter ? " ✅ (تم حذفهم من القائمة)" : ""),
      box: null,
      player: r.winners.join(", "),
      isWin: true,
      isLegend: false,
      fx: WIN_FX
    };

    addLog({
      id: Date.now(),
      player: r.winners.join(", "),
      box: "",
      result: "DRAW",
      prize: `COUNT=${r.winners.length}` + (removeAfter ? " REMOVE=1" : ""),
      time: new Date().toLocaleString()
    });

    return send(res, 200, lastResult.text, "text/plain; charset=utf-8");
  }

  if (url.pathname === "/pick") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");

    const n = parseInt(url.searchParams.get("box"), 10);
    const player = (url.searchParams.get("player") || "").trim();

    if (!player) return send(res, 400, "❌ اكتب اسم اللاعب");
    if (!n || n < 1 || n > TOTAL) return send(res, 400, `❌ اختر رقم من 1 إلى ${TOTAL}`);

    if (picked.has(n)) {
      lastResult = {
        time: Date.now(),
        text: `⚠️ ${player} فتح الصندوق ${n} مسبقاً`,
        box: n,
        player,
        isWin: false,
        isLegend: false,
        fx: null
      };
      return send(res, 200, lastResult.text);
    }

    picked.add(n);
    const cell = boxes[n - 1];

    // EMPTY
    if (cell.type === "EMPTY") {
      lastResult = {
        time: Date.now(),
        text: `📦 ${player} فتح الصندوق ${n} → 😶 فاضي… حظ أوفر!`,
        box: n,
        player,
        isWin: false,
        isLegend: false,
        fx: LOSE_FX
      };

      addLog({
        id: Date.now(),
        player,
        box: n,
        result: "LOSE",
        prize: "EMPTY",
        time: new Date().toLocaleString()
      });

      return send(res, 200, lastResult.text);
    }

    // PRIZE
    const prize = cell.prize;
    const isLegend = prize.legendary === true;

    if (isLegend) {
      lastResult = {
        time: Date.now(),
        text: `👑 LEGENDARY PRIZE 👑 | ${player} فتح الصندوق ${n} → ${prize.label}`,
        box: n,
        player,
        isWin: true,
        isLegend: true,
        fx: LEGEND_FX
      };

      addLog({
        id: Date.now(),
        player,
        box: n,
        result: "LEGENDARY",
        prize: prize.label,
        time: new Date().toLocaleString()
      });

      return send(res, 200, lastResult.text);
    }

    // Regular Win
    lastResult = {
      time: Date.now(),
      text: `📦 ${player} فتح الصندوق ${n} → 🎉 مبروك! ${prize.label}`,
      box: n,
      player,
      isWin: true,
      isLegend: false,
      fx: WIN_FX
    };

    addLog({
      id: Date.now(),
      player,
      box: n,
      result: "WIN",
      prize: prize.label,
      time: new Date().toLocaleString()
    });

    return send(res, 200, lastResult.text);
  }

  if (url.pathname === "/reveal") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");

    let lines = ["🎁 أماكن الجوائز:"];
    for (let i = 1; i <= TOTAL; i++) {
      const cell = boxes[i - 1];
      if (cell.type === "PRIZE") {
        const p = cell.prize;
        lines.push(`- Box ${i}: ${p.legendary ? "👑 LEGENDARY " : ""}${p.label}`);
      }
    }
    return send(res, 200, lines.join("\n"), "text/plain; charset=utf-8");
  }

  // Logs
  if (url.pathname === "/logs") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    const pin = url.searchParams.get("pin") || "";
    return send(res, 200, logsPage(pin));
  }

  if (url.pathname === "/download_logs") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    const data = fs.readFileSync(LOG_FILE);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=logs.json",
      "Cache-Control": "no-store"
    });
    return res.end(data);
  }

  if (url.pathname === "/clear_logs") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));
    return send(res, 200, "✅ تم حذف كل السجلات. ارجع /logs للتأكد.", "text/plain; charset=utf-8");
  }

  return send(res, 404, "Not Found", "text/plain; charset=utf-8");
});

server.listen(PORT, HOST, () => {
  const ip = getLocalIP();
  console.log("=======================================");
  console.log("🚀 UAE SHIELD MANDOOS RUNNING");
  console.log("=======================================");
  console.log(`🖥 Local:   http://localhost:${PORT}/`);
  console.log(`🌐 LAN:     http://${ip}:${PORT}/`);
  console.log(`🎬 Overlay: http://${ip}:${PORT}/overlay`);
  console.log(`🔒 PIN:     ${ADMIN_PIN ? "ON" : "OFF"}`);
  console.log("=======================================");
});
