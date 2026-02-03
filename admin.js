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

// Safe DOM helpers for multi-index.html usage (public/self):
const hasEl = (id) => !!document.getElementById(id);
const onEl = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const setVal = (id, v) => { const el = $(id); if (el) el.value = (v === null || v === undefined) ? "" : String(v); };

// Optional: page mode switch via <meta name="tracklab-mode" content="public|self">
function getMode() {
  return document.querySelector('meta[name="tracklab-mode"]')?.content || "self";
}
function isPublicMode() { return getMode() === "public"; }

let currentSchema = null;

// ---------- 通用工具 ----------
function showError(e) {
  console.error(e);
  const msg = e?.message || String(e);
  setStatus("error", msg);
  // 关键：把错误也写到 Feedback 卡片里，避免“无返回”的错觉
  setFeedbackOut({ ok: false, error: msg });
}

function setFeedbackOut(objOrText) {
  const el = document.getElementById("feedbackOut");
  if (!el) return;
  if (typeof objOrText === "string") {
    el.textContent = objOrText;
  } else {
    el.textContent = JSON.stringify(objOrText, null, 2);
  }
}

function renderEvaluationSummary(resp) {
  const badge = document.getElementById("evalBadge");
  const a = document.getElementById("evalAction");
  const fs = document.getElementById("evalFromStage");
  const ts = document.getElementById("evalToStage");
  const rid = document.getElementById("evalRuleId");
  const win = document.getElementById("evalWindow");
  const m = document.getElementById("evalMetrics");

  if (!badge || !a || !fs || !ts || !rid || !win || !m) return;

  const ev = resp?.evaluation || {};
  const action = ev.action || "none";

  a.value = action;
  fs.value = ev.from_stage || "";
  ts.value = ev.to_stage || "";
  rid.value = ev.rule_id || "";
  win.textContent = ev.window
  ? JSON.stringify(ev.window, null, 2)
  : "(empty)";

  const metrics = ev.metrics ?? null;
  m.textContent = metrics ? JSON.stringify(metrics, null, 2) : "(empty)";

  // 视觉徽标（不引导，不解释）
  if (action === "advance") {
    badge.textContent = `✅ ADVANCE：${ev.from_stage || ""} → ${ev.to_stage || ""}`;
    badge.className = "ok";
  } else if (action === "disable") {
    badge.textContent = `⛔ DISABLE：${ev.from_stage || ""}（rule=${ev.rule_id || "n/a"}）`;
    badge.className = "error";
  } else {
    badge.textContent = `… CONTINUE：继续观察（stage=${resp?.stage || ev.from_stage || ""}）`;
    badge.className = "muted";
  }
}

// ---------- Preset Snapshot（只读状态总览；不改 worker） ----------
async function fetchPresetDetailForSnapshot(presetId) {
  if (!presetId) return null;

  const url =
    `${apiBase()}/preset/get?preset_id=${encodeURIComponent(presetId)}` +
    `&pack_id=${encodeURIComponent(getPackId())}` +
    `&pack_version=${encodeURIComponent(getPackVersion())}`;

  const out = await httpJson(url, { method: "GET" });
  return out?.item || out?.preset || null;
}

function renderPresetSnapshot(preset) {
  const hasAnyEl =
    document.getElementById("snapPresetId") ||
    document.getElementById("snapRaw") ||
    document.getElementById("presetStageEnteredAt");
  if (!hasAnyEl) return; // 未安装 Snapshot 面板则静默退出

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (v === null || v === undefined) ? "" : String(v);
  };

  setVal("snapPresetId", preset?.id || "");
  setVal("snapEnabled", preset?.enabled);
  setVal("snapStage", preset?.stage || "");
  setVal("presetStageEnteredAt", preset?.stage_entered_at || "");

  setVal("snapDisabledReason", preset?.disabled_reason || "");
  setVal("snapDisabledAt", preset?.disabled_at || "");

  const baseline = {
    posts: preset?.baseline_posts_total ?? null,
    views: preset?.baseline_views_total ?? null,
    likes: preset?.baseline_likes_total ?? null,
    collects: preset?.baseline_collects_total ?? null,
    comments: preset?.baseline_comments_total ?? null,
    dm_inbound: preset?.baseline_dm_inbound_total ?? null,
  };

  const baselineEl = document.getElementById("snapBaseline");
  if (baselineEl) {
    const hasAny = Object.values(baseline).some(v => v !== null);
    baselineEl.textContent = hasAny ? JSON.stringify(baseline, null, 2) : "(empty)";
  }

  const rawEl = document.getElementById("snapRaw");
  if (rawEl) rawEl.textContent = preset ? JSON.stringify(preset, null, 2) : "(empty)";
}

