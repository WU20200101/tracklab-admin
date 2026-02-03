/* TrackLab Admin - admin.js (cover)
 * 目标：
 * - pack 加载 schema
 * - preview 预览 prompt
 * - generate 生成内容并写 jobs
 * - preset：create/list/use + 新增 get(回填) + update(覆盖更新)
 * - jobs：只读展示
 * 约束：
 * - 不拼 prompt
 * - 不写策略
 * - 不补字段/不猜默认值
 */

const $ = (id) => document.getElementById(id);
let currentSchema = null;

// ---------- 通用工具 ----------
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
    const msg = (data && (data.error || data.message)) || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data || {};
}

// ---------- 基础取值（统一入口） ----------
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
function setStage(stage) {
  if (!stage) return;
  const sel = $("stage");
  const exists = Array.from(sel.options).some((o) => o.value === stage);
  if (exists) sel.value = stage;
}

// ---------- Schema 渲染 ----------
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

  applyStageLock(schema, getStage());

}

function collectPayload(schema) {
  const payload = {};
  const missing = [];
  const stage = getStage(); // ✅ 缓存一次

  schema.groups.forEach((g) => {
    (g.fields || []).forEach((f) => {
      if (f.type === "enum") {
        const sel = document.querySelector(`select[name="${CSS.escape(f.key)}"]`);
        const v = sel ? sel.value : "";

        const reqStages = Array.isArray(f.required_stages) ? f.required_stages : null;
        const isRequiredNow = !!f.required && (!reqStages || reqStages.includes(stage));
        if (isRequiredNow && !v) missing.push(f.key);

        if (v) payload[f.key] = v;
      }

      if (f.type === "multi_enum") {
        const checked = Array.from(
          document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(f.key)}"]:checked`)
        ).map((x) => x.value);

        const reqStages = Array.isArray(f.required_stages) ? f.required_stages : null;
        const isRequiredNow = !!f.required && (!reqStages || reqStages.includes(stage));
        if (isRequiredNow && checked.length === 0) missing.push(f.key);

        if (checked.length) payload[f.key] = checked;
      }
    });
  });

  if (missing.length) throw new Error(`必填字段未填写：${missing.join(", ")}`);
  return payload;
}


// ---------- 新增：按 stage 锁定字段（只禁用，不改值，不写策略） ----------
function applyStageLock(schema, stage) {
  if (!schema || !schema.groups) return;

  schema.groups.forEach((group) => {
    (group.fields || []).forEach((field) => {
      const editableStages = Array.isArray(field.editable_stages)
        ? field.editable_stages
        : null;

      // 没写 editable_stages = 默认可编辑（兼容旧 schema）
      const editable = !editableStages || editableStages.includes(stage);

      if (field.type === "enum") {
        const sel = document.querySelector(
          `select[name="${CSS.escape(field.key)}"]`
        );
        if (sel) sel.disabled = !editable;
      }

      if (field.type === "multi_enum") {
        const boxes = document.querySelectorAll(
          `input[type="checkbox"][name="${CSS.escape(field.key)}"]`
        );
        boxes.forEach((cb) => (cb.disabled = !editable));
      }
    });
  });
}

function applyPayloadToForm(schema, payload) {
  if (!schema) return;
  const p = payload || {};

  schema.groups.forEach((g) => {
    (g.fields || []).forEach((f) => {
      const key = f.key;
      if (!(key in p)) {
        // 不在 payload 里：清空 UI（避免脏状态）
        if (f.type === "enum") {
          const sel = document.querySelector(`select[name="${CSS.escape(key)}"]`);
          if (sel) sel.value = "";
        } else if (f.type === "multi_enum") {
          const cbs = document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(key)}"]`);
          cbs.forEach((cb) => (cb.checked = false));
        }
        return;
      }

      if (f.type === "enum") {
        const sel = document.querySelector(`select[name="${CSS.escape(key)}"]`);
        if (sel) sel.value = String(p[key] ?? "");
      }

      if (f.type === "multi_enum") {
        const want = new Set(Array.isArray(p[key]) ? p[key].map(String) : []);
        const cbs = document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(key)}"]`);
        cbs.forEach((cb) => (cb.checked = want.has(String(cb.value))));
      }
    });
  });
}

