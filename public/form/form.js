/* /public/form/form.js */

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

/** ------- 基础配置（你现在就是固定 xhs / v1.0.0 也可以） ------- **/
function apiBase(){ return $("apiBase").value.trim(); }
function getPackId(){ return $("packId").value; }
function getPackVersion(){ return $("packVersion").value; }

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
  // API base：灰色只读
  $("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";

  // pack 下拉：最小实现（你现在只有 xhs / v1.0.0）
  // 如果你未来要动态拉 manifest 列表，再扩展即可。
  $("packId").innerHTML = `<option value="xhs">小红书</option>`;
  $("packVersion").innerHTML = `<option value="v1.0.0">v1.0.0</option>`;

  bindEvents();

  await loadPackSchema();
  await loadOwners();
  await handleOwnerChanged(); // 自动拉账号 + 自动拉 preset
  setStatus("ok","就绪");
}

function bindEvents(){
  $("packId").addEventListener("change", async ()=> {
    await loadPackSchema().catch(e=>setStatus("err", e.message));
    await handleOwnerChanged().catch(e=>setStatus("err", e.message));
  });
  $("packVersion").addEventListener("change", async ()=> {
    await loadPackSchema().catch(e=>setStatus("err", e.message));
    await handleOwnerChanged().catch(e=>setStatus("err", e.message));
  });

  $("ownerId").addEventListener("change", ()=> handleOwnerChanged().catch(e=>setStatus("err", e.message)));
  $("accountSelect").addEventListener("change", ()=> handleAccountChanged().catch(e=>setStatus("err", e.message)));

  $("onlyEnabled").addEventListener("change", ()=> presetRefreshList().catch(e=>setStatus("err", e.message)));
  $("stageFilter").addEventListener("change", ()=> presetRefreshList().catch(e=>setStatus("err", e.message)));
  $("presetSelect").addEventListener("change", ()=> presetLoadAndRender().catch(e=>setStatus("err", e.message)));

  $("btnSave").addEventListener("click", ()=> saveCurrentStage().catch(e=>setStatus("err", e.message)));
}

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
  // Owner 下拉来自 D1（/owner/list）
  const sel = $("ownerId");
  sel.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = EMPTY_TEXT;
  sel.appendChild(empty);

  const out = await httpJson(`${apiBase()}/owner/list`, { method: "GET" });
  const items = out.items || [];

  items.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  });

  // 还原上次选择（如果仍存在）
  const saved = localStorage.getItem(LS_OWNER_KEY) || "";
  if (saved && items.includes(saved)) sel.value = saved;
}

async function handleOwnerChanged(){
  currentOwnerId = $("ownerId").value || "";
  currentAccountId = "";
  currentPresetId = "";
  currentPreset = null;
  currentPayload = {};
  clearPresetInfo();
  clearForm();

  if (!currentOwnerId){
    $("accountSelect").innerHTML = `<option value="">(empty)</option>`;
    $("presetSelect").innerHTML = `<option value="">(empty)</option>`;
    return;
  }

  await refreshAccounts();
  await handleAccountChanged();
}

async function refreshAccounts(){
  setStatus("ok","加载账号…");
  const out = await httpjson(`${apiBase()}/account/list?owner_id=${encodeURIComponent(currentOwnerId)}`);
  const items = out?.items || [];
  $("accountSelect").innerHTML = items.length
    ? items.map(it=>`<option value="${escapeHtml(it.id)}">${escapeHtml(it.handle||it.id)} (${escapeHtml(it.updated_at||"")})</option>`).join("")
    : `<option value="">(empty)</option>`;

  currentAccountId = $("accountSelect").value || "";
}

async function handleAccountChanged(){
  currentAccountId = $("accountSelect").value || "";
  currentPresetId = "";
  currentPreset = null;
  currentPayload = {};
  clearPresetInfo();
  clearForm();

  await presetRefreshList();
  await presetLoadAndRender(); // 若只有一个 preset，会自动显示
}

/** ------- presets（按 account 过滤） ------- **/
async function presetRefreshList(){
  setStatus("ok","加载角色列表…");

  const enabled = $("onlyEnabled").value; // "1" or ""
  const stage = $("stageFilter").value;   // "S0"/...

  // 关键：按 account_id 过滤（你 worker 需要支持 preset/list?account_id=...）
  // 如果你已按 B 方案改过 worker，这里就能生效。
  const qs = new URLSearchParams();
  qs.set("pack_id", getPackId());
  qs.set("pack_version", getPackVersion());
  if (stage) qs.set("stage", stage);
  if (enabled !== null) qs.set("enabled", enabled); // "" 表示不过滤 enabled（看全部）
  if (currentAccountId) qs.set("account_id", currentAccountId);

  const out = await httpjson(`${apiBase()}/preset/list?${qs.toString()}`);
  const items = out?.items || [];

  $("presetSelect").innerHTML = items.length
    ? [`<option value="">请选择</option>`].concat(items.map(it=>{
        const badge = Number(it.enabled)===1 ? "" : "（已淘汰）";
        return `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name)} [${escapeHtml(it.stage)}] ${badge} (${escapeHtml(it.updated_at||"")})</option>`;
      })).join("")
    : `<option value="">(empty)</option>`;

  // 如果只有一个，自动选中
  if (items.length === 1){
    $("presetSelect").value = items[0].id;
  }
}

