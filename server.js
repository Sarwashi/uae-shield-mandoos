const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ✅ Render/Railway use PORT env
const PORT = process.env.PORT || 5054;
const HOST = "0.0.0.0";
const TOTAL = 30;

// غيّر PIN إذا تبي حماية للوحة التحكم
const ADMIN_PIN = "U-S";

// روابط صوت (ضع ملفاتك داخل فولدر sounds)
const WIN_SOUND  = "/sounds/win.mp3";   // صوت الفوز
const LOSE_SOUND = "/sounds/lose.mp3";  // صوت الفاضي

// ✅ GIFs للـ OBS Overlay
const WIN_GIF  = "/assets/win.gif";
const LOSE_GIF = "/assets/lose.gif";

const PRIZES = [
  "🦸 حزمة سوبر هيرو ",
  "🦸 حزمة هاي كلاس",
  "🎖️ ترقية",
  "🎖️ ID رباعي ",
  "🎖️ ID ثلاثي",
  "🎖️ V2-m ",
  "🎖️ ترقيه الى رتبة ماجستيك ",
  "🎖️ مرشح للاداره العليا ",
  "🎁 nitro game ",
  "🎁 steam gift 10$ ",
  "🎁 amazon gift 25$ ",
  "🎁 noon gift 20$ ",
  "🎁 اختار صندوق اخر  ",
  "💰 50$ cash ",
];

// ==============
// LOG SETUP
// ==============
const LOG_FILE = path.join(__dirname, "logs.json");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));

function readLogs() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
  } catch {
    return [];
  }
}
function addLog(entry) {
  const data = readLogs();
  data.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

// ==============
// GAME STATE
// ==============
let boxes = [];
let picked = new Set();

// ✅ المشاركين (IDs)
let participants = []; // array of strings

// lastResult: يتم عرضه في الأوفرلاي
let lastResult = {
  time: Date.now(),
  text: "جاهزين… اكتب اسم اللاعب واختر رقم 🎁",
  box: null,
  player: "",
  sound: null,
  isWin: false
};

function shuffleRound() {
  boxes = Array(TOTAL).fill("EMPTY");
  picked = new Set();

  const used = new Set();
  for (const prize of PRIZES) {
    if (used.size >= TOTAL) break;

    let idx;
    do idx = Math.floor(Math.random() * TOTAL);
    while (used.has(idx));
    used.add(idx);
    boxes[idx] = prize;
  }

  lastResult = {
    time: Date.now(),
    text: "✅ راوند جديد بدأ! اكتب اسم اللاعب واختر رقم 🎁",
    box: null,
    player: "",
    sound: null,
    isWin: false
  };
}

shuffleRound();

// ==============
// HELPERS
// ==============
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
function normId(s) {
  return String(s || "").trim();
}
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

// Serve files (sounds/assets)
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
    "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not Found", "text/plain; charset=utf-8");
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(data);
  });
}

