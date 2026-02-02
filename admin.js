/* TrackLab Admin MVP - admin.js
 * 目标：
 * - /pack 加载 schema
 * - /preview 预览 prompt
 * - /generate 生成内容并写 jobs
 * - 新增：/preset/create /preset/list（只写事实+选择）
 * - 新增：/jobs/*（只读展示）
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

/* ---------- 原有行为（保持不变） ---------- */

async function loadSchema() {
  setStatus("", "");
  $("previewOut").textContent = "(empty)";
  $("genOut").textContent = "(empty)";
  $("jobDetail").textContent = "(empty)";
  $("jobsTable").textContent = "(empty)";
  $("jobsStats").textContent = "(empty)";

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

  // ✅ 保持你现有生成方式：stage + payload
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

/* ---------- 新增：Preset（只写事实+选择，不改变 generate） ---------- */

async function presetCreateFromCurrentPayload() {
  if (!currentSchema) throw new Error("请先加载 Schema");
  const name = $("presetName").value.trim();
  if (!name) throw new Error("Preset Name 不能为空");

  const payload = collectPayload(currentSchema);
  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    stage: getStage(),
    name,
    payload,
  };

  const out = await httpJson(`${apiBase()}/preset/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  // 写入 preset_id 供 jobs 查询
  $("presetId").value = out.preset_id || "";
  setStatus("ok", `Preset 已创建：preset_id=${out.preset_id || "n/a"}`);

  await presetRefreshList(); // 创建后刷新列表
}

async function presetRefreshList() {
  const pack_id = getPackId();
  const pack_version = getPackVersion();
  const stage = getStage();

  const url =
    `${apiBase()}/preset/list?pack_id=${encodeURIComponent(pack_id)}` +
    `&pack_version=${encodeURIComponent(pack_version)}` +
    `&stage=${encodeURIComponent(stage)}` +
    `&enabled=1`;

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
    opt.textContent = `${it.name} (${it.updated_at || ""})`;
    sel.appendChild(opt);
  });

  setStatus("ok", `Preset 列表已刷新：${items.length} 条`);
}

function presetUseSelected() {
  const sel = $("presetSelect");
  const presetId = sel.value;
  if (!presetId) throw new Error("未选择 preset");

  $("presetId").value = presetId;
  setStatus("ok", `已选定 preset_id=${presetId}（仅用于 Jobs 查询）`);
}

/* ---------- 新增：Jobs（只读） ---------- */

function buildJobsStatsUrl(presetId) {
  return `${apiBase()}/jobs/stats_by_preset?preset_id=${encodeURIComponent(presetId)}`;
}

function buildJobsByPresetUrl(presetId, limit = 20) {
  return `${apiBase()}/jobs/by_preset?preset_id=${encodeURIComponent(presetId)}&limit=${encodeURIComponent(limit)}`;
}

function buildJobGetUrl(jobId) {
  // 你 worker 当前支持 id=...
  return `${apiBase()}/jobs/get?id=${encodeURIComponent(jobId)}`;
}

function renderJobsStats(stats) {
  $("jobsStats").textContent = `total=${stats.total}, generated=${stats.generated}, failed=${stats.failed}`;
}

function renderJobsTable(items) {
  const host = $("jobsTable");
  if (!items || items.length === 0) {
    host.textContent = "(empty)";
    return;
  }

  const rows = items.map((x) => {
    const id = escapeHtml(x.id);
    const created = escapeHtml(x.created_at || "");
    const status = escapeHtml(x.status || "");
    const err = escapeHtml(x.error || "");
    return `
      <tr>
        <td style="padding:6px; border-top:1px solid #e5e7eb; font-family: ui-monospace, monospace;">
          <a href="#" data-job="${id}">${id}</a>
        </td>
        <td style="padding:6px; border-top:1px solid #e5e7eb;">${created}</td>
        <td style="padding:6px; border-top:1px solid #e5e7eb;">${status}</td>
        <td style="padding:6px; border-top:1px solid #e5e7eb;">${err}</td>
      </tr>
    `;
  }).join("");

  host.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead>
        <tr>
          <th style="text-align:left; padding:6px;">job_id</th>
          <th style="text-align:left; padding:6px;">created_at</th>
          <th style="text-align:left; padding:6px;">status</th>
          <th style="text-align:left; padding:6px;">error</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  host.querySelectorAll("a[data-job]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const jobId = a.getAttribute("data-job");
      loadJobDetail(jobId).catch(showError);
    });
  });
}

async function loadJobDetail(jobId) {
  const out = await httpJson(buildJobGetUrl(jobId), { method: "GET" });
  $("jobDetail").textContent = JSON.stringify(out, null, 2);
}

async function onJobsStats() {
  const presetId = $("presetId").value.trim();
  if (!presetId) throw new Error("preset_id 为空（先创建/选择 preset）");

  const out = await httpJson(buildJobsStatsUrl(presetId), { method: "GET" });
  renderJobsStats(out);
  setStatus("ok", "Jobs 统计已刷新");
}

async function onJobsList() {
  const presetId = $("presetId").value.trim();
  if (!presetId) throw new Error("preset_id 为空（先创建/选择 preset）");

  const out = await httpJson(buildJobsByPresetUrl(presetId, 20), { method: "GET" });
  renderJobsTable(out.items || []);
  setStatus("ok", "Jobs 列表已刷新");
}

/* ---------- 事件绑定 ---------- */

$("btnLoad").addEventListener("click", () => loadSchema().catch(showError));
$("btnPreview").addEventListener("click", () => previewPrompt().catch(showError));
$("btnGenerate").addEventListener("click", () => onGenerate().catch(showError));

$("btnPresetCreate").addEventListener("click", () => presetCreateFromCurrentPayload().catch(showError));
$("btnPresetRefresh").addEventListener("click", () => presetRefreshList().catch(showError));
$("btnPresetUse").addEventListener("click", () => {
  try { presetUseSelected(); } catch (e) { showError(e); }
});

$("btnJobsStats").addEventListener("click", () => onJobsStats().catch(showError));
$("btnJobsList").addEventListener("click", () => onJobsList().catch(showError));

/* ---------- 默认值 ---------- */

$("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
$("packId").value = "xhs";
$("packVer").value = "v1.0.0";
$("stage").value = "S0";
