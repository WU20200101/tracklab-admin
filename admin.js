/* TrackLab Admin MVP - admin.js
 * 目标：
 * - /pack 加载 schema
 * - /preview 预览 prompt
 * - /generate 生成内容并写 jobs
 * 约束：
 * - 不拼 prompt
 * - 不写策略
 * - 不补字段
 */

const $ = (id) => document.getElementById(id);
let currentSchema = null;

/* ---------- 通用工具 ---------- */

function showError(e) {
  console.error(e);
  setStatus("error", e?.message || String(e));
}

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
  if (!msg) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<div class="${type}">${escapeHtml(msg)}</div>`;
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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    const msg = data?.error || data?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data ?? {};
}

/* ---------- 基础取值（关键：统一入口） ---------- */

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

function getStage() {
  return $("stage").value;
}

/* ---------- Schema 渲染 ---------- */

function renderSchema(schema) {
  const host = $("formHost");
  host.innerHTML = "";

  if (!schema || !Array.isArray(schema.groups)) {
    host.innerHTML = `<div class="error">schema 格式错误：缺少 groups</div>`;
    return;
  }

  schema.groups.forEach((g) => {
    const group = document.createElement("div");
    group.className = "group";
    group.innerHTML = `<h4>${escapeHtml(g.label || g.id || "group")}</h4>`;

    (g.fields || []).forEach((f) => {
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

function collectPayload(schema) {
  const payload = {};
  const missing = [];

  schema.groups.forEach((g) => {
    (g.fields || []).forEach((f) => {
      if (f.type === "enum") {
        const sel = document.querySelector(`select[name="${CSS.escape(f.key)}"]`);
        const v = sel?.value;
        if (f.required && !v) missing.push(f.key);
        if (v) payload[f.key] = v;
      }

      if (f.type === "multi_enum") {
        const checked = Array.from(
          document.querySelectorAll(
            `input[type="checkbox"][name="${CSS.escape(f.key)}"]:checked`
          )
        ).map((x) => x.value);

        if (f.required && checked.length === 0) missing.push(f.key);
        if (checked.length) payload[f.key] = checked;
      }
    });
  });

  if (missing.length) {
    throw new Error(`必填字段未填写：${missing.join(", ")}`);
  }

  return payload;
}

/* ---------- 行为 ---------- */

async function loadSchema() {
  setStatus("", "");
  $("previewOut").textContent = "(empty)";
  $("genOut").textContent = "(empty)";

  const url = `${apiBase()}/pack/${getPackId()}/${getPackVersion()}`;
  setStatus("muted", `GET ${url}`);

  const data = await httpJson(url);
  const schema = data.ui_schema || data.schema || data;

  currentSchema = schema;
  renderSchema(schema);

  setStatus("ok", "Schema 已加载");
}

async function previewPrompt() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  setStatus("", "");
  const payload = collectPayload(currentSchema);

  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    payload,
  };

  const out = await httpJson(`${apiBase()}/preview`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  $("previewOut").textContent = JSON.stringify(out, null, 2);

  if (out.blocked) {
    setStatus("error", `被 Gate 拦截：${(out.reasons || []).join("; ")}`);
  } else {
    setStatus("ok", "Preview 成功");
  }
}

async function onGenerate() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    stage: getStage(),
    payload: collectPayload(currentSchema),
  };

  const out = await httpJson(`${apiBase()}/generate`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  $("genOut").textContent = JSON.stringify(out, null, 2);
  setStatus("ok", `Generate 完成，job_id=${out.job_id || "n/a"}`);
}

/* ---------- 事件绑定 ---------- */

$("btnLoad").addEventListener("click", () => loadSchema().catch(showError));
$("btnPreview").addEventListener("click", () => previewPrompt().catch(showError));
$("btnGenerate").addEventListener("click", () => onGenerate().catch(showError));

/* ---------- 默认值 ---------- */

$("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
$("packId").value = "xhs";
$("packVer").value = "v1.0.0";
$("stage").value = "S0";
