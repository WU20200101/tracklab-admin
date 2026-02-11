/* TrackLab users + accounts create page (v1.0.0) */

const EMPTY_TEXT = "请选择";

// =====================================================
// API BASE BOOT (config.json / ?api=) —— 与 client.js 一致
// =====================================================
let __API_BASE = "";

function ghPagesRepoRootPath(){
  const parts = location.pathname.split("/").filter(Boolean);
  if (location.hostname.endsWith("github.io") && parts.length >= 1) return `/${parts[0]}/`;
  return "/";
}

async function bootApiBase(){
  const u = new URL(location.href);
  const fromQuery = u.searchParams.get("api");
  if (fromQuery){
    __API_BASE = fromQuery.trim().replace(/\/+$/, "");
  } else {
    const cfgUrl = new URL(`${ghPagesRepoRootPath()}config.json`, location.origin).toString();
    const resp = await fetch(cfgUrl, { cache: "no-store" });
    if (!resp.ok) throw new Error("config_json_not_found");
    const cfg = await resp.json();
    __API_BASE = String(cfg.api_base || "").trim().replace(/\/+$/, "");
    if (!__API_BASE) throw new Error("api_base_missing_in_config");
  }
  const el = $first("apiBase");
  if (el) el.value = __API_BASE;
}

function $id(id){ return document.getElementById(id); }
function $first(...ids){
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}
function on(el, evt, fn){ if (el) el.addEventListener(evt, fn); }

function setStatus(type, msg){
  const el = $first("status");
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

function apiBase(){
  const el = $first("apiBase");
  return (__API_BASE || el?.value || "").trim().replace(/\/+$/,"");
}

/** Top selectors (shared across pages) */
function packIdEl(){ return $first("packId","publishPlatform","platform","platformSelect"); }
function packVerEl(){ return $first("packVersion","version","versionSelect"); }

function getPackId(){
  const el = packIdEl();
  return (el?.value || "").trim();
}
function getPackVersion(){
  const el = packVerEl();
  return (el?.value || "").trim();
}

async function bootPackSelectors(){
  const packSel = packIdEl();
  const verSel = packVerEl();
  if (!packSel || !verSel) return;
  const idx = await httpjson(`${apiBase()}/packs/index`);
  const packs = Array.isArray(idx.packs) ? idx.packs : [];
  const defPackId = idx.default_pack_id || "";
  const defVer = idx.default_pack_version || "";

  // pack options
  const packIds = [...new Set(packs.map(p=>p.pack_id).filter(Boolean))];
  packSel.innerHTML = "";
  for (const pid of packIds){
    const opt = document.createElement("option");
    opt.value = pid;
    opt.textContent = pid;
    packSel.appendChild(opt);
  }

  function renderVersionsFor(pid){
    verSel.innerHTML = "";
    const vers = packs.filter(p=>p.pack_id===pid).map(p=>p.pack_version).filter(Boolean);
    for (const v of vers){
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      verSel.appendChild(opt);
    }
  }

  if (defPackId && packIds.includes(defPackId)) packSel.value = defPackId;
  renderVersionsFor(packSel.value || packIds[0] || "");
  if (defVer) verSel.value = defVer;

  on(packSel, "change", ()=>{
    renderVersionsFor(packSel.value);
    syncAccountPackDisplay();
  });
}
function getPackLabel(){
  const el = packIdEl();
  if (!el) return "";
  const opt = el.options?.[el.selectedIndex];
  return (opt?.textContent || opt?.innerText || el.value || "").trim();
}
function getPackVersionLabel(){
  const el = packVerEl();
  if (!el) return "";
  const opt = el.options?.[el.selectedIndex];
  return (opt?.textContent || opt?.innerText || el.value || "").trim();
}

/** Account area display-only fields (should show label, but not be used for writing) */
function syncAccountPackDisplay(){
  const packText = $first("accountPackId","accountPackIdText","accountPackPlatform");
  const verText  = $first("accountPackVersion","accountPackVersionText","accountPackVer");

  // 显示 label（例如：小红书），但创建账号时写入仍用 getPackId()
  if (packText){
    packText.value = getPackLabel() || getPackId();
    packText.disabled = true;      // 灰色不可编辑（你要的）
    packText.readOnly = true;
  }
  if (verText){
    verText.value = getPackVersionLabel() || getPackVersion();
    verText.disabled = true;       // 灰色不可编辑（你要的）
    verText.readOnly = true;
  }
}

function setDisabledByUserSelected(disabled){
  const ids = [
    "accountHandle",
    "accountNote",
    "btnCreateAccount",
  ];
  ids.forEach(id=>{
    const el = $first(id);
    if (el) el.disabled = disabled;
  });

  // pack/version 显示框一直禁用（只是展示）
  const p1 = $first("accountPackId","accountPackIdText","accountPackPlatform");
  const p2 = $first("accountPackVersion","accountPackVersionText","accountPackVer");
  if (p1){ p1.disabled = true; p1.readOnly = true; }
  if (p2){ p2.disabled = true; p2.readOnly = true; }
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
  (async () => {
    await bootApiBase();
    await bootPackSelectors();
    // 顶部 pack/版本 变化时：同步账号区显示（label）
    on(packIdEl(), "change", ()=> syncAccountPackDisplay());
    on(packVerEl(), "change", ()=> syncAccountPackDisplay());
    bindEvents();
    await boot();
  })().catch(e=>setStatus("err", readableErr(e)));
});

