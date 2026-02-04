/* TrackLab Admin-Lite (Form)
 * 只用于：加载 schema -> 选择 preset -> 回填 -> 仅渲染当前 stage 可填字段 -> preset/update
 * 约束：不 preview，不 generate，不 feedback，不 jobs，不 outcomes
 */

const $ = (id) => document.getElementById(id);

let currentSchema = null;
let currentPreset = null; // { id, stage, enabled, name, payload, ... }

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(type, msg) {
  const el = $("status");
  if (!msg) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="${type}">${escapeHtml(msg)}</div>`;
}

function setDebug(obj) {
  $("debugOut").textContent = (obj == null) ? "(empty)" : JSON.stringify(obj, null, 2);
}

async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data || {};
}

function apiBase() {
  const v = $("apiBase").value.trim().replace(/\/+$/, "");
  if (!v) throw new Error("API Base 不能为空");
  return v;
}
function getPackId() {
  const v = $("packId").value.trim();
  if (!v) throw new Error("Pack ID 不能为空");
  return v;
}
function getPackVersion() {
  const v = $("packVer").value.trim();
  if (!v) throw new Error("Pack Version 不能为空");
  return v;
}

function stageOfCurrentPreset() {
  return currentPreset?.stage || "S0";
}

function isFieldEditableInStage(field, stage) {
  const editableStages = Array.isArray(field.editable_stages) ? field.editable_stages : null;
  return !editableStages || editableStages.includes(stage);
}

/** 仅渲染“当前 stage 可填字段”。 */
function renderSchemaLite(schema, stage) {
  const host = $("formHost");
  host.innerHTML = "";

  if (!schema || !Array.isArray(schema.groups)) {
    host.innerHTML = `<div class="error">schema 格式错误：缺少 groups</div>`;
    return;
  }

  schema.groups.forEach((g) => {
    const fields = (g.fields || []).filter((f) => isFieldEditableInStage(f, stage));
    if (!fields.length) return;

    const group = document.createElement("div");
    group.className = "group";
    group.innerHTML = `<h4>${escapeHtml(g.label || g.id || "group")}</h4>`;

    fields.forEach((f) => {
      const field = document.createElement("div");
      field.className = "field";

      const label = document.createElement("label");
      label.textContent = `${f.label || f.key}${f.required ? " *" : ""}`;
      field.appendChild(label);

      if (f.type === "enum") {
        const sel = document.createElement("select");
        sel.name = f.key;

        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "请选择";
        sel.appendChild(empty);

        (f.options || []).forEach((opt) => {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label || opt.value;
          sel.appendChild(o);
        });

        field.appendChild(sel);
      } else if (f.type === "multi_enum") {
        const box = document.createElement("div");
        box.className = "checks";

        (f.options || []).forEach((opt) => {
          const wrap = document.createElement("label");
          wrap.className = "check";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.name = f.key;
          cb.value = opt.value;

          const span = document.createElement("span");
          span.textContent = opt.label || opt.value;

          wrap.appendChild(cb);
          wrap.appendChild(span);
          box.appendChild(wrap);
        });

        field.appendChild(box);
      } else {
        const hint = document.createElement("div");
        hint.className = "muted";
        hint.textContent = `未支持字段类型：${f.type}（key=${f.key}）`;
        field.appendChild(hint);
      }

      if (f.hint) {
        const hint = document.createElement("div");
        hint.className = "muted";
        hint.textContent = f.hint;
        field.appendChild(hint);
      }

      group.appendChild(field);
    });

    host.appendChild(group);
  });
}

function applyPayloadToForm(schema, stage, payload) {
  const p = payload || {};
  schema.groups.forEach((g) => {
    (g.fields || []).forEach((f) => {
      if (!isFieldEditableInStage(f, stage)) return;

      const key = f.key;

      if (f.type === "enum") {
        const sel = document.querySelector(`select[name="${CSS.escape(key)}"]`);
        if (!sel) return;
        sel.value = (key in p) ? String(p[key] ?? "") : "";
      }

      if (f.type === "multi_enum") {
        const cbs = document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(key)}"]`);
        const want = new Set(Array.isArray(p[key]) ? p[key].map(String) : []);
        cbs.forEach((cb) => (cb.checked = want.has(String(cb.value))));
      }
    });
  });
}

/** 只收集“当前 stage 可填字段”；不可填字段完全不动（不会写回覆盖）。 */
function collectPayloadFromForm(schema, stage, basePayload) {
  const payload = { ...(basePayload || {}) };
  const missing = [];

  schema.groups.forEach((g) => {
    (g.fields || []).forEach((f) => {
      if (!isFieldEditableInStage(f, stage)) return;

      const reqStages = Array.isArray(f.required_stages) ? f.required_stages : null;
      const isRequiredNow = !!f.required && (!reqStages || reqStages.includes(stage));

      if (f.type === "enum") {
        const sel = document.querySelector(`select[name="${CSS.escape(f.key)}"]`);
        const v = sel ? sel.value : "";
        if (isRequiredNow && !v) missing.push(f.key);

        // 写入规则：空值不写（保持原值）；有值覆盖
        if (v) payload[f.key] = v;
      }

      if (f.type === "multi_enum") {
        const checked = Array.from(
          document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(f.key)}"]:checked`)
        ).map((x) => x.value);

        if (isRequiredNow && checked.length === 0) missing.push(f.key);

        if (checked.length) payload[f.key] = checked;
      }
    });
  });

  if (missing.length) throw new Error(`必填字段未填写：${missing.join(", ")}`);
  return payload;
}