function uiPage(pin) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>المندوس - لوحة التحكم</title>
<style>
  :root{--bg:#0b0b10;--card:#12121a;--gold:#d6b25e;--gold2:#f6df9b;--muted:#a7a7b2;--danger:#ff5a7a;--ok:#66ffb2;}
  body{margin:0;font-family:system-ui,Segoe UI,Tahoma,Arial;background:radial-gradient(1200px 600px at 50% 0%,#1a1426 0%,var(--bg) 55%);color:#fff;}
  .wrap{max-width:1100px;margin:18px auto;padding:16px;}
  .top{display:flex;gap:12px;align-items:center;justify-content:space-between;background:linear-gradient(180deg,rgba(214,178,94,0.18),rgba(214,178,94,0.06));border:1px solid rgba(214,178,94,0.22);border-radius:18px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.35);}
  .title{display:flex;flex-direction:column;gap:2px;}
  .title h1{margin:0;font-size:18px;}
  .title p{margin:0;color:var(--muted);font-size:12px;}
  .actions{display:flex;gap:10px;flex-wrap:wrap;}
  button{border:1px solid rgba(214,178,94,0.35);background:rgba(18,18,26,0.85);color:#fff;padding:10px 12px;border-radius:14px;cursor:pointer;font-weight:700;transition:.15s;backdrop-filter:blur(8px);}
  button:hover{transform:translateY(-1px);border-color:rgba(246,223,155,0.7);}
  button.danger{border-color:rgba(255,90,122,0.55);}
  button.ok{border-color:rgba(102,255,178,0.55);}
  .board{margin-top:14px;background:rgba(18,18,26,0.70);border:1px solid rgba(214,178,94,0.14);border-radius:18px;padding:14px;}
  .status{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;}
  .result{flex:1;min-width:280px;padding:12px 14px;border-radius:16px;border:1px solid rgba(214,178,94,0.18);background:rgba(0,0,0,0.20);font-size:16px;}
  .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;}
  .boxbtn{padding:14px 0;border-radius:16px;font-size:16px;background:linear-gradient(180deg,rgba(214,178,94,0.18),rgba(18,18,26,0.80));border:1px solid rgba(214,178,94,0.25);}
  .boxbtn.picked{opacity:.45;border-color:rgba(255,255,255,0.10);background:rgba(255,255,255,0.04);cursor:not-allowed;}
  .pinbadge{font-size:12px;color:var(--muted);border:1px dashed rgba(214,178,94,0.35);padding:6px 10px;border-radius:12px;}
  input{
    padding:10px 12px;border-radius:14px;border:1px solid rgba(214,178,94,0.25);
    background:rgba(0,0,0,0.25);color:#fff;font-weight:700;min-width:200px;
  }
  a{color:var(--gold2);text-decoration:none}
</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="title">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="/assets/logo.png" style="height:40px;width:auto;filter:drop-shadow(0 0 8px rgba(214,178,94,.6));" />
          <h1 style="margin:0;">🧰 لعبة المندوس — ${TOTAL} صندوق</h1>
        </div>
        <p>اكتب اسم اللاعب… ثم اختر رقم واحد • IDs: اختيار عشوائي للمشاركين</p>
      </div>
      <div class="actions">
        <button class="ok" onclick="newRound()">🔄 راوند جديد</button>
        <button onclick="reveal()">👁️ Reveal</button>
        <button onclick="openLogs()">📜 Logs</button>
        <button onclick="addId()">➕ إضافة ID</button>
        <button onclick="drawNext()">🎲 اختيار عشوائي</button>
        <button class="danger" onclick="clearIds()">🗑️ تصفير IDs</button>
        <button class="danger" onclick="resetLast()">🧼 تصفير الأوفرلاي</button>
      </div>
    </div>

    <div class="board">
      <div class="status">
        <div class="result" id="result">جاري التحميل…</div>
        <div class="pinbadge">
          Overlay: <a target="_blank" href="/overlay">/overlay</a> •
          Logs: <a target="_blank" href="/logs?pin=${pin || ""}">/logs</a>
        </div>
        <input id="player" placeholder="اسم اللاعب (مثال: جهيمان)" />
        <input id="pid" placeholder="ID المشارك (مثال: -774)" style="min-width:170px" />
      </div>

      <div class="grid" id="grid"></div>
    </div>
  </div>

<script>
const PIN = "${pin || ""}";
const grid = document.getElementById("grid");
const resultEl = document.getElementById("result");
const playerEl = document.getElementById("player");
const pidEl = document.getElementById("pid");

function makeButtons(state){
  grid.innerHTML = "";
  for(let i=1;i<=${TOTAL};i++){
    const btn = document.createElement("button");
    btn.className = "boxbtn" + (state.picked.includes(i) ? " picked" : "");
    btn.textContent = i.toString().padStart(2,"0");
    btn.disabled = state.picked.includes(i);
    btn.onclick = () => pick(i);
    grid.appendChild(btn);
  }
}

async function getState(){
  const r = await fetch("/state");
  const s = await r.json();
  makeButtons(s);
  const count = (s.participants || []).length;
  resultEl.textContent = s.last.text + " | IDs: " + count;
}

async function pick(n){
  const player = (playerEl.value || "").trim();
  if(!player){
    resultEl.textContent = "⚠️ اكتب اسم اللاعب أولاً";
    return;
  }
  const r = await fetch("/pick?box="+n+"&player="+encodeURIComponent(player)+"&pin="+encodeURIComponent(PIN));
  const t = await r.text();
  resultEl.textContent = t;
  await getState();
}

async function newRound(){
  const r = await fetch("/new?pin="+encodeURIComponent(PIN));
  resultEl.textContent = await r.text();
  await getState();
}

async function reveal(){
  const r = await fetch("/reveal?pin="+encodeURIComponent(PIN));
  resultEl.textContent = await r.text();
}

async function resetLast(){
  const r = await fetch("/reset_last?pin="+encodeURIComponent(PIN));
  resultEl.textContent = await r.text();
  await getState();
}

function openLogs(){
  window.open("/logs?pin="+encodeURIComponent(PIN), "_blank");
}

async function addId(){
  const id = (pidEl.value || "").trim();
  if(!id){ resultEl.textContent = "⚠️ اكتب ID"; return; }
  const r = await fetch("/add_id?id="+encodeURIComponent(id)+"&pin="+encodeURIComponent(PIN));
  resultEl.textContent = await r.text();
  pidEl.value = "";
  await getState();
}

async function clearIds(){
  const r = await fetch("/clear_ids?pin="+encodeURIComponent(PIN));
  resultEl.textContent = await r.text();
  await getState();
}

async function drawNext(){
  const r = await fetch("/draw?count=1&remove=1&pin="+encodeURIComponent(PIN));
  resultEl.textContent = await r.text();
  await getState();
}

getState();
setInterval(getState, 1000);
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
  html,body{margin:0;padding:0;background:transparent;font-family:system-ui,Segoe UI,Tahoma,Arial;color:#fff;}
  .wrap{
    position:absolute;left:50%;top:8%;transform:translateX(-50%);
    width:min(980px,92vw);
    border-radius:22px;
    background:linear-gradient(180deg,rgba(18,18,26,0.72),rgba(0,0,0,0.28));
    border:1px solid rgba(214,178,94,0.30);
    box-shadow:0 18px 40px rgba(0,0,0,0.45);
    backdrop-filter:blur(10px);
    padding:18px;
  }
  .row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}
  .badge{
    padding:8px 12px;border-radius:999px;
    background:rgba(214,178,94,0.18);border:1px solid rgba(214,178,94,0.35);
    font-weight:900;font-size:13px;
  }
  .main{
    margin-top:10px;font-size:28px;font-weight:1000;line-height:1.2;
    text-shadow:0 6px 18px rgba(0,0,0,0.55);
  }
  .sub{margin-top:6px;opacity:.75;font-size:13px;}
  .pop{animation:pop .28s ease-out;}
  @keyframes pop{from{transform:translateY(8px);opacity:.5}to{transform:translateY(0);opacity:1}}

  /* GIF Layer */
  .gifWrap{
    position:fixed;
    left:50%;
    top:55%;
    transform:translate(-50%,-50%);
    width:min(520px,90vw);
    pointer-events:none;
    display:none;
    z-index:9999;
    filter:drop-shadow(0 18px 40px rgba(0,0,0,.55));
  }
  .gifWrap.show{display:block; animation:gifPop .25s ease-out;}
  @keyframes gifPop{from{transform:translate(-50%,-40%) scale(.92);opacity:.4}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
  .gifWrap img{width:100%;height:auto;border-radius:18px}
</style>
</head>
<body>
  <div class="wrap">
    <div class="row">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="/assets/logo.png" style="height:60px;width:auto;filter:drop-shadow(0 0 10px rgba(214,178,94,.6));" />
        <div class="badge">🎁 UAE SHIELD • MANDOOS ${TOTAL}</div>
      </div>
      <div class="badge" id="time">—</div>
    </div>

    <div class="main pop" id="txt">…</div>
    <div class="sub">يعرض اسم اللاعب + رقم الصندوق + النتيجة / أو سحب عشوائي IDs</div>
  </div>

  <!-- GIF -->
  <div class="gifWrap" id="gifWrap">
    <img id="gifImg" src="" alt="result gif" />
  </div>

  <audio id="aud" preload="auto"></audio>

<script>
let lastTime = 0;
let hideTimer = null;

function showGif(src){
  const wrap = document.getElementById("gifWrap");
  const img  = document.getElementById("gifImg");
  img.src = src + "?t=" + Date.now(); // force refresh
  wrap.classList.add("show");

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    wrap.classList.remove("show");
  }, 3500);
}

async function tick(){
  const r = await fetch("/state");
  const s = await r.json();

  const t = s.last.time || 0;
  if(t !== lastTime){
    lastTime = t;

    const txt = document.getElementById("txt");
    txt.classList.remove("pop"); void txt.offsetWidth; txt.classList.add("pop");
    txt.textContent = s.last.text;

    const d = new Date(t);
    document.getElementById("time").textContent = d.toLocaleTimeString();

    // ✅ الصوت
    if(s.last.sound){
      const aud = document.getElementById("aud");
      aud.src = s.last.sound + "?t=" + Date.now();
      aud.currentTime = 0;
      aud.play().catch(()=>{});
    }

    // ✅ GIF
    if (s.last.isWin === true) {
      showGif((s.gifs && s.gifs.win) ? s.gifs.win : "/assets/win.gif");
    } else if (s.last.isWin === false && s.last.box !== null) {
      showGif((s.gifs && s.gifs.lose) ? s.gifs.lose : "/assets/lose.gif");
    }
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
    const cls = l.result === "WIN" ? "win" : "lose";
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
  .btn{border:1px solid rgba(214,178,94,.35);background:rgba(18,18,26,.85);color:#fff;padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:900}
  table{width:100%;border-collapse:collapse;margin-top:10px;overflow:hidden;border-radius:14px}
  th,td{border:1px solid #2a2a33;padding:9px;text-align:center}
  th{background:#14141c}
  .win{color:#66ffb2;font-weight:900}
  .lose{color:#ff5a7a;font-weight:900}
  .muted{opacity:.75}
</style>
</head>
<body>
  <div class="top">
    <div>
      <h2 style="margin:0">📜 Win / Lose / Draw Log</h2>
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

// ==============
// SERVER
// ==============
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Static sounds
  if (url.pathname.startsWith("/sounds/")) {
    const localPath = path.join(__dirname, url.pathname);
    return serveFile(res, localPath);
  }

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
      <style>body{background:#0b0b10;color:#fff;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
      .c{background:#12121a;border:1px solid rgba(214,178,94,.25);padding:22px;border-radius:18px;width:min(420px,90vw)}
      input{width:100%;padding:12px;border-radius:12px;border:1px solid rgba(214,178,94,.25);background:#0b0b10;color:#fff;font-size:16px}
      button{margin-top:10px;width:100%;padding:12px;border-radius:12px;border:1px solid rgba(214,178,94,.35);background:rgba(214,178,94,.15);color:#fff;font-weight:900;cursor:pointer}
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
      participants,
      gifs: { win: WIN_GIF, lose: LOSE_GIF }
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
      sound: null,
      isWin: false
    };
    return send(res, 200, "✅ تم تصفير رسالة الأوفرلاي");
  }

  // ✅ إضافة ID
  if (url.pathname === "/add_id") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    const id = url.searchParams.get("id");
    const r = addParticipant(id);
    if (r.ok) {
      addLog({ id: Date.now(), player: "", box: "", result: "ADD_ID", prize: normId(id), time: new Date().toLocaleString() });
    }
    return send(res, r.ok ? 200 : 400, r.msg, "text/plain; charset=utf-8");
  }

  // ✅ حذف ID
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

  // ✅ تصفير IDs
  if (url.pathname === "/clear_ids") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    participants = [];
    addLog({ id: Date.now(), player: "", box: "", result: "CLEAR_IDS", prize: "ALL", time: new Date().toLocaleString() });
    return send(res, 200, "✅ تم تصفير جميع الـIDs", "text/plain; charset=utf-8");
  }

  // ✅ سحب عشوائي (count=1..n) + remove=1 يحذف بعد السحب
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
      sound: WIN_SOUND,
      isWin: true
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
        sound: null,
        isWin: false
      };
      return send(res, 200, lastResult.text);
    }

    picked.add(n);
    const prize = boxes[n - 1];
    const isWin = prize !== "EMPTY";

    if (!isWin) {
      lastResult = {
        time: Date.now(),
        text: `📦 ${player} فتح الصندوق ${n} → 😶 فاضي… حظ أوفر!`,
        box: n,
        player,
        sound: LOSE_SOUND,
        isWin: false
      };
    } else {
      lastResult = {
        time: Date.now(),
        text: `📦 ${player} فتح الصندوق ${n} → 🎉 مبروك! ${prize}`,
        box: n,
        player,
        sound: WIN_SOUND,
        isWin: true
      };
    }

    addLog({
      id: Date.now(),
      player,
      box: n,
      result: isWin ? "WIN" : "LOSE",
      prize: isWin ? prize : "EMPTY",
      time: new Date().toLocaleString()
    });

    return send(res, 200, lastResult.text);
  }

  if (url.pathname === "/reveal") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");

    let lines = ["🎁 أماكن الجوائز:"];
    for (let i = 1; i <= TOTAL; i++) {
      const v = boxes[i - 1];
      if (v !== "EMPTY") lines.push(`- Box ${i}: ${v}`);
    }
    return send(res, 200, lines.join("\n"), "text/plain; charset=utf-8");
  }

  // ✅ LOGS PAGE (protected by PIN)
  if (url.pathname === "/logs") {
    if (!isAuthed(url)) return send(res, 403, "❌ PIN خطأ");
    const pin = url.searchParams.get("pin") || "";
    return send(res, 200, logsPage(pin));
  }

  // ✅ Download logs.json
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

  // ✅ Clear logs
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