function bindEvents(){
  const btnReloadUsers = $first("btnReloadUsers","btnRefreshUsers");
  const btnCreateUser  = $first("btnCreateUser");
  const btnCreateAcc   = $first("btnCreateAccount");
  const userSelect     = $first("userSelect","usersSelect");

  on(btnReloadUsers, "click", ()=> loadUsers().catch(e=>setStatus("err", readableErr(e))));
  on(btnCreateUser,  "click", ()=> createUser().catch(e=>setStatus("err", readableErr(e))));
  on(btnCreateAcc,   "click", ()=> createAccount().catch(e=>setStatus("err", readableErr(e))));

  on(userSelect, "change", ()=>{
    const hasUser = !!(userSelect?.value || "");
    setDisabledByUserSelected(!hasUser);
    const hint = $first("accountHint");
    if (hint) hint.textContent = hasUser ? "" : "请选择用户后再创建账号。";
  });
}

async function boot(){
  // 账号区显示：label（小红书），但不参与写入
  syncAccountPackDisplay();

  const schemaHint = $first("schemaHint");
  if (schemaHint){
    schemaHint.textContent = `就绪（users/accounts）｜${getPackId()} / ${getPackVersion()}`;
  }

  await loadUsers();
  setDisabledByUserSelected(true);

  const hint = $first("accountHint");
  if (hint) hint.textContent = "请选择用户后再创建账号。";

  setStatus("ok","就绪");
}

/** ------- users ------- **/
async function loadUsers(){
  setStatus("ok","加载用户列表…");

  // ✅ 注意：worker 路由是 /user/list（不是 /users/list）
  const out = await httpjson(`${apiBase()}/user/list`, { method:"GET" });
  users = out.items || [];

  const sel = $first("userSelect","usersSelect");
  if (!sel) throw new Error("userSelect_not_found");

  sel.innerHTML =
    `<option value="">${EMPTY_TEXT}</option>` +
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
  const usernameEl = $first("newUsername","username");
  const displayEl  = $first("newDisplayName","displayName");

  const username = (usernameEl?.value || "").trim();
  const display_name = (displayEl?.value || "").trim();

  const err1 = validateUsername(username);
  if (err1) return setStatus("err", err1);
  if (!display_name) return setStatus("err", "请填写昵称（display_name）");

  setStatus("ok","创建用户…");

  const out = await httpjson(`${apiBase()}/user/create`, {
    method:"POST",
    body: JSON.stringify({ username, display_name })
  });

  await loadUsers();

  const sel = $first("userSelect","usersSelect");
  if (out?.id && sel){
    sel.value = String(out.id);
    sel.dispatchEvent(new Event("change"));
  }

  if (usernameEl) usernameEl.value = "";
  if (displayEl) displayEl.value = "";

  setStatus("ok", `用户创建成功：${display_name}（${username}）`);
}

/** ------- accounts ------- **/
async function createAccount(){
  const userSelect = $first("userSelect","usersSelect");
  const owner_id = userSelect?.value || "";
  if (!owner_id) return setStatus("err","请先选择用户");

  // ✅ 写入 D1：永远用顶部下拉的 value（pack_id / pack_version）
  const pack_id = getPackId();
  const pack_version = getPackVersion();

  const handleEl = $first("accountHandle","handle");
  const noteEl   = $first("accountNote","note");

  const handle = (handleEl?.value || "").trim();
  const note = (noteEl?.value || "").trim();

  if (!pack_id) return setStatus("err","pack_id_required");
  if (!pack_version) return setStatus("err","pack_version_required");
  if (!handle) return setStatus("err","请填写账号名称/标识（handle）");

  setStatus("ok","创建账号…");

  const out = await httpjson(`${apiBase()}/account/create`, {
    method:"POST",
    body: JSON.stringify({ owner_id, pack_id, pack_version, handle, note })
  });

  if (handleEl) handleEl.value = "";
  if (noteEl) noteEl.value = "";

  setStatus("ok", `账号创建成功：${handle}（account_id: ${out?.id || ""}）`);
}

/** ------- error mapping ------- **/
function readableErr(e){
  const data = e?.data || null;

  // 优先用后端 message（对人更友好）
  if (data?.message) return data.message;

  const code = data?.error || e?.message || "unknown_error";
  const map = {
    user_exists: "该用户名已存在，请换一个用户名。",
    username_required: "请填写用户名。",
    display_name_required: "请填写昵称。",
    user_create_failed: "创建用户失败。",
    owner_id_required: "请先选择用户。",
    pack_id_required: "pack_id 缺失。",
    pack_version_required: "pack_version 缺失。",
    account_handle_required: "请填写账号名称/标识（handle）。",
    account_create_failed: "创建账号失败。"
  };

  const detail = data?.detail ? `（${String(data.detail).slice(0,200)}）` : "";
  return (map[code] || code) + detail;
}
