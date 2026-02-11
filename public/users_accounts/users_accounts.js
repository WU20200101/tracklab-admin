/* TrackLab users + accounts create page (no hard-link; pack index driven)
 * Works with existing /public/users_accounts/index.html element IDs.
 * - apiBase: read from ?api=... OR /config.json OR existing input value
 * - packId/packVersion: populated from GET {apiBase}/packs/index
 * - user list + create user/account: via Worker endpoints
 */

const EMPTY_TEXT = "请选择";

function $id(id){ return document.getElementById(id); }
function on(el, evt, fn){ if (el) el.addEventListener(evt, fn); }

function setStatus(type, msg){
  const el = $id("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (type === "err" ? " err" : "");
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
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

function trimSlash(s){ return String(s||"").trim().replace(/\/+$/,""); }

function apiBase(){
  const el = $id("apiBase");
  return trimSlash(el?.value || "");
}

function packIdEl(){ return $id("packId"); }
function packVerEl(){ return $id("packVersion"); }

function getPackId(){ return (packIdEl()?.value || "").trim(); }
function getPackVersion(){ return (packVerEl()?.value || "").trim(); }

function getPackLabel(){
  const el = packIdEl(); if (!el) return "";
  const opt = el.options?.[el.selectedIndex];
  return (opt?.textContent || el.value || "").trim();
}
function getPackVersionLabel(){
  const el = packVerEl(); if (!el) return "";
  const opt = el.options?.[el.selectedIndex];
  return (opt?.textContent || el.value || "").trim();
}

function syncAccountPackDisplay(){
  const packText = $id("accountPackId");
  const verText  = $id("accountPackVersion");
  if (packText){
    packText.value = getPackLabel() || getPackId();
    packText.disabled = true;
    packText.readOnly = true;
  }
  if (verText){
    verText.value = getPackVersionLabel() || getPackVersion();
    verText.disabled = true;
    verText.readOnly = true;
  }
}

// Compatibility: some earlier builds referenced this name.
// Keep as no-op so page never breaks even if HTML or other scripts call it.
window.syncAccountPackHidden = function(){ /* no-op */ };

function setDisabledByUserSelected(disabled){
  const ids = ["accountHandle","accountNote","btnCreateAccount"];
  ids.forEach(id=>{ const el=$id(id); if (el) el.disabled = disabled; });
  syncAccountPackDisplay();
}

function userLabel(u){
  const dn = (u.display_name || "").trim();
  const un = (u.username || "").trim();
  if (dn && un) return `${dn} (${un})`;
  return dn || un || u.id;
}

let packsIndex = null;
let users = [];

function qs(){
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
}

async function loadConfig(){
  // priority: ?api=... > /config.json > existing input
  const p = qs().get("api");
  if (p){
    const el = $id("apiBase");
    if (el) el.value = trimSlash(p);
    return;
  }
  try{
    const res = await fetch("/config.json", { cache:"no-store" });
    if (!res.ok) return;
    const cfg = await res.json();
    const base = trimSlash(cfg?.api_base || cfg?.apiBase || cfg?.worker || "");
    if (base){
      const el = $id("apiBase");
      if (el) el.value = base;
    }
  }catch{/* ignore */}
}

function setSchemaHint(){
  const el = $id("schemaHint");
  if (!el) return;
  const pid = getPackId();
  const ver = getPackVersion();
  el.textContent = `就绪（users/accounts）｜${pid || "-"} / ${ver || "-"}`;
}

function renderPackSelectors(idx){
  const packSel = packIdEl();
  const verSel  = packVerEl();
  if (!packSel || !verSel) throw new Error("pack_selectors_not_found");

  const packs = Array.isArray(idx?.packs) ? idx.packs : [];
  const defPid = idx?.default?.pack_id || "";
  const defVer = idx?.default?.pack_version || "";

  // pack options
  packSel.innerHTML = packs.map(p=>{
    const pid = p.pack_id || p.id || "";
    const label = p.label || pid;
    return `<option value="${escapeHtml(pid)}">${escapeHtml(label)}</option>`;
  }).join("");

  // choose default pack
  if (defPid && [...packSel.options].some(o=>o.value===defPid)) packSel.value = defPid;
  else if (packSel.options.length) packSel.selectedIndex = 0;

  // render versions for selected pack
  const versionsFor = (pid)=>{
    const p = packs.find(x => (x.pack_id||x.id||"") === pid);
    const vers = Array.isArray(p?.versions) ? p.versions : [];
    return vers.map(v=>{
      const pv = v.pack_version || v.version || "";
      const label = v.label || pv;
      return { pv, label };
    }).filter(x=>x.pv);
  };

  const renderVersions = ()=>{
    const pid = getPackId();
    const vers = versionsFor(pid);
    verSel.innerHTML = vers.map(v=>`<option value="${escapeHtml(v.pv)}">${escapeHtml(v.label)}</option>`).join("");
    if (pid === defPid && defVer && [...verSel.options].some(o=>o.value===defVer)) verSel.value = defVer;
    else if (verSel.options.length) verSel.selectedIndex = 0;
    syncAccountPackDisplay();
    setSchemaHint();
  };

  renderVersions();

  on(packSel, "change", ()=>{ renderVersions(); });
  on(verSel,  "change", ()=>{ syncAccountPackDisplay(); setSchemaHint(); });
}

async function loadPacksIndex(){
  setStatus("ok","加载 packs/index…");
  const idx = await httpjson(`${apiBase()}/packs/index`, { method:"GET" });
  packsIndex = idx;
  renderPackSelectors(idx);
  setStatus("ok","就绪");
}

async function loadUsers(){
  setStatus("ok","加载用户列表…");
  const out = await httpjson(`${apiBase()}/user/list`, { method:"GET" });
  users = out.items || [];

  const sel = $id("userSelect");
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
  const usernameEl = $id("newUsername");
  const displayEl  = $id("newDisplayName");

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

  const sel = $id("userSelect");
  if (out?.id && sel){
    sel.value = String(out.id);
    sel.dispatchEvent(new Event("change"));
  }

  if (usernameEl) usernameEl.value = "";
  if (displayEl) displayEl.value = "";

  setStatus("ok", `用户创建成功：${display_name}（${username}）`);
}

async function createAccount(){
  const userSelect = $id("userSelect");
  const owner_id = userSelect?.value || "";
  if (!owner_id) return setStatus("err","请先选择用户");

  const pack_id = getPackId();
  const pack_version = getPackVersion();

  const handleEl = $id("accountHandle");
  const noteEl   = $id("accountNote");

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

function readableErr(e){
  const data = e?.data || null;
  if (data?.message) return data.message;
  const code = data?.error || e?.message || "unknown_error";
  const map = {
    user_exists: "该用户名已存在，请换一个用户名。",
    username_required: "请填写用户名。",
    display_name_required: "请填写昵称。",
    owner_id_required: "请先选择用户。",
    pack_id_required: "pack_id 缺失。",
    pack_version_required: "pack_version 缺失。",
    account_handle_required: "请填写账号名称/标识（handle）。"
  };
  const detail = data?.detail ? `（${String(data.detail).slice(0,200)}）` : "";
  return (map[code] || code) + detail;
}

function bindEvents(){
  on($id("btnReloadUsers"), "click", ()=> loadUsers().catch(e=>setStatus("err", readableErr(e))));
  on($id("btnCreateUser"),  "click", ()=> createUser().catch(e=>setStatus("err", readableErr(e))));
  on($id("btnCreateAccount"), "click", ()=> createAccount().catch(e=>setStatus("err", readableErr(e))));

  const userSelect = $id("userSelect");
  on(userSelect, "change", ()=>{
    const hasUser = !!(userSelect?.value || "");
    setDisabledByUserSelected(!hasUser);
    const hint = $id("accountHint");
    if (hint) hint.textContent = hasUser ? "" : "请选择用户后再创建账号。";
  });
}

async function boot(){
  await loadConfig();
  bindEvents();
  await loadPacksIndex();
  syncAccountPackDisplay();
  setSchemaHint();
  await loadUsers();
  setDisabledByUserSelected(true);
  const hint = $id("accountHint");
  if (hint) hint.textContent = "请选择用户后再创建账号。";
  setStatus("ok","就绪");
}

window.addEventListener("DOMContentLoaded", ()=>{
  boot().catch(e=>setStatus("err", readableErr(e)));
});