// ---------- 原有行为（保持） ----------
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

  // 同 generate：从“当前 Preset ID（用于 Jobs / 更新）”取
  // 如果你的 input id 不是 presetId，把这里改成真实 id
  const preset_id = (document.getElementById("presetId")?.value || "").trim();
  if (!preset_id) throw new Error("missing_preset_id（请先选择/加载一个 Preset）");

  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    stage: getStage(),
    preset_id,
    payload,
  };

  const out = await httpJson(`${apiBase()}/preview`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  $("previewOut").textContent = JSON.stringify(out, null, 2);

  if (out.blocked) setStatus("error", `被 Gate 拦截：${(out.reasons || []).join("; ")}`);
  else setStatus("ok", "Preview 成功");
}


async function onGenerate() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  // preset_id：从 UI 的“当前 Preset ID（用于 Jobs / 更新）”输入框取
  // 你截图里已经有这个输入框；这里假设它的 id 是 "presetId"（如果不同，把 id 改成你的实际值）
  const preset_id = (document.getElementById("presetId")?.value || "").trim();
  if (!preset_id) throw new Error("missing_preset_id（请先选择/加载一个 Preset）");

  // ✅ 保持现有生成方式：stage + payload（只多带一个事实字段 preset_id）
  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    stage: getStage(),
    preset_id,
    payload: collectPayload(currentSchema),
  };

  const out = await httpJson(`${apiBase()}/generate`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  $("genOut").textContent = JSON.stringify(out, null, 2);
  setStatus("ok", `Generate 完成，job_id=${out.job_id || "na"}`);
}


// ---------- Preset（保持 create/list/use） ----------
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

  $("presetId").value = out.preset_id || "";
  setStatus("ok", `Preset 已创建：preset_id=${out.preset_id || "na"}`);

  await presetRefreshList();
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
  const presetId = $("presetSelect").value;
  if (!presetId) throw new Error("未选择 preset");

  $("presetId").value = presetId;
  setStatus("ok", `已选定 preset_id=${presetId}（用于 Jobs / 更新）`);
}

// ✅ 新增：选择下拉时自动写入 presetId（减少误操作）
function bindPresetSelectAutofill() {
  $("presetSelect").addEventListener("change", () => {
    const v = $("presetSelect").value;
    if (v) $("presetId").value = v;
  });
}

// ✅ 新增：GET preset → 回填表单
// ✅ 新增：GET preset → 回填表单
async function presetLoadSelectedToForm() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  const preset_id = $("presetSelect").value || $("presetId").value.trim();
  if (!preset_id) throw new Error("未选择 preset");

  const url =
    `${apiBase()}/preset/get?preset_id=${encodeURIComponent(preset_id)}` +
    `&pack_id=${encodeURIComponent(getPackId())}` +
    `&pack_version=${encodeURIComponent(getPackVersion())}`;

  const out = await httpJson(url, { method: "GET" });
  const item = out.item;
  if (!item) throw new Error("preset_get 返回为空");

  // 同步 preset_id / stage（不推进阶段，只是把事实对齐到 UI）
  $("presetId").value = item.id;
  setStage(item.stage);

  // 回填表单（只按 schema key 回填）
  applyPayloadToForm(currentSchema, item.payload || {});
  applyStageLock(currentSchema, getStage());

  setStatus("ok", `已加载 preset 到表单：${item.name || item.id}`);
}