async function presetLoadAndRender(){
  const preset_id = $("presetSelect").value || "";
  if (!preset_id){
    clearPresetInfo();
    clearForm();
    return;
  }

  setStatus("ok","加载角色详情…");
  const out = await httpjson(`${apiBase()}/preset/get?preset_id=${encodeURIComponent(preset_id)}&pack_id=${encodeURIComponent(getPackId())}&pack_version=${encodeURIComponent(getPackVersion())}`);
  currentPreset = out?.item || null;
  if (!currentPreset) throw new Error("preset_not_found");

  currentPresetId = currentPreset.id;
  currentPayload = currentPreset.payload || {};
  currentStage = currentPreset.stage || "S0";

  // 基础信息展示
  $("presetId").value = currentPreset.id || "";
  $("presetStage").value = currentStage;
  $("presetEnabled").value = String(currentPreset.enabled);

  // 淘汰 preset：允许回看表单，但不允许保存
  const disabled = Number(currentPreset.enabled) !== 1;
  $("btnSave").disabled = disabled;
  $("saveHint").textContent = disabled ? "该角色已淘汰（enabled=0），仅可回看，不可保存。" : "仅当前 stage 字段可编辑；保存后会刷新预览 prompt。";

  // 渲染表单
  renderForm();

  // 初次也预览一次（便于确认）
  await previewPromptToDebug(currentStage, currentPayload).catch(()=>{});
  setStatus("ok","角色已加载");
}

/** ------- 表单渲染规则 ------- **/
function renderForm(){
  const c = $("formContainer");
  c.innerHTML = "";
  if (!uiSchema || !currentPreset) {
    c.innerHTML = `<div class="sub">(empty)</div>`;
    return;
  }

  const fields = uiSchema?.fields || [];
  const curRank = stageRank(currentStage);

  // 只展示 stage <= 当前 stage 的字段（按 min(editable_stages) 判断）
  const visible = fields.filter(f=>{
    const first = minStage(f.editable_stages);
    if (!first) return false;
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
      const type = f.type || "text";
      const isEditable = Array.isArray(f.editable_stages) && f.editable_stages.includes(currentStage) && Number(currentPreset.enabled)===1;

      const wrap = document.createElement("div");
      wrap.style.marginBottom = "10px";

      const lab = document.createElement("label");
      lab.textContent = label + (Array.isArray(f.required_stages) && f.required_stages.includes(currentStage) ? " *" : "");
      wrap.appendChild(lab);

      const input = buildInputForField(f, currentPayload?.[key]);
      input.id = `fld__${key}`;
      input.disabled = !isEditable;

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

  // 简化：你 pack 里目前以 textarea/text/enum/bool 为主，先覆盖这四类
  if (type === "textarea"){
    const el = document.createElement("textarea");
    el.value = value == null ? "" : String(value);
    return el;
  }

  if (type === "enum"){
    const el = document.createElement("select");
    const opts = field.options || [];
    el.innerHTML = [`<option value="">请选择</option>`].concat(opts.map(o=>`<option value="${escapeHtml(o.value)}">${escapeHtml(o.label||o.value)}</option>`)).join("");
    el.value = value == null ? "" : String(value);
    return el;
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

/** ------- 保存逻辑：只写当前 stage 可编辑字段 ------- **/
async function saveCurrentStage(){
  if (!currentPreset?.id) throw new Error("未加载 preset");
  if (Number(currentPreset.enabled) !== 1) throw new Error("该 preset 已淘汰（enabled=0），不可保存");

  setStatus("ok","保存中…");

  const fields = uiSchema?.fields || [];
  const editableFields = fields.filter(f => Array.isArray(f.editable_stages) && f.editable_stages.includes(currentStage));
  const merged = { ...(currentPayload || {}) };

  for (const f of editableFields){
    const key = f.key;
    const el = $(`fld__${key}`);
    if (!el) continue;

    let v = el.value;

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

    // required：只在当前 stage 校验
    if (Array.isArray(f.required_stages) && f.required_stages.includes(currentStage)){
      if (v == null || v === ""){
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

  // 保存后预览 prompt
  await previewPromptToDebug(currentStage, currentPayload);

  setStatus("ok","已保存");
}

async function previewPromptToDebug(stage, payload){
  const out = await httpjson(`${apiBase()}/preview`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      stage,
      payload,
    }),
  });
  $("debugPrompt").textContent = out?.prompt_text || "(empty)";
}

/** ------- 清理 ------- **/
function clearPresetInfo(){
  $("presetId").value = "";
  $("presetStage").value = "";
  $("presetEnabled").value = "";
  $("btnSave").disabled = true;
  $("saveHint").textContent = "请选择账号与角色后编辑。";
  $("debugPrompt").textContent = "(empty)";
}

function clearForm(){
  $("formContainer").innerHTML = `<div class="sub">(empty)</div>`;
}

/** ------- util ------- **/
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

boot().catch(e=>setStatus("err", e.message));

