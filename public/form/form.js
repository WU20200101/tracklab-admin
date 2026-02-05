/* /public/form/form.js (TrackLab Admin-Lite) */
const EMPTY_TEXT = "请选择";
const LS_OWNER_KEY = "tracklab_owner_id";
const LS_ACCOUNT_KEY = "tracklab_account_id";

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
  if (!res.ok) {
    const msg = data?.error || data?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
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

function stageRank(s){
  if (!s) return -1;
  const m = String(s).match(/^S(\d+)$/i);
  return m ? Number(m[1]) : 999;
}
function minStage(stages){
  if (!Array.isArray(stages) || stages.length===0) return null;
  return stages.slice().sort((a,b)=>stageRank(a)-stageRank(b))[0];
}

// ✅ 兼容 schema：fields 或 groups.fields
function getAllFieldsFromSchema(schema){
  if (!schema) return [];
  if (Array.isArray(schema.fields)) return schema.fields.map(f=>({ ...f }));
  if (Array.isArray(schema.groups)){
    const out = [];
    for (const g of schema.groups){
      for (const f of (g.fields || [])){
        out.push({ ...f, __group: (g.label||g.id||"") });
      }
    }
    return out;
  }
  return [];
}

function setControlDisabled(root, disabled){
  if (!root) return;
  if (root instanceof HTMLInputElement || root instanceof HTMLSelectElement || root instanceof HTMLTextAreaElement){
    root.disabled = disabled;
    return;
  }
  root.querySelectorAll("input,select,textarea,button").forEach(el=>{ el.disabled = disabled; });
}

/** ------- state ------- **/
let uiSchema = null;
let manifest = null;

let currentOwnerId = "";
let currentAccountId = "";
let currentPresetId = "";
let currentPreset = null;
let currentPayload = {};
let currentStage = "S0";

/** ------- boot ------- **/
window.addEventListener("DOMContentLoaded", ()=>{
  // 固定 API base（你页面上是只读灰色）
  if ($("apiBase")) $("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";

  // 你当前只用 xhs/v1.0.0（保持）
  if ($("packId")) $("packId").innerHTML = `<option value="xhs">小红书</option>`;
  if ($("packVersion")) $("packVersion").innerHTML = `<option value="v1.0.0">v1.0.0</option>`;

  bindEvents();

  boot().catch(e=>setStatus("err", e.message));
});

function bindEvents(){
  on("btnLoad", "click", ()=> boot().catch(e=>setStatus("err", e.message)));
  on("packId", "change", ()=> boot().catch(e=>setStatus("err", e.message)));
  on("packVersion", "change", ()=> boot().catch(e=>setStatus("err", e.message)));

  on("ownerId", "change", ()=> handleOwnerChanged().catch(e=>setStatus("err", e.message)));
  on("accountSelect", "change", ()=> handleAccountChanged().catch(e=>setStatus("err", e.message)));

  on("onlyEnabled", "change", ()=> presetRefreshList().catch(e=>setStatus("err", e.message)));
  on("stageFilter", "change", ()=> presetRefreshList().catch(e=>setStatus("err", e.message)));
  on("presetSelect", "change", ()=> presetLoadAndRender().catch(e=>setStatus("err", e.message)));

  on("btnSave", "click", ()=> saveCurrentStage().catch(e=>setStatus("err", e.message)));
}

async function boot(){
  await loadPackSchema();
  await loadOwners();
  await handleOwnerChanged();
  setStatus("ok","就绪");
}

/** ------- pack schema ------- **/
async function loadPackSchema(){
  setStatus("ok","加载 Schema…");
  const out = await httpjson(`${apiBase()}/pack/${getPackId()}/${getPackVersion()}`);
  manifest = out.manifest;
  uiSchema = out.ui_schema;
  if ($("schemaHint")) $("schemaHint").textContent =
    `Schema 已加载：${uiSchema?.meta?.name || "ui_schema"} (${getPackId()} / ${getPackVersion()})`;
  setStatus("ok","Schema 已加载");
}

/** ------- owners/accounts ------- **/
async function loadOwners(){
  const sel = $("ownerId");
  if (!sel) return;

  // 只保留一个空选项：请选择
  sel.innerHTML = `<option value="">请选择</option>`;
  sel.value = ""; // 强制默认

  const out = await httpjson(`${apiBase()}/owner/list`, { method:"GET" });
  const items = out.items || [];

  items.forEach(id=>{
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = String(id);
    sel.appendChild(opt);
  });
}


async function handleOwnerChanged(){
  currentOwnerId = $("ownerId")?.value || "";

  currentAccountId = "";
  clearPresetInfo();
  clearForm();

  if (!currentOwnerId){
    if ($("accountSelect")) $("accountSelect").innerHTML = `<option value="">请先选择用户名</option>`;
    if ($("presetSelect")) $("presetSelect").innerHTML = `<option value="">请先选择用户名</option>`;
    return;
  }

  await refreshAccounts();
  await handleAccountChanged();
}

async function refreshAccounts(){
  setStatus("ok","加载账号…");
  const out = await httpjson(
    `${apiBase()}/account/list?owner_id=${encodeURIComponent(currentOwnerId)}`,
    { method:"GET" }
  );
  const items = out.items || [];

  const sel = $("accountSelect");
  if (!sel) return;

  if (!items.length){
    sel.innerHTML = `<option value="">请先选择用户名</option>`;
    sel.value = "";
    currentAccountId = "";
    return;
  }

  sel.innerHTML = [`<option value="">请选择</option>`].concat(
    items.map(it=>{
      const handle = (it.handle && String(it.handle).trim()) ? it.handle : "(no handle)";
      return `<option value="${escapeHtml(it.id)}">${escapeHtml(handle)} (${escapeHtml(it.updated_at||"")})</option>`;
    })
  ).join("");

  // 不记录上次账号：不读/写 localStorage
  sel.value = "";              // 强制默认“请选择”
  currentAccountId = "";       // 账号未选中
}


async function handleAccountChanged(){
  currentAccountId = $("accountSelect")?.value || "";

  clearPresetInfo();
  clearForm();

  if (!currentAccountId){
    if ($("presetSelect")) $("presetSelect").innerHTML = `<option value="">请选择有效账号</option>`;
    return;
  }

  await presetRefreshList();
  // await presetLoadAndRender(); // 你如果有这步
}


/** ------- presets ------- **/
function normalizeStageFilter(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s === "全部级别" || s === "全部" || s.toLowerCase() === "all") return "";
  if (/^S[0-3]$/i.test(s)) return s.toUpperCase();
  if (/^[0-3]$/.test(s)) return `S${s}`;
  const m = s.match(/([0-3])/);
  if (m) return `S${m[1]}`;
  return "";
}

async function presetRefreshList(){
  setStatus("ok","加载角色列表…");

  // 兼容不同 id（你两个页面命名不一致时也不炸）
  const enabledRaw =
    ($("onlyEnabled")?.value ?? $("enabledOnly")?.value ?? "").toString().trim();
  const stageRaw =
    ($("stageFilter")?.value ?? "").toString().trim();

  const enabled = enabledRaw;                 // "" / "0" / "1"
  const stage = normalizeStageFilter(stageRaw); // "" / "S0-S3"

  const qs = new URLSearchParams();
  qs.set("pack_id", getPackId());
  qs.set("pack_version", getPackVersion());

  // ✅ 只有明确选择某级才传 stage
  if (stage) qs.set("stage", stage);

  // ✅ 只有明确选择 0/1 才传 enabled；“全部角色（含淘汰）”就不传
  if (enabled === "0" || enabled === "1") qs.set("enabled", enabled);

  // ✅ 始终按账号过滤（form 必须是“选账号→看角色”）
  if (currentAccountId) qs.set("account_id", currentAccountId);

  const url = `${apiBase()}/preset/list?${qs.toString()}`;
  // console.log("PRESET LIST URL =", url);

  const out = await httpjson(url, { method:"GET" });
  const items = out.items || [];

  const sel = $("presetSelect");
  if (!sel) return;

  sel.innerHTML = items.length
    ? [`<option value="">请选择</option>`].concat(items.map(it=>{
        const badge = Number(it.enabled)===1 ? "" : "（已淘汰）";
        return `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name)} [${escapeHtml(it.stage)}] ${badge} (${escapeHtml(it.updated_at||"")})</option>`;
      })).join("")
    : `<option value="">当前筛选条件无角色</option>`;

  // ✅ 不自动选中
  sel.value = "";
}

async function presetLoadAndRender(){
  const preset_id = $("presetSelect")?.value || "";
  if (!preset_id){
    clearPresetInfo();
    clearForm();
    return;
  }

  setStatus("ok","加载角色详情…");

  // ✅ 关键：严格按你 Worker 要求传 preset_id/pack_id/pack_version
  const out = await httpjson(
    `${apiBase()}/preset/get?preset_id=${encodeURIComponent(preset_id)}&pack_id=${encodeURIComponent(getPackId())}&pack_version=${encodeURIComponent(getPackVersion())}`,
    { method:"GET" }
  );

  currentPreset = out.item || out.preset || null;
  if (!currentPreset) throw new Error("preset_not_found");

  currentPresetId = currentPreset.id;
  currentPayload = currentPreset.payload || {};
  currentStage = currentPreset.stage || "S0";

  if ($("presetId")) $("presetId").value = currentPreset.id || "";
  if ($("presetStage")) $("presetStage").value = currentStage;
  if ($("presetEnabled")) $("presetEnabled").value = String(currentPreset.enabled);

  const disabled = Number(currentPreset.enabled) !== 1;
  if ($("btnSave")) $("btnSave").disabled = disabled;
  if ($("saveHint")) $("saveHint").textContent =
    disabled ? "该角色已淘汰（enabled=0），仅可回看，不可保存。" : "仅当前 stage 字段可编辑；保存后会刷新预览 prompt。";

  renderForm();

  await previewPromptToDebug(currentStage, currentPayload).catch(()=>{});
  setStatus("ok","角色已加载");
}

/** ------- render form ------- **/
function renderForm(){
  const c = $("formContainer");
  if (!c) return;

  c.innerHTML = "";
  if (!uiSchema || !currentPreset){
    c.innerHTML = `<div class="sub">当前阶段暂无可填写表单</div>`;
    return;
  }

  const fields = getAllFieldsFromSchema(uiSchema);
  const curRank = stageRank(currentStage);

  const visible = fields.filter(f=>{
    const first = minStage(f.editable_stages);
    if (!first) return false;
    return stageRank(first) <= curRank;
  });

  if (visible.length === 0){
    c.innerHTML = `<div class="sub">当前阶段暂无可填写表单</div>`;
    return;
  }

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

    for (const f of (groups.get(st)||[])){
      const key = f.key;
      const label = f.label || key;

      const isEditable =
        Array.isArray(f.editable_stages) &&
        f.editable_stages.includes(currentStage) &&
        Number(currentPreset.enabled)===1;

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

  // ✅ 多选：multi_enum
  function renderMultiCheckbox(field, values, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "chk-row";

  (field.options || []).forEach(opt => {
    const label = document.createElement("label");
    label.className = "chk-chip";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Array.isArray(values) && values.includes(opt.value);

    input.addEventListener("change", () => {
      const next = new Set(Array.isArray(values) ? values : []);
      if (input.checked) next.add(opt.value);
      else next.delete(opt.value);
      onChange(Array.from(next));
    });

    const text = document.createElement("span");
    text.textContent = opt.label ?? String(opt.value);

    label.appendChild(input);
    label.appendChild(text);
    wrap.appendChild(label);
  });

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

  const el = document.createElement("input");
  el.type = "text";
  el.value = value == null ? "" : String(value);
  return el;
}

/** ------- save ------- **/
async function saveCurrentStage(){
  if (!currentPreset?.id) throw new Error("未加载 preset");
  if (Number(currentPreset.enabled) !== 1) throw new Error("该 preset 已淘汰（enabled=0），不可保存");

  setStatus("ok","保存中…");

  const fields = getAllFieldsFromSchema(uiSchema);
  const editableFields = fields.filter(f => Array.isArray(f.editable_stages) && f.editable_stages.includes(currentStage));
  const merged = { ...(currentPayload || {}) };

  for (const f of editableFields){
    const key = f.key;
    const root = $(`fld__${key}`);
    if (!root) continue;

    let v = null;

    if ((f.type||"") === "multi_enum"){
      v = Array.from(root.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(key)}"]:checked`))
        .map(x=>x.value);
    } else {
      v = root.value;
    }

    if ((f.type||"") === "bool"){
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else v = null;
    }

    if (typeof v === "string"){
      v = v.trim();
      if (v === "") v = null;
    }

    if (Array.isArray(f.required_stages) && f.required_stages.includes(currentStage)){
      if (v == null || v === "" || (Array.isArray(v) && v.length===0)){
        throw new Error(`缺少必填：${f.label || f.key}`);
      }
    }

    merged[key] = v;
  }

  await httpjson(`${apiBase()}/preset/update/${encodeURIComponent(currentPreset.id)}`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      payload: merged,
      stage: currentStage,
    }),
  });

  currentPayload = merged;
  await previewPromptToDebug(currentStage, currentPayload).catch(()=>{});
  setStatus("ok","已保存");
}

async function previewPromptToDebug(stage, payload){
  const pre = $("debugPrompt");
  if (!pre) return;
  const out = await httpjson(`${apiBase()}/preview`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      stage,
      payload,
      preset_id: currentPreset.id,
    }),
  });
  pre.textContent = out.prompt_text || "保存后将显示生成脚本预览";
}

/** ------- ui clear ------- **/
function clearPresetInfo(){
  currentPresetId = "";
  currentPreset = null;
  currentPayload = {};
  currentStage = "S0";
  if ($("presetId")) $("presetId").value = "";
  if ($("presetStage")) $("presetStage").value = "";
  if ($("presetEnabled")) $("presetEnabled").value = "";
  if ($("saveHint")) $("saveHint").textContent = "请选择账号与角色后编辑。";
}
function clearForm(){
  const c = $("formContainer");
  if (c) c.innerHTML = `<div class="sub">当前阶段暂无可填写表单</div>`;
  if ($("debugPrompt")) $("debugPrompt").textContent = "保存后将显示生成脚本预览";
}