async function loadSchema() {
  setStatus("info", "加载 schema 中…");
  const url = `${apiBase()}/pack/${getPackId()}/${getPackVersion()}`;
  const data = await httpJson(url, { method: "GET" });

  const schema = data.ui_schema || data.schema || data;
  currentSchema = schema;

  // 未加载 preset 前，用 S0 渲染一个空壳（等加载 preset 后再重渲染）
  renderSchemaLite(currentSchema, "S0");

  setStatus("ok", "Schema 已加载");
  setDebug({ ok: true, pack: { id: getPackId(), version: getPackVersion() }, has_groups: Array.isArray(schema?.groups) });
}

async function refreshPresetList() {
  const pack_id = getPackId();
  const pack_version = getPackVersion();
  const stage = $("stageFilter").value;
  const enabled = $("enabledOnly").value;

  let url =
    `${apiBase()}/preset/list?pack_id=${encodeURIComponent(pack_id)}` +
    `&pack_version=${encodeURIComponent(pack_version)}`;

  if (stage) url += `&stage=${encodeURIComponent(stage)}`;
  if (enabled !== "") url += `&enabled=${encodeURIComponent(enabled)}`;

  setStatus("info", "刷新 preset 列表中…");
  const out = await httpJson(url, { method: "GET" });
  const items = out.items || [];

  const sel = $("presetSelect");
  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = items.length ? "请选择" : "(empty)";
  sel.appendChild(empty);

  items.forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = `${it.name} [${it.stage}] (${it.updated_at || ""})`;
    sel.appendChild(opt);
  });

  setStatus("ok", `Preset 列表已刷新：${items.length} 条`);
  setDebug({ ok: true, items_count: items.length, first: items[0] || null });
}

async function loadPresetToForm() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  const preset_id = $("presetSelect").value;
  if (!preset_id) throw new Error("未选择 preset");

  setStatus("info", "加载 preset 中…");
  const url =
    `${apiBase()}/preset/get?preset_id=${encodeURIComponent(preset_id)}` +
    `&pack_id=${encodeURIComponent(getPackId())}` +
    `&pack_version=${encodeURIComponent(getPackVersion())}`;

  const out = await httpJson(url, { method: "GET" });
  const item = out.item;
  if (!item) throw new Error("preset_get 返回为空");

  currentPreset = item;
  $("presetId").value = item.id || preset_id;
  $("stageView").value = item.stage || "S0";

  // 按 preset.stage 重新渲染“可填字段”
  const st = stageOfCurrentPreset();
  renderSchemaLite(currentSchema, st);
  applyPayloadToForm(currentSchema, st, item.payload || {});

  setStatus("ok", `已加载 preset：${item.name || item.id}`);
  setDebug({ ok: true, preset: item });
}

async function savePresetFromForm() {
  if (!currentSchema) throw new Error("请先加载 Schema");
  if (!currentPreset?.id) throw new Error("请先加载一个 preset");

  const st = stageOfCurrentPreset();

  // 只覆盖当前 stage 可填字段；其他字段保留原 payload
  const mergedPayload = collectPayloadFromForm(currentSchema, st, currentPreset.payload || {});

  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    stage: st,            // 同步写回“事实 stage”（不推进，只对齐）
    payload: mergedPayload,
  };

  setStatus("info", "保存中…");
  const out = await httpJson(`${apiBase()}/preset/update/${encodeURIComponent(currentPreset.id)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!out.ok) throw new Error("preset_update 未返回 ok");

  // 刷新本地缓存（避免用户下一次保存基于旧 payload）
  currentPreset.payload = mergedPayload;

  setStatus("ok", "保存成功（preset 已更新）");
  setDebug({ ok: true, updated: out, saved_payload_keys: Object.keys(mergedPayload) });
}

function showError(e) {
  console.error(e);
  setStatus("error", e?.message || String(e));
}

function setDefaults() {
  $("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
  $("packId").value = "xhs";
  $("packVer").value = "v1.0.0";
  $("enabledOnly").value = "1";
}

function bindEvents() {
  $("btnLoad").addEventListener("click", () => loadSchema().catch(showError));
  $("btnRefreshPresets").addEventListener("click", () => refreshPresetList().catch(showError));
  $("btnLoadPreset").addEventListener("click", () => loadPresetToForm().catch(showError));
  $("btnSavePreset").addEventListener("click", () => savePresetFromForm().catch(showError));
}

setDefaults();
bindEvents();
