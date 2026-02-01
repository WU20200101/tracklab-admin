/* TrackLab Admin MVP - admin.js (fix: preview body contract)
 * 目标：让 /preview 一定发送 { pack_id, pack_version, payload }
 * 约束：不拼 prompt、不写策略、不补字段（只收集用户选择）
 */

const $ = (id) => document.getElementById(id);
let currentSchema = null;

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

function normalizeBase(raw) {
  const v = (raw || "").trim().replace(/\/+$/, "");
  if (!v) throw new Error("API Base 不能为空");
  if (!v.startsWith("https://")) throw new Error("API Base 必须以 https:// 开头");
  return v;
}

function apiBase() { return normalizeBase($("apiBase").value); }
function packId() {
  const v = $("packId").value.trim();
  if (!v) throw new Error("Pack ID 不能为空");
  return v;
}
function packVer() {
  const v = $("packVer").value.trim();
  if (!v) throw new Error("Pack Version 不能为空");
  return v;
}

function packUrl() {
  // 你已验证：/pack/xhs/v1.0.0 可以返回 JSON
  return `${apiBase()}/pack/${encodeURIComponent(packId())}/${encodeURIComponent(packVer())}`;
}

function previewUrl() {
  // 关键：你的 worker /preview 需要 body 里带 pack_id/pack_version，所以 endpoint 用 /preview 即可
  return `${apiBase()}/preview`;
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
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = data?.error || data?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data ?? {};
}

function renderSchema(schema) {
  const host = $("formHost");
  host.innerHTML = "";

  if (!schema || !Array.isArray(schema.groups)) {
    host.innerHTML = `<div class="error">schema 格式不符合预期：缺少 groups</div>`;
    return;
  }

  schema.groups.forEach((g, gi) => {
    const group = document.createElement("div");
    group.className = gi === 0 ? "" : "group";
    group.innerHTML = `<h4 style="margin:0 0 10px 0;">${escapeHtml(g.label || g.id || "group")}</h4>`;

    (g.fields || []).forEach((f) => {
      const field = document.createElement("div");
      field.className = "field";

      const label = document.createElement("label");
      label.textContent = `${f.label || f.key}${f.required ? " *" : ""}`;
      field.appendChild(label);

      if (f.type === "enum") {
        const sel = document.createElement("select");
        sel.name = f.key;

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
      } else if (f.type === "multi_enum") {
        const box = document.createElement("div");
        box.className = "checks";

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
      } else {
        const inp = document.createElement("input");
        inp.disabled = true;
        inp.placeholder = `未支持字段类型：${f.type}`;
        field.appendChild(inp);
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
        const v = sel ? sel.value : "";
        if (f.required && !v) missing.push(f.key);
        if (v) payload[f.key] = v;
      } else if (f.type === "multi_enum") {
        const checked = Array.from(
          document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(f.key)}"]:checked`)
        ).map(x => x.value);

        if (f.required && checked.length === 0) missing.push(f.key);
        if (checked.length) payload[f.key] = checked;
      }
    });
  });

  if (missing.length) throw new Error(`必填字段未填写：${missing.join(", ")}`);
  return payload;
}

async function loadSchema() {
  setStatus("", "");
  $("previewOut").textContent = "(empty)";

  const url = packUrl();
  setStatus("muted", `GET ${url}`);

  const data = await httpJson(url, { method: "GET" });

  // 兼容：{schema:{...}} 或直接 schema
  const schema = data?.schema || data?.ui_schema || data;

  currentSchema = schema;
  renderSchema(schema);

  setStatus("ok", "Schema 已加载");
}

async function previewPrompt() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  setStatus("", "");
  const payload = collectPayload(currentSchema);

  // 关键：严格按 worker 要求发送这三个字段
  const bodyObj = {
    pack_id: packId(),
    pack_version: packVer(),
    payload
  };

  const url = previewUrl();
  setStatus("muted", `POST ${url}`);

  const out = await httpJson(url, {
    method: "POST",
    body: JSON.stringify(bodyObj)
  });

  $("previewOut").textContent = JSON.stringify(out, null, 2);

  if (out?.blocked) setStatus("error", `被 Gate 拦截：${(out.reasons || []).join("; ")}`);
  else if (out?.prompt_text) setStatus("ok", "Preview 成功返回 prompt_text");
  else setStatus("muted", "Preview 返回成功，但未发现 prompt_text（检查 worker 返回结构）");
}

$("btnLoad").addEventListener("click", () => loadSchema().catch(e => setStatus("error", e.message)));
$("btnPreview").addEventListener("click", () => previewPrompt().catch(e => setStatus("error", e.message)));

// 默认值（你说显示不全是 UI 现象，不影响实际值；但这里仍然写全）
$("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
$("packId").value = "xhs";
$("packVer").value = "v1.0.0";
$("stage").value = "S0";
