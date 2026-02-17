/* /public/form/form.js (TrackLab Admin-Lite) — Refactor
 * - 分区：DOM/HTTP/Schema/State/Loaders/Render/Save/UI
 * - 不改接口、不改流程、不改字段语义
 * - 小修：apiBase 空值提前报错；packVersion 为空时报错；多选读取更稳健
 */

(() => {
  /** =====================================================
   * CONSTANTS / DOM
   * ===================================================== */
  const EMPTY_TEXT = "请选择";

  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => {
    const el = $(id);
    if (el) el.addEventListener(evt, fn);
  };

  /** =====================================================
   * API BASE BOOT (config.json / ?api=) —— 与 client.js 一致
   * ===================================================== */
  let __API_BASE = "";

  function ghPagesRepoRootPath() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (location.hostname.endsWith("github.io") && parts.length >= 1) return `/${parts[0]}/`;
    return "/";
  }

  async function bootApiBase() {
    const u = new URL(location.href);
    const fromQuery = u.searchParams.get("api");
    if (fromQuery) {
      __API_BASE = fromQuery.trim().replace(/\/+$/, "");
    } else {
      const cfgUrl = new URL(`${ghPagesRepoRootPath()}config.json`, location.origin).toString();
      const resp = await fetch(cfgUrl, { cache: "no-store" });
      if (!resp.ok) throw new Error("config_json_not_found");
      const cfg = await resp.json();
      __API_BASE = String(cfg.api_base || "").trim().replace(/\/+$/, "");
      if (!__API_BASE) throw new Error("api_base_missing_in_config");
    }
    const el = $("apiBase");
    if (el) el.value = __API_BASE;
  }

  function setStatus(type, msg) {
    const el = $("status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "status" + (type === "err" ? " err" : "");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /** =====================================================
   * HTTP
   * ===================================================== */
  async function httpjson(url, opt = {}) {
    const res = await fetch(url, {
      ...opt,
      headers: { "content-type": "application/json", ...(opt.headers || {}) },
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

  /** =====================================================
   * BASIC GETTERS
   * ===================================================== */
  function apiBase() {
    const v = (__API_BASE || $("apiBase")?.value || "").trim().replace(/\/+$/, "");
    if (!v) throw new Error("api_base_empty");
    return v;
  }
  function getPackId() {
    return $("packId")?.value || "";
  }
function getPackVersion() {
  const v = (($("packVer")?.value || $("packVersion")?.value || "") + "").trim();
  if (!v) throw new Error("pack_version_required");
  return v;
}

  /** =====================================================
   * PACK SELECTORS (from /packs/index) —— 与 client.js 一致
   * ===================================================== */
  async function bootPackSelectors() {
    const packSel = $("packId");
    const verSel = $("packVer") || $("packVersion");
    if (!packSel || !verSel) return;

    const idx = await httpjson(`${apiBase()}/packs/index`, { method: "GET" });
    const packs = Array.isArray(idx?.packs) ? idx.packs : [];
    const defPackId = idx?.default?.pack_id || "";
    const defVer = idx?.default?.pack_version || "";

    packSel.innerHTML = "";
    const p0 = document.createElement("option");
    p0.value = "";
    p0.textContent = EMPTY_TEXT;
    packSel.appendChild(p0);
    packs.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = String(p.pack_id || "").trim();
      opt.textContent = String(p.label || p.pack_id || "").trim();
      packSel.appendChild(opt);
    });

    function renderVersionsFor(packId) {
      verSel.innerHTML = "";
      const v0 = document.createElement("option");
      v0.value = "";
      v0.textContent = EMPTY_TEXT;
      verSel.appendChild(v0);

      const p = packs.find((x) => String(x.pack_id || "") === String(packId || ""));
      const vers = Array.isArray(p?.versions) ? p.versions : [];
      vers.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = String(v.pack_version || "").trim();
        opt.textContent = String(v.label || v.pack_version || "").trim();
        verSel.appendChild(opt);
      });
    }

    if (defPackId) packSel.value = defPackId;
    renderVersionsFor(packSel.value);
    if (defVer) verSel.value = defVer;

    packSel.addEventListener("change", () => {
      renderVersionsFor(packSel.value);
      // 仅重置 UI 状态，不做策略判断
      uiSchema = null;
      manifest = null;
      currentOwnerId = "";
      currentAccountId = "";
      currentPresetId = "";
      setStatus("info", "pack 已切换：请重新选择用户名/账号/角色");
      boot().catch((e) => setStatus("err", e.message));
    });
    verSel.addEventListener("change", () => {
  // 切版本：只重置 schema/preset 相关状态，然后重新 boot
  uiSchema = null;
  manifest = null;
  currentPresetId = "";
  setStatus("info", "版本已切换：重新加载 schema…");
  boot().catch((e) => setStatus("err", e.message));
});
  }

  /** =====================================================
   * STAGE HELPERS
   * ===================================================== */
  function stageRank(s) {
    if (!s) return -1;
    const m = String(s).match(/^S(\d+)$/i);
    return m ? Number(m[1]) : 999;
  }
  function minStage(stages) {
    if (!Array.isArray(stages) || stages.length === 0) return null;
    return stages.slice().sort((a, b) => stageRank(a) - stageRank(b))[0];
  }

  function normalizeStageFilter(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    if (s === "全部级别" || s === "全部" || s.toLowerCase() === "all") return "";
    if (/^S[0-3]$/i.test(s)) return s.toUpperCase();
    if (/^[0-3]$/.test(s)) return `S${s}`;
    const m = s.match(/([0-3])/);
    if (m) return `S${m[1]}`;
    return "";
  }

  /** =====================================================
   * SCHEMA HELPERS
   * ===================================================== */
  // ✅ 兼容 schema：fields 或 groups.fields
  function getAllFieldsFromSchema(schema) {
    if (!schema) return [];
    if (Array.isArray(schema.fields)) return schema.fields.map((f) => ({ ...f }));
    if (Array.isArray(schema.groups)) {
      const out = [];
      for (const g of schema.groups) {
        for (const f of g.fields || []) {
          out.push({ ...f, __group: g.label || g.id || "" });
        }
      }
      return out;
    }
    return [];
  }

  function setControlDisabled(root, disabled) {
    if (!root) return;
    if (
      root instanceof HTMLInputElement ||
      root instanceof HTMLSelectElement ||
      root instanceof HTMLTextAreaElement
    ) {
      root.disabled = disabled;
      return;
    }
    root
      .querySelectorAll("input,select,textarea,button")
      .forEach((el) => (el.disabled = disabled));
  }

  /** =====================================================
   * STATE
   * ===================================================== */
  let uiSchema = null;
  let manifest = null;

  let currentOwnerId = "";
  let currentAccountId = "";
  let currentPreset = null;

  let currentPayload = {};
  let currentStage = "S0";

  /** =====================================================
   * BOOT
   * ===================================================== */
  window.addEventListener("DOMContentLoaded", () => {
    (async () => {
      await bootApiBase();
      await bootPackSelectors();
      bindEvents();
      await boot();
    })().catch((e) => setStatus("err", e.message));
  });

  function bindEvents() {
    on("btnLoad", "click", () => boot().catch((e) => setStatus("err", e.message)));
    // packId/packVersion 的变更由 bootPackSelectors() 统一处理

    on("ownerId", "change", () => handleOwnerChanged().catch((e) => setStatus("err", e.message)));
    on("accountSelect", "change", () =>
      handleAccountChanged().catch((e) => setStatus("err", e.message))
    );

    on("onlyEnabled", "change", () => presetRefreshList().catch((e) => setStatus("err", e.message)));
    on("stageFilter", "change", () => presetRefreshList().catch((e) => setStatus("err", e.message)));
    on("presetSelect", "change", () =>
      presetLoadAndRender().catch((e) => setStatus("err", e.message))
    );

    on("btnSave", "click", () => saveCurrentStage().catch((e) => setStatus("err", e.message)));
  }

  async function boot() {
    await loadPackSchema();
    await loadOwners();
    await handleOwnerChanged();
    setStatus("ok", "就绪");
  }

  /** =====================================================
   * PACK SCHEMA
   * ===================================================== */
  async function loadPackSchema() {
    setStatus("ok", "加载 Schema…");

    const out = await httpjson(`${apiBase()}/pack/${getPackId()}/${getPackVersion()}`);
    manifest = out.manifest;
    uiSchema = out.ui_schema;

    if ($("schemaHint")) {
      $("schemaHint").textContent = `Schema 已加载：${
        uiSchema?.meta?.name || "ui_schema"
      } (${getPackId()} / ${getPackVersion()})`;
    }

    setStatus("ok", "Schema 已加载");
  }

  /** =====================================================
   * OWNERS / ACCOUNTS
   * ===================================================== */
  async function loadOwners() {
    const sel = $("ownerId");
    if (!sel) return;

    sel.innerHTML = `<option value="">请选择</option>`;
    sel.value = "";

    // ✅ users 表：value 用 id（用于关联）；显示 display_name
    const out = await httpjson(`${apiBase()}/user/list?enabled=1`, { method: "GET" });
    const items = out.items || [];

    items.forEach((u) => {
      const id = String(u.id || "").trim();
      if (!id) return;

      const label =
        (u.display_name && String(u.display_name).trim()) ||
        (u.username && String(u.username).trim()) ||
        id;

      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  }

  async function handleOwnerChanged() {
    currentOwnerId = $("ownerId")?.value || "";

    currentAccountId = "";
    clearPresetInfo();
    clearForm();

    if (!currentOwnerId) {
      if ($("accountSelect")) $("accountSelect").innerHTML = `<option value="">请先选择用户名</option>`;
      if ($("presetSelect")) $("presetSelect").innerHTML = `<option value="">请先选择用户名</option>`;
      return;
    }

    await refreshAccounts();
    await handleAccountChanged();
  }

  async function refreshAccounts() {
    setStatus("ok", "加载账号…");

    const pack_id = getPackId();
    const pack_version = getPackVersion();

    if (!pack_id) throw new Error("pack_id_required");
    if (!pack_version) throw new Error("pack_version_required");

    const qs = new URLSearchParams({
      owner_id: currentOwnerId,
      pack_id,
      pack_version,
      enabled: "1",
    });

    const out = await httpjson(`${apiBase()}/account/list?${qs.toString()}`, { method: "GET" });
    const items = out.items || [];

    const sel = $("accountSelect");
    if (!sel) return;

    if (!items.length) {
      sel.innerHTML = `<option value="">该用户暂无账号</option>`;
      sel.value = "";
      currentAccountId = "";
      return;
    }

    sel.innerHTML = [`<option value="">请选择</option>`]
      .concat(
        items.map((it) => {
          const handle = it.handle && String(it.handle).trim() ? it.handle : "(no handle)";
          return `<option value="${escapeHtml(it.id)}">${escapeHtml(handle)} (${escapeHtml(
            it.updated_at || ""
          )})</option>`;
        })
      )
      .join("");

    // 不记录上次账号：不读/写 localStorage
    sel.value = "";
    currentAccountId = "";
  }

  async function handleAccountChanged() {
    currentAccountId = $("accountSelect")?.value || "";

    clearPresetInfo();
    clearForm();

    if (!currentAccountId) {
      if ($("presetSelect")) $("presetSelect").innerHTML = `<option value="">请选择有效账号</option>`;
      return;
    }

    await presetRefreshList();
  }

  /** =====================================================
   * PRESETS
   * ===================================================== */
  async function presetRefreshList() {
    setStatus("ok", "加载角色列表…");

    const enabledRaw = ($("onlyEnabled")?.value ?? $("enabledOnly")?.value ?? "").toString().trim();
    const stageRaw = ($("stageFilter")?.value ?? "").toString().trim();

    const enabled = enabledRaw; // "" / "0" / "1"
    const stage = normalizeStageFilter(stageRaw); // "" / "S0-S3"

    const qs = new URLSearchParams();
    qs.set("pack_id", getPackId());
    qs.set("pack_version", getPackVersion());

    if (stage) qs.set("stage", stage);
    if (enabled === "0" || enabled === "1") qs.set("enabled", enabled);

    // form 必须 “选账号 → 看角色”
    if (currentAccountId) qs.set("account_id", currentAccountId);

    const out = await httpjson(`${apiBase()}/preset/list?${qs.toString()}`, { method: "GET" });
    const items = out.items || [];

    const sel = $("presetSelect");
    if (!sel) return;

    sel.innerHTML = items.length
      ? [`<option value="">请选择</option>`]
          .concat(
            items.map((it) => {
              const badge = Number(it.enabled) === 1 ? "" : "（已淘汰）";
              return `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name)} [${escapeHtml(
                it.stage
              )}] ${badge} (${escapeHtml(it.updated_at || "")})</option>`;
            })
          )
          .join("")
      : `<option value="">当前筛选条件无角色</option>`;

    sel.value = ""; // 不自动选中
  }

  async function presetLoadAndRender() {
    const preset_id = $("presetSelect")?.value || "";
    if (!preset_id) {
      clearPresetInfo();
      clearForm();
      return;
    }

    setStatus("ok", "加载角色详情…");

    const out = await httpjson(
      `${apiBase()}/preset/get?preset_id=${encodeURIComponent(preset_id)}&pack_id=${encodeURIComponent(
        getPackId()
      )}&pack_version=${encodeURIComponent(getPackVersion())}`,
      { method: "GET" }
    );

    currentPreset = out.item || out.preset || null;
    if (!currentPreset) throw new Error("preset_not_found");

    currentPayload = currentPreset.payload || {};
    currentStage = currentPreset.stage || "S0";

    if ($("presetId")) $("presetId").value = currentPreset.id || "";
    if ($("presetStage")) $("presetStage").value = currentStage;
    if ($("presetEnabled")) $("presetEnabled").value = String(currentPreset.enabled);

    const disabled = Number(currentPreset.enabled) !== 1;
    if ($("btnSave")) $("btnSave").disabled = disabled;
    if ($("saveHint")) {
      $("saveHint").textContent = disabled
        ? "该角色已淘汰（enabled=0），仅可回看，不可保存。"
        : "仅当前 stage 字段可编辑；保存后会刷新预览 prompt。";
    }

    renderForm();

    await previewPromptToDebug(currentStage, currentPayload).catch(() => {});
    setStatus("ok", "角色已加载");
  }

  /** =====================================================
   * RENDER FORM
   * ===================================================== */
  function renderForm() {
    const c = $("formContainer");
    if (!c) return;

    c.innerHTML = "";
    if (!uiSchema || !currentPreset) {
      c.innerHTML = `<div class="sub">当前阶段暂无可填写表单</div>`;
      return;
    }

    const fields = getAllFieldsFromSchema(uiSchema);
    const curRank = stageRank(currentStage);

    const visible = fields.filter((f) => {
      const first = minStage(f.editable_stages);
      if (!first) return false;
      return stageRank(first) <= curRank;
    });

    if (visible.length === 0) {
      c.innerHTML = `<div class="sub">当前阶段暂无可填写表单</div>`;
      return;
    }

    // group by first editable stage
    const groups = new Map();
    for (const f of visible) {
      const first = minStage(f.editable_stages) || "S0";
      if (!groups.has(first)) groups.set(first, []);
      groups.get(first).push(f);
    }

    const stages = Array.from(groups.keys()).sort((a, b) => stageRank(a) - stageRank(b));

    for (const st of stages) {
      const box = document.createElement("div");
      box.className = "fieldcard";

      const head = document.createElement("div");
      head.className = "fieldhead";
      head.innerHTML = `<div><b>${escapeHtml(st)}</b></div><div class="pill">${
        stageRank(st) === curRank ? "当前阶段可编辑" : "历史阶段只读"
      }</div>`;
      box.appendChild(head);

      for (const f of groups.get(st) || []) {
        const key = f.key;
        const label = f.label || key;

        const isEditable =
          Array.isArray(f.editable_stages) &&
          f.editable_stages.includes(currentStage) &&
          Number(currentPreset.enabled) === 1;

        const wrap = document.createElement("div");
        wrap.style.marginBottom = "10px";

        const lab = document.createElement("label");
        const required =
          Array.isArray(f.required_stages) && f.required_stages.includes(currentStage);
        lab.textContent = label + (required ? " *" : "");
        wrap.appendChild(lab);

        const input = buildInputForField(f, currentPayload?.[key]);
        input.id = `fld__${key}`;
        setControlDisabled(input, !isEditable);

                // ✅ topic_bank：更新/升级页“可见但不可改”
        const topicSelectorKey = manifest?.topic?.selector_field; // e.g. "topic_bank"
        const isTopicSelector = topicSelectorKey && key === topicSelectorKey;

        // 已加载 preset（=更新/升级场景）时，一律锁死 topic_bank
        if (isTopicSelector && currentPreset?.id) {
          setControlDisabled(input, true);
        } else {
          setControlDisabled(input, !isEditable);
        }

        // ✅ 永久冻结：升级/作废规则（stage_rules_ref）在 form 页任何阶段都不可改
const isStageRulesRef = key === "stage_rules_ref";
if (isStageRulesRef) {
  setControlDisabled(input, true);
} else {
  // 原有逻辑不变
  const topicSelectorKey = manifest?.topic?.selector_field; // e.g. "topic_bank"
  const isTopicSelector = topicSelectorKey && key === topicSelectorKey;

  if (isTopicSelector && currentPreset?.id) {
    setControlDisabled(input, true);
  } else {
    setControlDisabled(input, !isEditable);
  }
}

        wrap.appendChild(input);

        if (f.help) {
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

  function buildInputForField(field, value) {
    const type = field.type || "text";

    if (type === "textarea") {
      const el = document.createElement("textarea");
      el.value = value == null ? "" : String(value);
      return el;
    }

    if (type === "enum") {
      const el = document.createElement("select");
      const opts = field.options || [];
      el.innerHTML = [`<option value="">请选择</option>`]
        .concat(
          opts.map(
            (o) =>
              `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label || o.value)}</option>`
          )
        )
        .join("");
      el.value = value == null ? "" : String(value);
      return el;
    }

    // ✅ 多选：multi_enum
    if (type === "multi_enum") {
      const wrap = document.createElement("div");
      wrap.className = "checks";
      const selected = new Set(Array.isArray(value) ? value : []);

      for (const opt of field.options || []) {
        const lab = document.createElement("label");
        lab.className = "check";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = field.key;
        cb.value = opt.value;
        cb.checked = selected.has(opt.value);

        const span = document.createElement("span");
        span.textContent = opt.label || opt.value;

        lab.appendChild(cb);
        lab.appendChild(span);
        wrap.appendChild(lab);
      }
      return wrap;
    }

    if (type === "bool") {
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

    const el = document.createElement("input");
    el.type = "text";
    el.value = value == null ? "" : String(value);
    return el;
  }

  /** =====================================================
   * SAVE
   * ===================================================== */
  async function saveCurrentStage() {
    if (!currentPreset?.id) throw new Error("未加载 preset");
    if (Number(currentPreset.enabled) !== 1) throw new Error("该 preset 已淘汰（enabled=0），不可保存");

    setStatus("ok", "保存中…");

    const fields = getAllFieldsFromSchema(uiSchema);
    const editableFields = fields.filter(
    (f) => Array.isArray(f.editable_stages) && f.editable_stages.includes(currentStage)
    );

    // ✅ 保存层锁死：topic selector（topic_bank）永不写回
    const lockedKeys = new Set();
    const topicSelectorKey = manifest?.topic?.selector_field; // "topic_bank"
    if (topicSelectorKey) lockedKeys.add(topicSelectorKey);


    const merged = { ...(currentPayload || {}) };

    for (const f of editableFields) {
      const key = f.key;
      // ✅ 彻底禁止更新 topic_bank
      if (lockedKeys.has(key) && currentPreset?.id) {
        continue;
      }
      const root = $(`fld__${key}`);
      if (!root) continue;

      let v = null;

      if ((f.type || "") === "multi_enum") {
        // root 是 div.checks
        v = Array.from(root.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(key)}"]`))
          .filter((x) => x.checked)
          .map((x) => x.value);
      } else {
        v = root.value;
      }

      if ((f.type || "") === "bool") {
        if (v === "true") v = true;
        else if (v === "false") v = false;
        else v = null;
      }

      if (typeof v === "string") {
        v = v.trim();
        if (v === "") v = null;
      }

      if (Array.isArray(f.required_stages) && f.required_stages.includes(currentStage)) {
        if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
          throw new Error(`缺少必填：${f.label || f.key}`);
        }
      }

      merged[key] = v;
    }

    await httpjson(`${apiBase()}/preset/update/${encodeURIComponent(currentPreset.id)}`, {
      method: "POST",
      body: JSON.stringify({
        pack_id: getPackId(),
        pack_version: getPackVersion(),
        payload: merged,
        stage: currentStage,
      }),
    });

    currentPayload = merged;

    await previewPromptToDebug(currentStage, currentPayload).catch(() => {});
    setStatus("ok", "已保存");
  }

  async function previewPromptToDebug(stage, payload) {
    const pre = $("debugPrompt");
    if (!pre) return;

    const out = await httpjson(`${apiBase()}/preview`, {
      method: "POST",
      body: JSON.stringify({
        pack_id: getPackId(),
        pack_version: getPackVersion(),
        stage,
        payload,
        preset_id: currentPreset.id,
      }),
    });

    pre.textContent = out.prompt_text || "保存后将显示生成脚本预览";
  }

  /** =====================================================
   * UI CLEAR
   * ===================================================== */
  function clearPresetInfo() {
    currentPreset = null;
    currentPayload = {};
    currentStage = "S0";

    if ($("presetId")) $("presetId").value = "";
    if ($("presetStage")) $("presetStage").value = "";
    if ($("presetEnabled")) $("presetEnabled").value = "";
    if ($("saveHint")) $("saveHint").textContent = "请选择账号与角色后编辑。";
  }

  function clearForm() {
    const c = $("formContainer");
    if (c) c.innerHTML = `<div class="sub">当前阶段暂无可填写表单</div>`;
    if ($("debugPrompt")) $("debugPrompt").textContent = "保存后将显示生成脚本预览";
  }
})();