// ✅ 新增：用当前表单 payload 覆盖更新 preset
async function presetUpdateFromCurrentForm() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  const preset_id = $("presetId").value.trim() || $("presetSelect").value;
  if (!preset_id) throw new Error("preset_id 为空（先选择/加载 preset）");

  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    stage: getStage(), // 事实：由你手动选择
    payload: collectPayload(currentSchema), // 事实：覆盖写入
  };

  const out = await httpJson(`${apiBase()}/preset/update/${encodeURIComponent(preset_id)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!out.ok) throw new Error("preset_update 未返回 ok");

  setStatus("ok", `Preset 已更新：preset_id=${preset_id}`);
  await presetRefreshList();
}

// ---------- Jobs（只读） ----------
function buildJobsStatsUrl(presetId) {
  return `${apiBase()}/jobs/stats_by_preset?preset_id=${encodeURIComponent(presetId)}`;
}
function buildJobsByPresetUrl(presetId, limit = 20) {
  return `${apiBase()}/jobs/by_preset?preset_id=${encodeURIComponent(presetId)}&limit=${encodeURIComponent(limit)}`;
}
function buildJobGetUrl(jobId) {
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

  const rows = items
    .map((x) => {
      const id = escapeHtml(x.id);
      const created = escapeHtml(x.created_at || "");
      const status = escapeHtml(x.status || "");
      const err = escapeHtml(x.error || "");
      return `
        <tr>
          <td style="padding:6px;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace;">
            <a href="#" data-job="${id}">${id}</a>
          </td>
          <td style="padding:6px;border-top:1px solid #e5e7eb;">${created}</td>
          <td style="padding:6px;border-top:1px solid #e5e7eb;">${status}</td>
          <td style="padding:6px;border-top:1px solid #e5e7eb;">${err}</td>
        </tr>
      `;
    })
    .join("");

  host.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px;">job_id</th>
          <th style="text-align:left;padding:6px;">created_at</th>
          <th style="text-align:left;padding:6px;">status</th>
          <th style="text-align:left;padding:6px;">error</th>
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

function getEffectivePresetIdOrThrow() {
  let presetId = $("presetId").value.trim();
  if (!presetId) {
    const sel = $("presetSelect").value;
    if (sel) {
      $("presetId").value = sel;
      presetId = sel;
    }
  }
  if (!presetId) throw new Error("preset_id 为空（先创建/选择 preset）");
  return presetId;
}

async function onJobsStats() {
  const presetId = getEffectivePresetIdOrThrow();
  const out = await httpJson(buildJobsStatsUrl(presetId), { method: "GET" });
  renderJobsStats(out);
  setStatus("ok", "Jobs 统计已刷新");
}

async function onJobsList() {
  try {
    const presetId = getEffectivePresetIdOrThrow();

    setStatus("info", "正在加载 Jobs…");
    const out = await httpJson(buildJobsByPresetUrl(presetId, 20), { method: "GET" });

    const items = (out && Array.isArray(out.items)) ? out.items : [];
    renderJobsTable(items);

    if (items.length === 0) {
      setStatus("warn", "最近 Jobs：0 条（该 preset 可能还没生成过内容）");
    } else {
      setStatus("ok", `Jobs 列表已刷新：${items.length} 条`);
    }
  } catch (e) {
    console.error(e);
    // 关键：把错误显示到 UI，而不是静默
    setStatus("error", `Jobs 加载失败：${String(e?.message || e)}`); 
  }
}

// ---------- Feedback（录入 + 自动评估：只展示事实） ----------
function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toNonNegIntFromInput(id) {
  const raw = (document.getElementById(id)?.value ?? "").toString().trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function getFeedbackDateOrThrow() {
  const v = (document.getElementById("fbDate")?.value || "").trim();
  if (!v) throw new Error("feedback_date 不能为空");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("feedback_date 格式必须为 YYYY-MM-DD");
  return v;
}

function buildFeedbackUpsertBody(preset_id) {
  const date = getFeedbackDateOrThrow();
  const note = (document.getElementById("fbNote")?.value || "").trim() || null;

  return {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    preset_id,
    date,
    totals: {
      posts: toNonNegIntFromInput("fbPosts"),
      views: toNonNegIntFromInput("fbViews"),
      likes: toNonNegIntFromInput("fbLikes"),
      collects: toNonNegIntFromInput("fbCollects"),
      comments: toNonNegIntFromInput("fbComments"),
      dm_inbound: toNonNegIntFromInput("fbDmInbound"),
    },
    note,
  };
}

function applyEvaluationSideEffects(resp) {
  // resp: { ok, preset_id, stage, evaluation:{action,...} }
  const evalInfo = resp?.evaluation || {};
  const action = evalInfo.action || "none";

  // 1) advance：同步 stage 下拉 + 刷新 preset 列表（stage 变了，list 过滤会变化）
  if (action === "advance") {
    if (resp.stage) setStage(resp.stage);
  }

  // 2) disable：清空当前 preset_id（因为 enabled=1 的 list 里会消失）
  if (action === "disable") {
    $("presetId").value = "";
    $("presetSelect").value = "";
  }

  // 3) 无论如何：刷新 preset 列表（事实对齐）
  return action;
}

async function onFeedbackUpsert() {
  const presetId = getEffectivePresetIdOrThrow();

  const body = buildFeedbackUpsertBody(presetId);

  setStatus("info", "提交反馈中…");
  const out = await httpJson(`${apiBase()}/feedback/upsert`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  // 展示返回（只读）
  const el = document.getElementById("feedbackOut");
  if (el) el.textContent = JSON.stringify(out, null, 2);

  const action = applyEvaluationSideEffects(out);

  // 刷新 preset 列表（stage / enabled 可能变化）
  await presetRefreshList();

  // 若是 advance：可选再把当前 preset 回填到表单（保持 UI 对齐）
  // 若是 disable：不用回填
  if (action === "advance") {
    // 尝试回填当前 preset（如果还可见）
    try {
      $("presetId").value = out.preset_id || presetId;
      await presetLoadSelectedToForm(); // 若 presetSelect 为空也会用 presetId
    } catch {
      // 不强制
    }
  }

  setStatus("ok", `Feedback 已写入，evaluation.action=${action}`);
}

function bindFeedbackDefaults() {
  const d = document.getElementById("fbDate");
  if (d && !d.value) d.value = todayYmdLocal();
}

// 可选：你如果希望“用 Jobs 统计填充”为一个快捷键（不是必须）
async function onFeedbackFillFromStats() {
  const presetId = getEffectivePresetIdOrThrow();
  const stats = await httpJson(buildJobsStatsUrl(presetId), { method: "GET" });

  // 这里只做一个“事实填充”的示例：你也可以删掉这个按钮绑定
  // 例如把 total 当 posts（不推荐），所以默认不写；仅保留接口通路验证
  setStatus("ok", `已获取 stats：total=${stats.total}, generated=${stats.generated}, failed=${stats.failed}（未写入表单）`);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $("btnLoad").addEventListener("click", () => loadSchema().catch(showError));
  $("btnPreview").addEventListener("click", () => previewPrompt().catch(showError));
  $("btnGenerate").addEventListener("click", () => onGenerate().catch(showError));

    // Feedback
  $("btnFeedbackUpsert").addEventListener("click", () => onFeedbackUpsert().catch(showError));
  $("btnFeedbackFillFromStats").addEventListener("click", () => onFeedbackFillFromStats().catch(showError));

  $("btnPresetCreate").addEventListener("click", () => presetCreateFromCurrentPayload().catch(showError));
  $("btnPresetRefresh").addEventListener("click", () => presetRefreshList().catch(showError));
  $("btnPresetUse").addEventListener("click", () => {
    try {
      presetUseSelected();
    } catch (e) {
      showError(e);
    }
  });

  // ✅ 新增按钮
  $("btnPresetLoadToForm").addEventListener("click", () => presetLoadSelectedToForm().catch(showError));
  $("btnPresetUpdateFromForm").addEventListener("click", () => presetUpdateFromCurrentForm().catch(showError));

  $("btnJobsStats").addEventListener("click", () => onJobsStats().catch(showError));
  $("btnJobsList").addEventListener("click", () => onJobsList().catch(showError));

  bindPresetSelectAutofill();

  $("stage").addEventListener("change", () => {
  if (currentSchema) applyStageLock(currentSchema, getStage());
  });

}

// ---------- 默认值 ----------
function setDefaults() {
  $("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
  $("packId").value = "xhs";
  $("packVer").value = "v1.0.0";
  $("stage").value = "S0";
}

setDefaults();
bindEvents();
bindFeedbackDefaults();







