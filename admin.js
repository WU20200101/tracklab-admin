/* TrackLab Admin MVP
 * - Admin 只渲染 schema、收集 payload、调用 /pack 与 /preview、展示结果
 * - 不拼 prompt、不做判断、不补字段
 */

const $ = (id) => document.getElementById(id);

let currentSchema = null;

function setStatus(type, msg) {
  const el = $("status");
  if (!msg) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="${type}">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function apiBase() {
  const v = $("apiBase").value.trim();
  if (!v) throw new Error("API Base 不能为空");
  return v.replace(/\/+$/, "");
}

function packId() { return $("packId").value.trim(); }
function packVer() { return $("packVer").value.trim(); }
function stage() { return $("stage").value; }

// Path 参数形式：/pack/:pack_id/:pack_version
function buildPackUrl() {
  return `${apiBase()}/pack/${encodeURIComponent(packId())}/${encodeURIComponent(packVer())}`;
}

// Path 参数形式：/preview/:pack_id/:pack_version
// stage 通过 body 传，或你的 worker 内部默认 S0；这里显式传 stage，便于后续扩展
function buildPreviewUrl() {
  return `${apiBase()}/preview/${encodeURIComponent(packId())}/${encodeURIComponent(packVer())}`;
}

async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = data?.error || text || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data;
}

function renderSchema(schema) {
  const host = $("formHost");
  host.innerHTML = "";

  if (!schema || !Array.isArray(schema.groups)) {
    host.innerHTML = `<div class="error">schema 格式不符合预期</div>`;
    return;
  }

  schema.groups.forEach((g, gi) => {
    const group = document.createElement("div");
    group.className = gi === 0 ? "" : "group";
    group.innerHTML = `<h4 style="margin:0 0 10px 0;">${escapeHtml(g.label || g.id || "group")}</h4>`;

    (g.fields || []).forEach((f) => {
      const field = document.createElement("div");
      field.className = "field";
      field.dataset.key = f.key;

      const label = document.createElement("label");
      label.textContent = `${f.label || f.key}${f.required ? " *" : ""}`;
      field.appendChild(label);

      // enum
      if (f.type === "enum") {
        const sel = document.createElement("select");
        sel.name = f.key;
        sel.dataset.type = "enum";
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "请选择";
        sel.appendChild(emptyOpt);
        (f.options || []).forEach((opt) => {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label || opt.value;
          sel.appendChild(o);
        });
        field.appendChild(sel);
      }

      // multi_enum
      else if (f.type === "multi_enum") {
        const box = document.createElement("div");
        box.className = "checks";
        box.dataset.type = "multi_enum";
        box.dataset.key = f.key;
        (f.options || []).forEach((opt) => {
          const wrap = document.createElement("label");
          wrap.className = "check";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = opt.value;
          cb.name = f.key;
          const span = document.createElement("span");
          span.textContent = opt.label || opt.value;
          wrap.appendChild(cb);
          wrap.appendChild(span);
          box.appendChild(wrap);
        });
        field.appendChild(box);
      }

      else {
        const inp = document.createElement("input");
        inp.name = f.key;
        inp.placeholder = "未支持的字段类型";
        inp.disabled = true;
        field.appendChild(inp);
      }

      const hint = document.createElement("div");
      hint.className = "muted";
      hint.textContent = f.hint || "";
      field.appendChild(hint);

      group.appendChild(field);
    });

    host.appendChild(group);
  });
}

function collectPayload(schema) {
  // Admin 不补字段：只收集用户明确选择/勾选的字段
  const payload = {};
  const missing = [];

  schema.groups.forEach((g) => {
    (g.fields || []).forEach((f) => {
      if (f.type === "enum") {
        const sel = document.querySelector(`select[name="${CSS.escape(f.key)}"]`);
        const v = sel ? sel.value : "";
        if (f.required && !v) missing.push(f.key);
        if (v) payload[f.key] = v;
      } else if (f.type === "multi_enum") {
        const checked = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(f.key)}"]:checked`))
          .map((x) => x.value);
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

async function onLoadSchema() {
  setStatus("", "");
  $("previewOut").textContent = "(empty)";

  const url = buildPackUrl();
  setStatus("muted", `加载：${url}`);

  const data = await httpJson(url, { method: "GET" });

  // 兼容两种返回：
  // A) { schema: {...} }
  // B) 直接就是 schema
  const schema = data?.schema || data?.ui_schema || data;

  currentSchema = schema;
  renderSchema(schema);

  setStatus("ok", "Schema 已加载");
}

async function onPreview() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  setStatus("", "");
  const payload = collectPayload(currentSchema);

  const url = buildPreviewUrl();

  // body 同时传 stage + payload（worker 可忽略 stage；但你后续会用到）
  const body = { stage: stage(), payload };

  const out = await httpJson(url, {
    method: "POST",
    body: JSON.stringify(body)
  });

  $("previewOut").textContent = JSON.stringify(out, null, 2);

  if (out?.blocked) {
    setStatus("error", `被 Gate 拦截：${(out.reasons || []).join("; ")}`);
  } else {
    setStatus("ok", "Preview 成功返回");
  }
}

$("btnLoad").addEventListener("click", () => onLoadSchema().catch(e => setStatus("error", e.message)));
$("btnPreview").addEventListener("click", () => onPreview().catch(e => setStatus("error", e.message)));

// 预填你现在的 worker 域名（方便首次打开就能用）
$("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
