/* TrackLab Admin MVP (admin.js)
 * - 全线上：只负责渲染 schema、收集表单、调用 Worker API、展示返回
 * - 不拼 prompt、不做策略判断、不补字段/猜默认值
 * - 适配：path 参数形式（/pack/:pack/:ver, /preview/:pack/:ver）
 * - 适配：forbidden 为 multi_enum
 * - 适配：/preview 支持两种 body：平铺字段 或 {stage,payload}
 */

const $ = (id) => document.getElementById(id);

let currentSchema = null;

// === 配置：只改这里也行 ===
const CFG = {
  // true: POST body = { stage, payload }
  // false: POST body = payload(平铺字段)
  previewBodyMode: "envelope" // "envelope" | "flat"
  // 你的截图里 /preview body 是平铺字段；如果你 Worker 也支持 envelope，建议用 envelope
};
// =================================

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

function normalizeBase(raw) {
  const v = (raw || "").trim().replace(/\/+$/, "");
  if (!v) throw new Error("API Base 不能为空");

  // 强约束：必须是 https 且看起来是完整域名
  if (!v.startsWith("https://")) {
    throw new Error("API Base 必须以 https:// 开头");
  }

  // 你之前踩坑：少了 .workers.dev
  // 这里做强校验：如果包含 tracklab-api 但不包含 workers.dev → 直接报错
  if (v.includes("tracklab-api") && !v.includes("workers.dev")) {
    throw new Error("API Base 不完整：看起来缺少 .workers.dev（请使用 https://tracklab-api.xxx.workers.dev）");
  }

  // 兜底：至少应包含一个点号域名结构
  const host = v.replace("https://", "");
  if (!host.includes(".")) {
    throw new Error("API Base 看起来不是完整域名（缺少 .xx 后缀）");
  }

  return v;
}

function apiBase() {
  return normalizeBase($("apiBase").value);
}

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

function stage() {
  return $("stage").value;
}

// === 路由（path 参数形式）===
function packUrl() {
  return `${apiBase()}/pack/${encodeURIComponent(packId())}/${encodeURIComponent(packVer())}`;
}

function previewUrl() {
  return `${apiBase()}/preview/${encodeURIComponent(packId())}/${encodeURIComponent(packVer())}`;
}

// === HTTP helper ===
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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON：把原文当错误
  }

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  // 有些 worker 会返回纯文本/空；这里保持兼容
  return data ?? { raw: text };
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
      field.dataset.key = f.key;

      const label = document.createElement("label");
      label.textContent = `${f.label || f.key}${f.required ? " *" : ""}`;
      field.appendChild(label);

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
      } else if (f.type === "multi_enum") {
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
      } else {
        const inp = document.createElement("input");
        inp.name = f.key;
        inp.placeholder = `未支持的字段类型：${f.type}`;
        inp.disabled = true;
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

async function loadSchema() {
  setStatus("", "");
  $("previewOut").textContent = "(empty)";

  const url = packUrl();
  setStatus("muted", `GET ${url}`);

  const data = await httpJson(url, { method: "GET" });

  // 兼容不同返回结构：
  // - { schema: {...} }
  // - 直接是 schema
  // - { ui_schema: {...} }
  const schema = data?.schema || data?.ui_schema || data;

  currentSchema = schema;
  renderSchema(schema);

  setStatus("ok", "Schema 已加载");
}

async function previewPrompt() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  setStatus("", "");
  const payload = collectPayload(currentSchema);

  const url = previewUrl();

  let bodyObj;
  if (CFG.previewBodyMode === "flat") {
    bodyObj = payload;
  } else {
    bodyObj = { stage: stage(), payload };
  }

  setStatus("muted", `POST ${url}`);

  const out = await httpJson(url, {
    method: "POST",
    body: JSON.stringify(bodyObj)
  });

  $("previewOut").textContent = JSON.stringify(out, null, 2);

  if (out?.blocked) {
    setStatus("error", `被 Gate 拦截：${(out.reasons || []).join("; ")}`);
  } else if (out?.prompt_text) {
    setStatus("ok", "Preview 成功返回 prompt_text");
  } else {
    // 仍然返回了 JSON，但没有 prompt_text
    setStatus("muted", "Preview 返回成功，但未发现 prompt_text（检查 Worker 返回结构）");
  }
}

// === 绑定按钮 ===
$("btnLoad").addEventListener("click", () => loadSchema().catch((e) => setStatus("error", e.message)));
$("btnPreview").addEventListener("click", () => previewPrompt().catch((e) => setStatus("error", e.message)));

// === 默认值（防止你再次把 workers.dev 填丢）===
$("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
$("packId").value = "xhs";
$("packVer").value = "v1.0.0";
$("stage").value = "S0";