async function refreshPresetSnapshot(presetIdMaybe) {
  try {
    const presetId = presetIdMaybe || getEffectivePresetIdOrThrow();
    const p = await fetchPresetDetailForSnapshot(presetId);
    renderPresetSnapshot(p);
  } catch {}
}
// ---------- Preset Snapshot end ----------




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
  if (!el) return;
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
  setText("previewOut", "(empty)");
  setText("genOut", "(empty)");
  setText("jobDetail", "(empty)");
  setText("jobsTable", "(empty)");
  setText("jobsStats", "(empty)");

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

  setText("previewOut", JSON.stringify(out, null, 2));

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

  setText("genOut", JSON.stringify(out, null, 2));
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

  setVal("presetId", out.preset_id || "");
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
  if (!sel) { setStatus("warn", "presetSelect 不存在：该页面可能是 public 版，已跳过 Preset 列表渲染"); return; }
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
  const presetId = sel ? sel.value : "";
  if (!presetId) throw new Error("未选择 preset");

  setVal("presetId", presetId);
  setStatus("ok", `已选定 preset_id=${presetId}（用于 Jobs / 更新）`);
}

// ✅ 新增：选择下拉时自动写入 presetId（减少误操作）
function bindPresetSelectAutofill() {
  const sel = $("presetSelect");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v) setVal("presetId", v);
  });
}

// ✅ 新增：GET preset → 回填表单
// ✅ 新增：GET preset → 回填表单
async function presetLoadSelectedToForm() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  const preset_id = ($("presetSelect")?.value || $("presetId")?.value || "").trim();
  if (!preset_id) throw new Error("未选择 preset");

  const url =
    `${apiBase()}/preset/get?preset_id=${encodeURIComponent(preset_id)}` +
    `&pack_id=${encodeURIComponent(getPackId())}` +
    `&pack_version=${encodeURIComponent(getPackVersion())}`;

  const out = await httpJson(url, { method: "GET" });
  const item = out.item;
  if (!item) throw new Error("preset_get 返回为空");

  // 同步 preset_id / stage（不推进阶段，只是把事实对齐到 UI）
  setVal("presetId", item.id);
  setStage(item.stage);

  // 回填表单（只按 schema key 回填）
  applyPayloadToForm(currentSchema, item.payload || {});
  applyStageLock(currentSchema, getStage());

  setStatus("ok", `已加载 preset 到表单：${item.name || item.id}`);
  await refreshPresetSnapshot(item.id);
}



// ✅ 新增：用当前表单 payload 覆盖更新 preset
async function presetUpdateFromCurrentForm() {
  if (!currentSchema) throw new Error("请先加载 Schema");

  const preset_id = ($("presetId")?.value || "").trim() || $("presetSelect")?.value;
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
  await refreshPresetSnapshot(preset_id);
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
  setText("jobsStats", `total=${stats.total}, generated=${stats.generated}, failed=${stats.failed}`);
}

function renderJobsTable(items) {
  const host = $("jobsTable");
  if (!host) return;
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
  setText("jobDetail", JSON.stringify(out, null, 2));
}

