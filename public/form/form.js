/* TrackLab Admin-Lite (Form) - Safe Version */

/* ---------- utils ---------- */
const EMPTY_TEXT = "(empty)";
const LS_OWNER_KEY = "tracklab_owner_id";
const LS_ACCOUNT_KEY = "tracklab_account_id";

function $(id) {
  return document.getElementById(id);
}

// ⭐ 安全事件绑定（核心修复）
function on(id, event, handler) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(event, handler);
}

function setStatus(type, msg) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (type === "err" ? " err" : "");
}

async function httpjson(url, opt = {}) {
  const res = await fetch(url, {
    ...opt,
    headers: {
      "content-type": "application/json",
      ...(opt.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

/* ---------- schema helpers ---------- */
function getAllFieldsFromSchema(schema) {
  if (!schema) return [];
  if (Array.isArray(schema.fields)) return schema.fields.map(f => ({ ...f }));
  if (Array.isArray(schema.groups)) {
    const out = [];
    for (const g of schema.groups) {
      const glabel = g.label || g.id || "";
      for (const f of (g.fields || [])) {
        out.push({ ...f, __group: glabel });
      }
    }
    return out;
  }
  return [];
}

function stageRank(s) {
  if (!s) return -1;
  const m = String(s).match(/^S(\d+)$/i);
  return m ? Number(m[1]) : -1;
}

function minStage(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.reduce((a, b) => stageRank(a) <= stageRank(b) ? a : b);
}

/* ---------- state ---------- */
let uiSchema = null;
let manifest = null;

let currentOwnerId = "";
let currentAccountId = "";
let currentPreset = null;
let currentPayload = {};
let currentStage = "S0";

/* ---------- api base ---------- */
function apiBase() {
  const v = $("apiBase")?.value || "";
  return v.replace(/\/+$/, "");
}
function getPackId() { return $("packId")?.value || ""; }
function getPackVersion() { return $("packVersion")?.value || ""; }

/* ---------- init ---------- */
window.addEventListener("DOMContentLoaded", () => {

  // 只在元素存在时绑定（Admin-Lite 安全）
  on("btnLoad", "click", () => boot().catch(e => setStatus("err", e.message)));
  on("packId", "change", () => boot().catch(e => setStatus("err", e.message)));
  on("packVersion", "change", () => boot().catch(e => setStatus("err", e.message)));

  on("ownerSelect", "change", () => {
    localStorage.setItem(LS_OWNER_KEY, $("ownerSelect").value);
    boot().catch(e => setStatus("err", e.message));
  });

  on("accountSelect", "change", () => {
    localStorage.setItem(LS_ACCOUNT_KEY, $("accountSelect").value);
    presetRefreshList().catch(e => setStatus("err", e.message));
  });

  on("presetSelect", "change", () =>
    presetLoadAndRender().catch(e => setStatus("err", e.message))
  );

  on("btnSave", "click", () =>
    saveCurrentStage().catch(e => setStatus("err", e.message))
  );

  // ⭐ Admin-Lite：允许无按钮自动启动
  boot().catch(e => setStatus("err", e.message));
});

/* ---------- load pack ---------- */
async function loadPackSchema() {
  setStatus("ok", "加载 Schema…");
  const out = await httpjson(`${apiBase()}/pack/${getPackId()}/${getPackVersion()}`);
  manifest = out.manifest;
  uiSchema = out.ui_schema;
  $("schemaHint") && ($("schemaHint").textContent =
    `Schema 已加载：${getPackId()} / ${getPackVersion()}`);
}

/* ---------- owners / accounts / presets ---------- */
async function presetRefreshList() {
  if (!currentOwnerId || !currentAccountId) return;
  const out = await httpjson(
    `${apiBase()}/preset/list?owner_id=${currentOwnerId}&account_id=${currentAccountId}&pack_id=${getPackId()}&pack_version=${getPackVersion()}`
  );
  const sel = $("presetSelect");
  if (!sel) return;
  sel.innerHTML = (out.items || []).map(p =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)} [${p.stage}]</option>`
  ).join("");
  if (sel.value) await presetLoadAndRender();
}

async function presetLoadAndRender() {
  const id = $("presetSelect")?.value;
  if (!id) return;
  const out = await httpjson(`${apiBase()}/preset/get/${id}`);
  currentPreset = out.preset;
  currentPayload = currentPreset.payload || {};
  currentStage = currentPreset.stage || "S0";

  $("presetId") && ($("presetId").value = currentPreset.id);
  $("presetStage") && ($("presetStage").value = currentStage);
  $("presetEnabled") && ($("presetEnabled").value = currentPreset.enabled);

  renderForm();
}

/* ---------- form rendering ---------- */
function renderForm() {
  const c = $("formContainer");
  if (!c || !uiSchema || !currentPreset) {
    if (c) c.innerHTML = `<div class="sub">${EMPTY_TEXT}</div>`;
    return;
  }

  c.innerHTML = "";
  const fields = getAllFieldsFromSchema(uiSchema);
  const curRank = stageRank(currentStage);

  const visible = fields.filter(f => {
    const first = minStage(f.editable_stages) || "S0";
    return stageRank(first) <= curRank;
  });

  if (visible.length === 0) {
    c.innerHTML = `<div class="sub">${EMPTY_TEXT}</div>`;
    return;
  }

  for (const f of visible) {
    const wrap = document.createElement("div");
    wrap.className = "field";

    const lab = document.createElement("label");
    lab.textContent = f.label || f.key;
    wrap.appendChild(lab);

    const input = buildInput(f, currentPayload[f.key]);
    input.id = `fld__${f.key}`;

    const editable = Array.isArray(f.editable_stages) && f.editable_stages.includes(currentStage);
    input.querySelectorAll?.("input,select,textarea").forEach(el => el.disabled = !editable);

    wrap.appendChild(input);
    c.appendChild(wrap);
  }
}

function buildInput(field, value) {
  if (field.type === "multi_enum") {
    const box = document.createElement("div");
    const set = new Set(Array.isArray(value) ? value : []);
    for (const opt of field.options || []) {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = field.key;
      cb.value = opt.value;
      cb.checked = set.has(opt.value);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(opt.label || opt.value));
      box.appendChild(lab);
    }
    return box;
  }

  if (field.type === "enum") {
    const sel = document.createElement("select");
    sel.innerHTML = `<option value=""></option>` +
      (field.options || []).map(o =>
        `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label || o.value)}</option>`
      ).join("");
    sel.value = value ?? "";
    return sel;
  }

  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = value ?? "";
  return inp;
}

/* ---------- save ---------- */
async function saveCurrentStage() {
  if (!currentPreset) return;
  const fields = getAllFieldsFromSchema(uiSchema)
    .filter(f => f.editable_stages?.includes(currentStage));

  const payload = { ...currentPayload };
  for (const f of fields) {
    const root = $(`fld__${f.key}`);
    if (!root) continue;

    if (f.type === "multi_enum") {
      payload[f.key] = Array.from(
        root.querySelectorAll(`input[name="${f.key}"]:checked`)
      ).map(x => x.value);
    } else {
      payload[f.key] = root.value || null;
    }
  }

  await httpjson(`${apiBase()}/preset/update/${currentPreset.id}`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      stage: currentStage,
      payload
    })
  });

  currentPayload = payload;
  setStatus("ok", "已保存");
}

/* ---------- boot ---------- */
async function boot() {
  await loadPackSchema();
  await presetRefreshList();
}
