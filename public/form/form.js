/* /public/form/form.js */
const EMPTY_TEXT = "请选择";
const LS_OWNER_KEY = "tracklab_owner_id";
const LS_ACCOUNT_KEY = "tracklab_account_id";

function $(id){ return document.getElementById(id); }

function setStatus(type, msg){
  const el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (type === "err" ? " err" : "");
}

async function httpjson(url, opt={}){
  const res = await fetch(url, {
    ...opt,
    headers: {
      "content-type":"application/json",
      ...(opt.headers||{})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; }
  if (!res.ok) {
    const msg = data?.error || data?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function getAllFieldsFromSchema(schema){
  if (!schema) return [];
  // v1: { fields: [...] }
  if (Array.isArray(schema.fields)) return schema.fields.map(f=>({ ...f }));
  // v2: { groups: [{id,label,fields:[...]}] }
  if (Array.isArray(schema.groups)){
    const out = [];
    for (const g of schema.groups){
      const glabel = g.label || g.id || "";
      const gfields = Array.isArray(g.fields) ? g.fields : [];
      for (const f of gfields){
        out.push({ ...f, __group: glabel });
      }
    }
    return out;
  }
  return [];
}

function setControlDisabled(el, disabled){
  if (!el) return;
  // native controls
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement){
    el.disabled = disabled;
    return;
  }
  // containers: disable all inner controls
  el.querySelectorAll("input,select,textarea,button").forEach(x=>{ x.disabled = disabled; });
}

function readControlValue(field, el){
  if (!el) return null;
  const type = field.type || "text";

  if (type === "multi_enum"){
    const boxes = el.querySelectorAll('input[type="checkbox"][name="'+CSS.escape(field.key)+'"]:checked');
    return Array.from(boxes).map(x=>x.value);
  }

  if (type === "bool"){
    const v = el.value;
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  }

  const v = el.value;
  if (typeof v === "string"){
    const t = v.trim();
    return t === "" ? null : t;
  }
  return v ?? null;
}

/** ------- state ------- **/
let manifest = null;
let uiSchema = null;

let owners = [];
let accounts = [];
let presets = [];

let currentOwnerId = "";
let currentAccountId = "";
let currentPreset = null;

let currentStage = "S0";
let currentPayload = null;

/** ------- helpers ------- **/
function apiBase(){
  const v = $("apiBase").value.trim();
  return v.replace(/\/+$/,"");
}
function getPackId(){ return $("packId").value; }
function getPackVersion(){ return $("packVersion").value; }

function stageRank(s){
  if (!s) return -1;
  const m = String(s).match(/^S(\d+)$/i);
  return m ? Number(m[1]) : -1;
}
function minStage(arr){
  if (!Array.isArray(arr) || arr.length===0) return null;
  let best = arr[0];
  for (const s of arr){
    if (stageRank(s) < stageRank(best)) best = s;
  }
  return best;
}

/** ------- init ------- **/
window.addEventListener("DOMContentLoaded", ()=>{
  $("btnLoad").addEventListener("click", ()=> boot().catch(e=>setStatus("err", e.message)));
  $("packId").addEventListener("change", ()=> boot().catch(e=>setStatus("err", e.message)));
  $("packVersion").addEventListener("change", ()=> boot().catch(e=>setStatus("err", e.message)));

  $("ownerSelect").addEventListener("change", ()=> {
    localStorage.setItem(LS_OWNER_KEY, $("ownerSelect").value);
    boot().catch(e=>setStatus("err", e.message));
  });

  $("accountSelect").addEventListener("change", ()=> {
    localStorage.setItem(LS_ACCOUNT_KEY, $("accountSelect").value);
    presetRefreshList().catch(e=>setStatus("err", e.message));
  });

  $("presetSelect").addEventListener("change", ()=> presetLoadAndRender().catch(e=>setStatus("err", e.message)));

  $("btnSave").addEventListener("click", ()=> saveCurrentStage().catch(e=>setStatus("err", e.message)));
});

/** ------- pack schema ------- **/
async function loadPackSchema(){
  setStatus("ok","加载 Schema…");
  const out = await httpjson(`${apiBase()}/pack/${getPackId()}/${getPackVersion()}`);
  manifest = out.manifest;
  uiSchema = out.ui_schema;
  $("schemaHint").textContent = `Schema 已加载：${uiSchema?.meta?.name || "ui_schema"} (${getPackId()} / ${getPackVersion()})`;
  setStatus("ok","Schema 已加载");
}

/** ------- owners / accounts ------- **/
async function loadOwners() {
  const out = await httpjson(`${apiBase()}/owners/list?limit=200`);
  owners = out.items || [];
  const sel = $("ownerSelect");
  sel.innerHTML = owners.map(o=>`<option value="${escapeHtml(o.owner_id)}">${escapeHtml(o.owner_id)}</option>`).join("");

  const saved = localStorage.getItem(LS_OWNER_KEY);
  if (saved && owners.some(o=>o.owner_id===saved)) sel.value = saved;
  currentOwnerId = sel.value || "";
}

async function loadAccounts(){
  if (!currentOwnerId) return;
  const out = await httpjson(`${apiBase()}/accounts/list?owner_id=${encodeURIComponent(currentOwnerId)}&limit=200`);
  accounts = out.items || [];
  const sel = $("accountSelect");
  sel.innerHTML = accounts.map(a=>{
    const label = a.account_id || a.id || "";
    return `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
  }).join("");

  const saved = localStorage.getItem(LS_ACCOUNT_KEY);
  if (saved && accounts.some(a=>(a.account_id||a.id)===saved)) sel.value = saved;

  currentAccountId = sel.value || "";
}

/** ------- presets ------- **/
async function presetRefreshList(){
  if (!currentOwnerId || !currentAccountId) return;

  const out = await httpjson(`${apiBase()}/preset/list?owner_id=${encodeURIComponent(currentOwnerId)}&account_id=${encodeURIComponent(currentAccountId)}&pack_id=${encodeURIComponent(getPackId())}&pack_version=${encodeURIComponent(getPackVersion())}&limit=200`);
  presets = out.items || [];

  const sel = $("presetSelect");
  sel.innerHTML = presets
    .map(p=>{
      const st = p.stage || "S0";
      const label = `${p.name || p.id} [${st}] (${p.updated_at || p.created_at || ""})`;
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(label)}</option>`;
    }).join("");

  // auto select first if none
  if (presets.length>0 && !sel.value) sel.value = presets[0].id;

  await presetLoadAndRender();
}

async function presetLoadAndRender(){
  const id = $("presetSelect").value;
  if (!id) return;

  const out = await httpjson(`${apiBase()}/preset/get/${encodeURIComponent(id)}`);
  currentPreset = out.preset;
  currentStage = currentPreset?.stage || "S0";
  currentPayload = currentPreset?.payload || {};

  $("presetId").value = currentPreset?.id || "";
  $("presetStage").value = currentStage;
  $("presetEnabled").value = String(currentPreset?.enabled ?? "");

  renderForm();

  setStatus("ok", "preset 已加载");
}

/** ------- render form ------- **/
function renderForm(){
  const c = $("formContainer");
  c.innerHTML = "";
  if (!uiSchema || !currentPreset) {
    c.innerHTML = `<div class="sub">(empty)</div>`;
    return;
  }

  const fields = getAllFieldsFromSchema(uiSchema);
  const curRank = stageRank(currentStage);

  // 只展示 stage <= 当前 stage 的字段（按 min(editable_stages) 判断）
  const visible = fields.filter(f=>{
    const first = minStage(f.editable_stages) || "S0";
    return stageRank(first) <= curRank;
  });

  if (visible.length === 0){
    c.innerHTML = `<div class="sub">(empty)</div>`;
    return;
  }

  // 按 stage 分组：S0/S1...
  const groups = new Map();
  for (const f of visible){
    const first = minStage(f.editable_stages) || "S0";
    if (!groups.has(first)) groups.set(first, []);
    groups.get(first).push(f);
  }

  const stages = Array.from(groups.keys()).sort((a,b)=>stageRank(a)-stageRank(b));

  for (const st of stages){
    const box = document.createElement("div");
    box.className = "fieldcard";

    const head = document.createElement("div");
    head.className = "fieldhead";
    head.innerHTML = `<div><b>${escapeHtml(st)}</b></div><div class="pill">${stageRank(st)===curRank ? "当前阶段可编辑" : "历史阶段只读"}</div>`;
    box.appendChild(head);

    const list = groups.get(st) || [];
    for (const f of list){
      const key = f.key;
      const label = f.label || key;
      const isEditable = Array.isArray(f.editable_stages) && f.editable_stages.includes(currentStage) && Number(currentPreset.enabled)===1;

      const wrap = document.createElement("div");
      wrap.style.marginBottom = "10px";

      const lab = document.createElement("label");
      lab.textContent = label + (Array.isArray(f.required_stages) && f.required_stages.includes(currentStage) ? " *" : "");
      wrap.appendChild(lab);

      const input = buildInputForField(f, currentPayload?.[key]);
      input.id = `fld__${key}`;
      setControlDisabled(input, !isEditable);

      wrap.appendChild(input);

      if (f.help){
        const help = document.createElement("div");
        help.className = "stagehint";
        help.textContent = f.help;
        wrap.appendChild(help);
      }

      box.appendChild(wrap);
    }

    c.appendChild(box);
  }
}

function buildInputForField(field, value){
  const type = field.type || "text";

  if (type === "textarea"){
    const el = document.createElement("textarea");
    el.value = value == null ? "" : String(value);
    return el;
  }

  if (type === "enum"){
    const el = document.createElement("select");
    const opts = field.options || [];
    el.innerHTML = [`<option value="">请选择</option>`]
      .concat(opts.map(o=>`<option value="${escapeHtml(o.value)}">${escapeHtml(o.label||o.value)}</option>`))
      .join("");
    el.value = value == null ? "" : String(value);
    return el;
  }

  if (type === "multi_enum"){
    const wrap = document.createElement("div");
    wrap.className = "checks";
    wrap.dataset.type = "multi_enum";
    wrap.dataset.key = field.key;

    const selected = new Set(Array.isArray(value) ? value : []);
    const opts = field.options || [];
    for (const opt of opts){
      const lab = document.createElement("label");
      lab.className = "check";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = field.key;
      cb.value = opt.value;
      cb.checked = selected.has(opt.value);

      const span = document.createElement("span");
      span.textContent = opt.label || opt.value;

      lab.appendChild(cb);
      lab.appendChild(span);
      wrap.appendChild(lab);
    }
    return wrap;
  }

  if (type === "bool"){
    const el = document.createElement("select");
    el.innerHTML = `
      <option value="">请选择</option>
      <option value="true">是</option>
      <option value="false">否</option>
    `;
    if (value === true) el.value = "true";
    else if (value === false) el.value = "false";
    else el.value = "";
    return el;
  }

  // 默认 text
  const el = document.createElement("input");
  el.type = "text";
  el.value = value == null ? "" : String(value);
  return el;
}

/** ------- save current stage ------- **/
async function saveCurrentStage(){
  if (!currentPreset?.id) throw new Error("未加载 preset");
  if (Number(currentPreset.enabled) !== 1) throw new Error("该 preset 已淘汰（enabled=0），不可保存");

  setStatus("ok","保存中…");

  const fields = getAllFieldsFromSchema(uiSchema);
  const editableFields = fields.filter(f => Array.isArray(f.editable_stages) && f.editable_stages.includes(currentStage));
  const merged = { ...(currentPayload || {}) };

  for (const f of editableFields){
    const key = f.key;
    const el = $(`fld__${key}`);
    if (!el) continue;

    let v = readControlValue(f, el);

    // required：只在当前 stage 校验
    if (Array.isArray(f.required_stages) && f.required_stages.includes(currentStage)){
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)){
        throw new Error(`缺少必填：${f.label || f.key}`);
      }
    }

    merged[key] = v;
  }

  // 写回 preset（payload 原样覆盖）
  await httpjson(`${apiBase()}/preset/update/${encodeURIComponent(currentPreset.id)}`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      payload: merged,
      stage: currentStage, // 不改 stage，只回写同值
    }),
  });

  currentPayload = merged;

  // 保存后预览 prompt（可选；Admin-Lite 通常不需要，但你当前页面文案写了会刷新预览）
  if (typeof previewPromptToDebug === "function"){
    await previewPromptToDebug(currentStage, currentPayload);
  }

  setStatus("ok","已保存");
}

/** ------- boot ------- **/
async function boot(){
  try {
    await loadPackSchema();
    await loadOwners();
    await loadAccounts();
    await presetRefreshList();
  } catch (e){
    setStatus("err", e.message);
  }
}
