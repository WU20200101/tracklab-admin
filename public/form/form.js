/* /public/form/form.js */
const EMPTY_TEXT = "请选择";
const LS_OWNER_KEY = "tracklab_owner_id";
const LS_ACCOUNT_KEY = "tracklab_account_id";

function $(id){ return document.getElementById(id); }

// 安全事件绑定：元素不存在则跳过（避免 DOM 差异导致脚本中断）
function on(id, evt, fn){
  const el = $(id);
  if (!el) return;
  el.addEventListener(evt, fn);
}

function setControlDisabled(root, disabled){
  if (!root) return;
  if (root instanceof HTMLInputElement || root instanceof HTMLSelectElement || root instanceof HTMLTextAreaElement){
    root.disabled = disabled;
    return;
  }
  root.querySelectorAll("input,select,textarea,button").forEach(el=>{ el.disabled = disabled; });
}

function setStatus(type, msg){
  const el = $("status");
  if (!el) return;
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

/** ------- 基础配置 ------- **/
function apiBase(){ return ($("apiBase")?.value || "").trim().replace(/\/+$/,""); }
function getPackId(){ return $("packId")?.value || ""; }
function getPackVersion(){ return $("packVersion")?.value || ""; }

/** ------- stage 排序：S0 < S1 < ... ------- **/
function stageRank(s){
  if (!s) return -1;
  const m = String(s).match(/^S(\d+)$/i);
  return m ? Number(m[1]) : 999;
}
function minStage(stages){
  if (!Array.isArray(stages) || stages.length===0) return null;
  return stages.slice().sort((a,b)=>stageRank(a)-stageRank(b))[0];
}

// 兼容两种 schema：
// v1: { fields: [...] }
// v2: { groups: [{..., fields:[...]}] }
function getAllFieldsFromSchema(schema){
  if (!schema) return [];
  if (Array.isArray(schema.fields)) return schema.fields.map(f=>({ ...f }));
  if (Array.isArray(schema.groups)){
    const out=[];
    for (const g of schema.groups){
      const gfields = Array.isArray(g.fields) ? g.fields : [];
      for (const f of gfields) out.push({ ...f, __group: (g.label||g.id||"") });
    }
    return out;
  }
  return [];
}

/** ------- 全局状态 ------- **/
let uiSchema = null;
let manifest = null;

let currentOwnerId = "";
let currentAccountId = "";
let currentPresetId = "";
let currentPreset = null;     // /preset/get item
let currentPayload = {};      // 解析后的 payload
let currentStage = "S0";

/** ------- 页面初始化 ------- **/
async function boot(){
  // API base：固定（你也可以改成可编辑）
  if ($("apiBase")) $("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";

  // pack 下拉：最小实现（你现在只有 xhs / v1.0.0）
  if ($("packId")) $("packId").innerHTML = `<option value="xhs">小红书</option>`;
  if ($("packVersion")) $("packVersion").innerHTML = `<option value="v1.0.0">v1.0.0</option>`;

  bindEvents();

  await loadPackSchema();
  await loadOwners();
  await handleOwnerChanged(); // 自动拉账号 + 自动拉 preset
  setStatus("ok","就绪");
}

function bindEvents(){
  on("packId","change", async ()=> {
    await loadPackSchema().catch(e=>setStatus("err", e.message));
    await handleOwnerChanged().catch(e=>setStatus("err", e.message));
  });
  on("packVersion","change", async ()=> {
    await loadPackSchema().catch(e=>setStatus("err", e.message));
    await handleOwnerChanged().catch(e=>setStatus("err", e.message));
  });

  on("ownerId","change", ()=> handleOwnerChanged().catch(e=>setStatus("err", e.message)));
  on("accountSelect","change", ()=> handleAccountChanged().catch(e=>setStatus("err", e.message)));

  on("onlyEnabled","change", ()=> presetRefreshList().catch(e=>setStatus("err", e.message)));
  on("stageFilter","change", ()=> presetRefreshList().catch(e=>setStatus("err", e.message)));
  on("presetSelect","change", ()=> presetLoadAndRender().catch(e=>setStatus("err", e.message)));

  on("btnSave","click", ()=> saveCurrentStage().catch(e=>setStatus("err", e.message)));
}

/** ------- pack schema ------- **/
async function loadPackSchema(){
  setStatus("ok","加载 Schema…");
  const out = await httpjson(`${apiBase()}/pack/${getPackId()}/${getPackVersion()}`);
  manifest = out.manifest;
  uiSchema = out.ui_schema;
  if ($("schemaHint")) $("schemaHint").textContent = `Schema 已加载：${uiSchema?.meta?.name || "ui_schema"} (${getPackId()} / ${getPackVersion()})`;
  setStatus("ok","Schema 已加载");
}

/** ------- owners / accounts ------- **/
async function loadOwners() {
  const sel = $("ownerId");
  if (!sel) return;
  sel.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = EMPTY_TEXT;
  sel.appendChild(empty);

  // 后端接口：/owner/list
  const out = await httpjson(`${apiBase()}/owner/list`, { method: "GET" });
  const items = out.items || out.owners || [];

  for (const it of items){
    const id = it.owner_id || it.id || it;
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = String(id);
    sel.appendChild(opt);
  }

  const saved = localStorage.getItem(LS_OWNER_KEY);
  if (saved) sel.value = saved;

  currentOwnerId = sel.value || "";
}

async function handleOwnerChanged(){
  const sel = $("ownerId");
  if (!sel) return;

  currentOwnerId = sel.value || "";
  localStorage.setItem(LS_OWNER_KEY, currentOwnerId);

  await loadAccounts();
  await handleAccountChanged();
}

async function loadAccounts(){
  const sel = $("accountSelect");
  if (!sel) return;
  sel.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = EMPTY_TEXT;
  sel.appendChild(empty);

  if (!currentOwnerId) return;

  // 后端接口：/account/list?owner_id=...
  const out = await httpjson(`${apiBase()}/account/list?owner_id=${encodeURIComponent(currentOwnerId)}`, { method: "GET" });
  const items = out.items || out.accounts || [];

  for (const it of items){
    const id = it.account_id || it.id || it;
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = String(id);
    sel.appendChild(opt);
  }

  const saved = localStorage.getItem(LS_ACCOUNT_KEY);
  if (saved) sel.value = saved;

  currentAccountId = sel.value || "";
}

async function handleAccountChanged(){
  const sel = $("accountSelect");
  if (!sel) return;

  currentAccountId = sel.value || "";
  localStorage.setItem(LS_ACCOUNT_KEY, currentAccountId);

  await presetRefreshList();
}

/** ------- preset list/load ------- **/
async function presetRefreshList(){
  const sel = $("presetSelect");
  if (!sel) return;

  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = EMPTY_TEXT;
  sel.appendChild(empty);

  if (!currentOwnerId || !currentAccountId) {
    clearPresetMeta();
    renderForm();
    $("saveHint") && ($("saveHint").textContent = "请选择账号与角色后编辑。");
    return;
  }

  const onlyEnabled = $("onlyEnabled")?.checked ? 1 : 0;
  const stageFilter = $("stageFilter")?.value || "";

  const qs = new URLSearchParams({
    owner_id: currentOwnerId,
    account_id: currentAccountId,
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    only_enabled: String(onlyEnabled),
    stage: stageFilter,
    limit: "200",
  });

  const out = await httpjson(`${apiBase()}/preset/list?${qs.toString()}`, { method:"GET" });
  const items = out.items || [];

  for (const p of items){
    const id = p.id;
    const st = p.stage || "S0";
    const label = `${p.name || id} [${st}]`;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  // 自动选第一个
  if (items.length > 0) {
    sel.value = items[0].id;
    await presetLoadAndRender();
  } else {
    clearPresetMeta();
    renderForm();
    $("saveHint") && ($("saveHint").textContent = "当前筛选条件下没有角色。");
    $("debugPrompt") && ($("debugPrompt").textContent = "(empty)");
  }
}

async function presetLoadAndRender(){
  const sel = $("presetSelect");
  if (!sel) return;

  const id = sel.value;
  currentPresetId = id;

  if (!id){
    clearPresetMeta();
    renderForm();
    $("debugPrompt") && ($("debugPrompt").textContent = "(empty)");
    return;
  }

  const out = await httpjson(`${apiBase()}/preset/get?id=${encodeURIComponent(id)}`, { method:"GET" });
  currentPreset = out.preset || out.item || out;
  currentStage = currentPreset.stage || "S0";
  currentPayload = currentPreset.payload || {};

  // meta 回填
  $("presetId") && ($("presetId").value = currentPreset.id || "");
  $("presetStage") && ($("presetStage").value = currentStage);
  $("presetEnabled") && ($("presetEnabled").value = String(currentPreset.enabled ?? ""));

  renderForm();

  // 预览更新后的 prompt（仅调试）
  await previewPromptToDebug(currentStage, currentPayload);

  // 保存提示
  const enabled = Number(currentPreset.enabled ?? 1);
  $("saveHint") && ($("saveHint").textContent = enabled === 1 ? "仅当前 stage 字段可编辑；保存会刷新预览 prompt。" : "该角色已淘汰，仅可查看。");
}

/** ------- form render ------- **/
function renderForm(){
  const c = $("formContainer");
  if (!c) return;

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

      const isEditable =
        Array.isArray(f.editable_stages) &&
        f.editable_stages.includes(currentStage) &&
        Number(currentPreset.enabled ?? 1) === 1;

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

  // ✅ 多选
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

  const el = document.createElement("input");
  el.type = "text";
  el.value = value == null ? "" : String(value);
  return el;
}

/** ------- 保存逻辑：只写当前 stage 可编辑字段 ------- **/
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

    let v;

    // ✅ multi_enum：读取勾选项 -> 数组
    if ((f.type||"") === "multi_enum"){
      v = Array.from(
        root.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(key)}"]:checked`)
      ).map(x=>x.value);
    } else {
      v = root.value;
    }

    // bool：转 true/false/null
    if ((f.type||"") === "bool"){
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else v = null;
    }

    // 空字符串 -> null（避免污染 payload）
    if (typeof v === "string"){
      v = v.trim();
      if (v === "") v = null;
    }

    // required：只在当前 stage 校验（multi_enum 也校验空数组）
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
      stage: currentStage, // 不改 stage，只回写同值
    }),
  });

  currentPayload = merged;

  await previewPromptToDebug(currentStage, currentPayload);

  setStatus("ok","已保存");
}

/** ------- 调试：预览更新后的 prompt（不生成内容） ------- **/
async function previewPromptToDebug(stage, payload){
  const pre = $("debugPrompt");
  if (!pre) return;

  if (!currentPreset?.id) {
    pre.textContent = "(empty)";
    return;
  }

  const out = await httpjson(`${apiBase()}/preview`, {
    method:"POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      stage,
      payload,
      preset_id: currentPreset.id,
    }),
  });

  pre.textContent = out.prompt_text || "(empty)";
}

/** ------- helpers ------- **/
function clearPresetMeta(){
  $("presetId") && ($("presetId").value = "");
  $("presetStage") && ($("presetStage").value = "");
  $("presetEnabled") && ($("presetEnabled").value = "");
  currentPreset = null;
  currentPayload = {};
  currentStage = "S0";
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

window.addEventListener("DOMContentLoaded", ()=>{
  boot().catch(e=>setStatus("err", e.message));
});