function getEffectivePresetIdOrThrow() {
  let presetId = ($("presetId")?.value || "").trim();
  if (!presetId) {
    const sel = $("presetSelect")?.value;
    if (sel) {
      setVal("presetId", sel);
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


// ---------- Feedback 人性保护（前端护栏；不改 worker） ----------
function setFbWarn(text) {
  const el = document.getElementById("fbWarn");
  if (!el) return;
  el.textContent = text || "";
}

function ensureFeedbackDateDefault() {
  const el = document.getElementById("fbDate");
  if (el && !el.value) el.value = todayYmdLocal();
}

function parseYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// 软校验：如果未来你在“Preset 状态总览”里加了 presetStageEnteredAt（ISO），这里会自动提示口径风险
function softValidateFeedbackDateAgainstStage() {
  const dateStr = (document.getElementById("fbDate")?.value || "").trim();
  const dt = parseYmd(dateStr);
  if (!dt) {
    setFbWarn("⚠ Date 格式必须为 YYYY-MM-DD。");
    return false;
  }

  const enteredIso = (document.getElementById("presetStageEnteredAt")?.value || "").trim();
  if (!enteredIso) { setFbWarn(""); return true; }

  const enteredDate = enteredIso.slice(0, 10);
  const et = parseYmd(enteredDate);
  if (!et) { setFbWarn(""); return true; }

  if (dt < et) {
    setFbWarn(`⚠ Date 早于进入当前 Stage 的日期（${enteredDate}）。若你填的是累计总量，这通常意味着口径不一致。`);
    return true; // 软提示，不阻断
  }

  setFbWarn("");
  return true;
}

// 硬校验：非负整数；异常直接阻断提交（避免“静默归零”造成伪数据）
function readNonNegIntStrict(id, label) {
  const raw = (document.getElementById(id)?.value ?? "").toString().trim();
  if (raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${label || id} 必须是数字`);
  if (n < 0) throw new Error(`${label || id} 不能为负数`);
  return Math.trunc(n);
}

// 防呆：当数值整体很小，提示一次“你填的是累计总量吗”
function maybeConfirmCumulative(totals) {
  const small =
    (totals.views ?? 0) <= 50 &&
    (totals.likes ?? 0) <= 10 &&
    (totals.collects ?? 0) <= 5 &&
    (totals.comments ?? 0) <= 5 &&
    (totals.dm_inbound ?? 0) <= 2;

  if (!small) return true;

  return window.confirm(
    "确认：你填写的是“累计总量”（截止该日期），不是当天新增？\n\n若只是当天数据，请先把总量累加后再提交。"
  );
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
      posts: readNonNegIntStrict("fbPosts", "Posts（累计）"),
      views: readNonNegIntStrict("fbViews", "Views（累计）"),
      likes: readNonNegIntStrict("fbLikes", "Likes（累计）"),
      collects: readNonNegIntStrict("fbCollects", "Collects（累计）"),
      comments: readNonNegIntStrict("fbComments", "Comments（累计）"),
      dm_inbound: readNonNegIntStrict("fbDmInbound", "DM Inbound（累计）"),
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
        setVal("presetId", "");
    setVal("presetSelect", "");
  }

  // 3) 无论如何：刷新 preset 列表（事实对齐）
  return action;
}

async function onFeedbackUpsert() {
  ensureFeedbackDateDefault();
  softValidateFeedbackDateAgainstStage();

  const presetId = getEffectivePresetIdOrThrow();
  const body = buildFeedbackUpsertBody(presetId);

  if (!maybeConfirmCumulative(body.totals)) return;

  setStatus("info", "提交反馈中…");
  setFeedbackOut({ ok: true, status: "submitting", body });

  const out = await httpJson(`${apiBase()}/feedback/upsert`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  setFeedbackOut(out);
  renderEvaluationSummary(out);

  const action = applyEvaluationSideEffects(out);
  await presetRefreshList();
  await refreshPresetSnapshot(out.preset_id || presetId);

  if (action === "advance") {
    try {
            setVal("presetId", out.preset_id || presetId);
      await presetLoadSelectedToForm();
    } catch {}
  }

  setStatus("ok", `Feedback 已写入，evaluation.action=${action}`);
}



function bindFeedbackDefaults() {
  const d = document.getElementById("fbDate");
  if (d && !d.value) d.value = todayYmdLocal();
}

async function onFeedbackFillFromStats() {
  const presetId = getEffectivePresetIdOrThrow();

  setStatus("info", "获取 Jobs stats 中…");
  setFeedbackOut({ ok: true, status: "loading_jobs_stats", preset_id: presetId });

  const stats = await httpJson(buildJobsStatsUrl(presetId), { method: "GET" });

  // 不把 stats 硬填到 Views/Likes（避免伪数据），但要可视化返回
  setFeedbackOut({ ok: true, jobs_stats: stats });

  setStatus("ok", `已获取 stats：total=${stats.total}, generated=${stats.generated}, failed=${stats.failed}`);
}


// ---------- 事件绑定 ----------
function bindEvents() {
  onEl("btnLoad", "click", () => loadSchema().catch(showError));
  onEl("btnPreview", "click", () => previewPrompt().catch(showError));
  onEl("btnGenerate", "click", () => onGenerate().catch(showError));

  // Feedback
  onEl("btnFeedbackUpsert", "click", () => onFeedbackUpsert().catch(showError));
  onEl("btnFeedbackFillFromStats", "click", () => onFeedbackFillFromStats().catch(showError));

  // Preset
  onEl("btnPresetCreate", "click", () => presetCreateFromCurrentPayload().catch(showError));
  onEl("btnPresetRefresh", "click", () => presetRefreshList().catch(showError));
  onEl("btnPresetUse", "click", () => {
    try { presetUseSelected(); } catch (e) { showError(e); }
  });
  onEl("btnPresetLoadToForm", "click", () => presetLoadSelectedToForm().catch(showError));
  onEl("btnPresetUpdateFromForm", "click", () => presetUpdateFromCurrentForm().catch(showError));

  // Jobs（public 版可不提供这些按钮）
  onEl("btnJobsStats", "click", () => onJobsStats().catch(showError));
  onEl("btnJobsList", "click", () => onJobsList().catch(showError));

  bindPresetSelectAutofill();

  onEl("stage", "change", () => { if (currentSchema) applyStageLock(currentSchema, getStage()); });
}

// ---------- 默认值 ----------

function setDefaults() {
  // public/self 都可复用：不存在的 input 直接跳过
  setVal("apiBase", "https://tracklab-api.wuxiaofei1985.workers.dev");
  setVal("packId", "xhs");
  setVal("packVer", "v1.0.0");
  setVal("stage", "S0");
}

setDefaults();
bindEvents();
bindFeedbackDefaults();
ensureFeedbackDateDefault();










