/* TrackLab users + accounts create page */
const EMPTY_TEXT = "请选择";

function packIdToLabel(packId) {
  const map = {
    xhs: "小红书",
  };
  return map[packId] || packId;
}


function $(id){ return document.getElementById(id); }
function on(id, evt, fn){ const el = $(id); if (el) el.addEventListener(evt, fn); }

function setStatus(type, msg){
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (type === "err" ? " err" : "");
}

async function httpjson(url, opt={}){
  const res = await fetch(url, {
    ...opt,
    headers: { "content-type":"application/json", ...(opt.headers||{}) }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; }
  if (!res.ok){
    const msg = data?.message || data?.error || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function apiBase(){ return ($("apiBase")?.value || "").trim().replace(/\/+$/,""); }
function getPackId(){ return $("packId")?.value || ""; }
function getPackVersion(){ return $("packVersion")?.value || ""; }

function setDisabledByUserSelected(disabled){
  const ids = [
    "accountHandle","accountPackId","accountPackVersion","accountNote","btnCreateAccount"
  ];
  ids.forEach(id=>{
    const el = $(id);
    if (!el) return;
    el.disabled = disabled;
  });
}

function userLabel(u){
  const dn = (u.display_name || "").trim();
  const un = (u.username || "").trim();
  if (dn && un) return `${dn} (${un})`;
  return dn || un || u.id;
}

/** ------- state ------- **/
let users = [];

/** ------- boot ------- **/
window.addEventListener("DOMContentLoaded", ()=>{
  // 固定：你现在只有 xhs/v1.0.0，做成下拉但仅一个选项（未来扩展也不破结构）
  $("packId").innerHTML = `<option value="xhs">小红书</option>`;
  $("packVersion").innerHTML = `<option value="v1.0.0">v1.0.0</option>`;

  syncAccountPackFields();

  // ✅ 用 value 同步到灰色输入框（账号区）
  $("accountPackId").value = packIdToLabel(getPackId());
  $("accountPackVersion").value = getPackVersion();

  bindEvents();
  boot().catch(e=>setStatus("err", readableErr(e)));
});

function syncAccountPackFields(){
  const elPid = $("accountPackId");
  const elPver = $("accountPackVersion");
  if (elPid) elPid.value = getPackId();
  if (elPver) elPver.value = getPackVersion();
}

function bindEvents(){
  on("btnReloadUsers","click", ()=> loadUsers().catch(e=>setStatus("err", readableErr(e))));
  on("btnCreateUser","click", ()=> createUser().catch(e=>setStatus("err", readableErr(e))));

  on("packId","change", syncAccountPackFields);
  on("packVersion","change", syncAccountPackFields);

  on("userSelect","change", ()=> {
    const hasUser = !!($("userSelect")?.value || "");
    setDisabledByUserSelected(!hasUser);
    $("accountHint").textContent = hasUser ? "" : "请选择用户后再创建账号。";
  });

  on("btnCreateAccount","click", ()=> createAccount().catch(e=>setStatus("err", readableErr(e))));
}

async function boot(){
  $("schemaHint").textContent = `就绪（users/accounts）｜${getPackId()} / ${getPackVersion()}`;
  await loadUsers();
  setDisabledByUserSelected(true);
  $("accountHint").textContent = "请选择用户后再创建账号。";
  setStatus("ok","就绪");
}

/** ------- users ------- **/
async function loadUsers(){
  setStatus("ok","加载用户列表…");
  const out = await httpjson(`${apiBase()}/user/list`, { method:"GET" });
  users = out.items || [];

  const sel = $("userSelect");
  sel.innerHTML = `<option value="">${EMPTY_TEXT}</option>` +
    users.map(u=>`<option value="${escapeHtml(u.id)}">${escapeHtml(userLabel(u))}</option>`).join("");

  sel.value = "";
  setDisabledByUserSelected(true);
  setStatus("ok", `用户列表已加载（${users.length}）`);
}

function validateUsername(username){
  const s = String(username || "").trim();
  if (!s) return "请填写用户名";
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(s)) return "用户名格式不符合规则（2–32 位，仅 A–Z a–z 0–9 _ -）";
  return "";
}

async function createUser(){
  const username = ($("newUsername")?.value || "").trim();
  const display_name = ($("newDisplayName")?.value || "").trim();

  const err1 = validateUsername(username);
  if (err1) return setStatus("err", err1);
  if (!display_name) return setStatus("err", "请填写昵称（display_name）");

  setStatus("ok","创建用户…");
  const out = await httpjson(`${apiBase()}/user/create`, {
    method:"POST",
    body: JSON.stringify({ username, display_name })
  });

  // 成功：刷新用户列表并选中新创建的用户
  await loadUsers();
  if (out?.id){
    $("userSelect").value = String(out.id);
    $("userSelect").dispatchEvent(new Event("change"));
  }

  $("newUsername").value = "";
  $("newDisplayName").value = "";
  setStatus("ok", `用户创建成功：${display_name}（${username}）`);
}

/** ------- accounts ------- **/
async function createAccount(){
  const owner_id = $("userSelect")?.value || "";
  if (!owner_id) return setStatus("err","请先选择用户");

  const pack_id = $("accountPackId")?.value || "";
  const pack_version = $("accountPackVersion")?.value || "";
  const handle = ($("accountHandle")?.value || "").trim();
  const note = ($("accountNote")?.value || "").trim();

  if (!pack_id) return setStatus("err","pack_id_required");
  if (!pack_version) return setStatus("err","pack_version_required");
  if (!handle) return setStatus("err","请填写账号标识（handle）");

  setStatus("ok","创建账号…");

  const out = await httpjson(`${apiBase()}/account/create`, {
    method:"POST",
    body: JSON.stringify({ owner_id, pack_id, pack_version, handle, note })
  });

  $("accountHandle").value = "";
  $("accountNote").value = "";
  setStatus("ok", `账号创建成功：${handle}（account_id: ${out?.id || ""}）`);
}

/** ------- error mapping ------- **/
function readableErr(e){
  const data = e?.data || null;
  const code = data?.error || e?.message || "unknown_error";

  // 优先用后端 message（你在 preset 冲突里已经开始这么做了）
  if (data?.message) return data.message;

  // 针对 user/account 这页做一层人话翻译
  const map = {
    user_exists: "该用户名已存在，请换一个用户名。",
    username_required: "请填写用户名。",
    display_name_required: "请填写昵称。",
    user_create_failed: "创建用户失败。",
    owner_id_required: "请先选择用户。",
    pack_id_required: "请先选择 pack_id。",
    pack_version_required: "请先选择 pack_version。",
    account_handle_required: "请填写账号标识（handle）。",
    account_create_failed: "创建账号失败。"
  };

  // 如果 worker 返回了 detail，就拼上（保留排错信息）
  const detail = data?.detail ? `（${String(data.detail).slice(0,200)}）` : "";
  return (map[code] || code) + detail;
}
