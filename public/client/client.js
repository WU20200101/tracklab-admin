/* TrackLab Client (Refactor v2026-02-11)
 * - 基于你提供的“上一版 client.js”（不在你已改乱的版本上继续叠）
 * - 新增：从 GitHub Pages 根目录读取 config.json 自动设置 apiBase
 * - 新增：从 Worker 的 /packs/index 拉取 packId / packVersion 下拉选项（默认值由 index.json 决定）
 * - 保持：原有业务流程与接口调用逻辑不变（owner -> accounts -> presets -> preview/generate/feedback/outcome/stats）
 *
 * 约束对齐：
 * - 前端不做策略判断、不做 stage/pack 逻辑，只负责“取配置 + 展示 + 发请求”
 */

(() => {
  /** =====================================================
   * CONFIG
   * ===================================================== */
  const REMEMBER_LAST = false; // false = 完全不记忆

  const EMPTY_TEXT = "请选择";
  const LS_OWNER_KEY = "tracklab_owner_id";
  const LS_ACCOUNT_KEY = "tracklab_account_id";

  let currentPreset = null; // preset/get item
  let __inFlight = { preview: false, generate: false };

  // api base：由 ?api= 或 config.json 决定
  let __API_BASE = "";

  /** =====================================================
   * DOM HELPERS
   * ===================================================== */
  const $ = (id) => document.getElementById(id);

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

  function setPre(id, obj) {
    const el = $(id);
    if (!el) return;
    el.textContent =
      obj == null ? EMPTY_TEXT : typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  }

  /** =====================================================
   * STORAGE HELPERS
   * ===================================================== */
  function lsGet(key) {
    if (!REMEMBER_LAST) return "";
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }
  function lsSet(key, value) {
    if (!REMEMBER_LAST) return;
    try {
      localStorage.setItem(key, String(value ?? ""));
    } catch {}
  }
  function lsDel(key) {
    if (!REMEMBER_LAST) return;
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  /** =====================================================
   * HTTP
   * ===================================================== */
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
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data || {};
  }

  // 挂全局，兼容你其它页面/旧代码
  window.httpjson = httpJson;

  /** =====================================================
   * API BASE BOOT (config.json / ?api=)
   * ===================================================== */
  function ghPagesRepoRootPath() {
    const parts = location.pathname.split("/").filter(Boolean);
    // GitHub Pages project site: https://<user>.github.io/<repo>/...
    if (location.hostname.endsWith("github.io") && parts.length >= 1) {
      return `/${parts[0]}/`;
    }
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

    // 仅展示，不参与判断
    const el = $("apiBase");
    if (el) el.value = __API_BASE;
  }

  /** =====================================================
   * GETTERS
   * ===================================================== */
  function apiBase() {
    // 优先使用 bootApiBase 的结果；否则退回输入框（兼容旧用法）
    const v = (__API_BASE || $("apiBase")?.value || "").trim().replace(/\/+$/, "");
    if (!v) throw new Error("接口地址不能为空");
    return v;
  }

  function getPackId() {
    return ($("packId")?.value || "").trim();
  }

  function getPackVersion() {
    const el = $("packVer") || $("packVersion");
    if (!el) throw new Error("版本号缺失");
    const v = (el.value || "").trim();
    if (!v) throw new Error("版本号不能为空");
    return v;
  }

  function getOwnerIdStrict() {
    const v = ($("ownerId")?.value || "").trim();
    if (!v) throw new Error("用户名为空：先选择用户名");
    return v;
  }
  function getAccountIdStrict() {
    const v = ($("accountSelect")?.value || "").trim();
    if (!v) throw new Error("账号为空：先选择账号");
    return v;
  }
  function getPresetIdStrict() {
    const v = ($("presetSelect")?.value || "").trim();
    if (!v) throw new Error("角色为空：先选择角色");
    return v;
  }

  /** =====================================================
   * UI STATE
   * ===================================================== */
  function ensurePresetEnabledForOps() {
    if (!currentPreset) throw new Error("未加载角色");
    if (Number(currentPreset.enabled) !== 1) {
      throw new Error("该角色已淘汰，不可预览脚本、生成内容、填写反馈、填写交易记录");
    }
  }

  function applyEnabledUi(enabled) {
    const disabled = Number(enabled) !== 1;
    if ($("btnPreview")) $("btnPreview").disabled = disabled;
    if ($("btnGenerate")) $("btnGenerate").disabled = disabled;
    if ($("btnFeedbackUpsert")) $("btnFeedbackUpsert").disabled = disabled;
    if ($("btnOutcomeUpsert")) $("btnOutcomeUpsert").disabled = disabled;
  }

  function clearPresetsUI() {
    const sel = $("presetSelect");
    if (!sel) return;
    sel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = EMPTY_TEXT;
    sel.appendChild(empty);
    currentPreset = null;
  }

  function clearAccountsUI() {
    const sel = $("accountSelect");
    if (!sel) return;
    sel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = EMPTY_TEXT;
    sel.appendChild(empty);
  }

  function todayYMD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function ensureDateDefault(id) {
    const el = $(id);
    if (el && !el.value) el.value = todayYMD();
  }

    /** =====================================================
   * STRUCTURE VARIANTS DECORATOR (pack-agnostic, no Worker change)
   * ===================================================== */
  const STRUCT_HISTORY_KEY_PREFIX = "structure_hist:";

  function getStructHistoryKey(accountId, presetId) {
    return `${STRUCT_HISTORY_KEY_PREFIX}${accountId || "na"}:${presetId || "na"}`;
  }

  function getLastTwoFromLS(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(-2) : [];
    } catch {
      return [];
    }
  }

  function setLastTwoToLS(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify((arr || []).slice(-2)));
    } catch {}
  }

  function getLocalCounter(key) {
    const k = `structure_ctr:${key}`;
    try {
      const raw = localStorage.getItem(k);
      const n = raw ? parseInt(raw, 10) : 0;
      const next = Number.isFinite(n) ? n + 1 : 1;
      localStorage.setItem(k, String(next));
      return next;
    } catch {
      return 1;
    }
  }

  function todayBucket() {
    // YYYY-MM-DD
    return todayYMD();
  }

  // FNV-1a 32-bit
  function hash32FNV1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function hashToUnitInterval(seedStr) {
    return hash32FNV1a(seedStr) / 4294967296;
  }

  function normalizeWeights(weightsRaw) {
    if (!weightsRaw || typeof weightsRaw !== "object") return null;
    const out = {};
    let sum = 0;

    for (const [k, v] of Object.entries(weightsRaw)) {
      const num = typeof v === "number" ? v : parseFloat(v);
      if (Number.isFinite(num) && num > 0) {
        out[k] = num;
        sum += num;
      }
    }
    if (sum <= 0) return null;

    for (const k of Object.keys(out)) out[k] = out[k] / sum;

    // fix floating diff by adjusting the max key
    let s2 = 0;
    let maxK = null;
    let maxV = -Infinity;
    for (const [k, v] of Object.entries(out)) {
      s2 += v;
      if (v > maxV) {
        maxV = v;
        maxK = k;
      }
    }
    const diff = 1 - s2;
    if (maxK) out[maxK] = out[maxK] + diff;

    return out;
  }

  function weightedPick(weightsNorm, u01) {
    const entries = Object.entries(weightsNorm).sort((a, b) => a[0].localeCompare(b[0]));
    let acc = 0;
    for (const [k, w] of entries) {
      acc += w;
      if (u01 < acc) return k;
    }
    return entries.length ? entries[entries.length - 1][0] : null;
  }

  function buildInjectedFreeText(structureBlock, userNote) {
  const s = (structureBlock || "").trim();
  const note = (userNote || "").trim();

  if (!s && !note) return "";
  if (s && !note) return `${s}\n`;
  if (!s && note) return note;

  // 仍保留分层，但不使用显眼标签；用空行做弱分隔
  return `${s}\n\n${note}\n`;
}

  async function fetchPackStructures(pack_id, pack_version) {
    // 用 /packs/index 来发现可用的 public_base（如果 index 没给，就先按约定路径尝试）
    const idx = await httpJson(`${apiBase()}/packs/index`, { method: "GET" });

    // 推荐：worker 的 index.json 若提供 public_base（例如 https://.../tracklab-packs），则用它
    const publicBase =
      (idx && idx.public_base && String(idx.public_base).trim().replace(/\/+$/, "")) || "";

    const tryUrls = [
  // 新增：直接命中 Worker 透传路径（这是现在唯一可用路径）
  `${apiBase()}/pack/${encodeURIComponent(pack_id)}/${encodeURIComponent(pack_version)}/prompt/structures.json`,
];


    for (const url of tryUrls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const json = await res.json();
        if (!json || json.enabled !== true) continue;
        if (!json.variants || !json.inject_target) continue;
        return json;
      } catch {
        // continue
      }
    }
    return null;
  }

  async function decoratePayloadWithStructure({ payload, preset, pack_id, pack_version }) {
    const packStruct = await fetchPackStructures(pack_id, pack_version);
    if (!packStruct) return payload;

    const injectTarget = packStruct.inject_target || "free_text";
    const variants = packStruct.variants || {};
    const defaultWeights = packStruct.default_weights || null;

    const levelKey = preset?.level || preset?.preset_level || "L0";

    // preset 权重优先：preset.meta.structure_weights[levelKey]
    const presetMeta = preset?.meta || null;
    const presetWeightsRaw =
      presetMeta?.structure_weights && presetMeta.structure_weights[levelKey]
        ? presetMeta.structure_weights[levelKey]
        : null;

    const weightsNorm = normalizeWeights(presetWeightsRaw) || normalizeWeights(defaultWeights);
    if (!weightsNorm) return payload;

    const accountId = preset?.account_id || getAccountIdStrict();
    const presetId = preset?.id || preset?.preset_id || getPresetIdStrict();

    const day = todayBucket();
    const counterKey = `${accountId}|${presetId}|${levelKey}|${day}`;
    const seq = getLocalCounter(counterKey);
    const baseSeed = `${accountId}|${presetId}|${levelKey}|${day}|${seq}`;

    const historyKey = getStructHistoryKey(accountId, presetId);
    const lastTwo = getLastTwoFromLS(historyKey);

    const pickOnce = (suffix) => {
      const u = hashToUnitInterval(`${baseSeed}${suffix || ""}`);
      return weightedPick(weightsNorm, u);
    };

    let pick = pickOnce("");
    if (!pick || !variants[pick]?.block) {
      const keys = Object.keys(variants);
      pick = keys.length ? keys[0] : null;
    }

    // 禁止连续 3 次：如果最近两次都是 pick，则重抽一次
    if (pick && lastTwo.length === 2 && lastTwo[0] === pick && lastTwo[1] === pick) {
      const retry = pickOnce("|retry1");
      if (retry && variants[retry]?.block) pick = retry;
    }

    if (pick) {
      setLastTwoToLS(historyKey, [...lastTwo, pick]);
    }

    const nextPayload = { ...payload };
    const original = nextPayload[injectTarget] || "";
    const structureBlock = pick && variants[pick] ? variants[pick].block : "";
    nextPayload[injectTarget] = buildInjectedFreeText(structureBlock, original);

    return nextPayload;
  }

  /** =====================================================
   * PACK SELECTORS (from /packs/index)
   * ===================================================== */
  async function bootPackSelectors() {
    const packSel = $("packId");
    const verSel = $("packVer") || $("packVersion");
    if (!packSel || !verSel) return; // 页面没有这俩控件就不处理

    // 拉 index
    const idx = await httpJson(`${apiBase()}/packs/index`, { method: "GET" });
    const packs = Array.isArray(idx.packs) ? idx.packs : [];
    const defPackId = idx?.default?.pack_id || "";
    const defVer = idx?.default?.pack_version || "";

    // pack 下拉
    packSel.innerHTML = "";
    const p0 = document.createElement("option");
    p0.value = "";
    p0.textContent = "请选择";
    packSel.appendChild(p0);

    packs.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = String(p.pack_id || "").trim();
      opt.textContent = String(p.label || p.pack_id || "").trim();
      packSel.appendChild(opt);
    });

    // 版本联动渲染（仅展示）
    function renderVersionsFor(packId) {
      verSel.innerHTML = "";
      const v0 = document.createElement("option");
      v0.value = "";
      v0.textContent = "请选择";
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

    // 默认选择：完全由 index.json 决定（前端不判断）
    if (defPackId) packSel.value = defPackId;
    renderVersionsFor(packSel.value);
    if (defVer) verSel.value = defVer;

    // 绑定变化：只更新版本下拉，不做任何策略
    packSel.addEventListener("change", () => {
      renderVersionsFor(packSel.value);
      clearAccountsUI();
      clearPresetsUI();
      setPre("accountOut", null);
      setPre("presetOut", null);
      setStatus("info", "pack 已切换：请重新选择用户名/账号/角色");
    });
  }

  /** =====================================================
   * LOADERS
   * ===================================================== */
  async function loadOwners() {
    const sel = $("ownerId");
    if (!sel) return;

    sel.innerHTML = `<option value="">请选择</option>`;
    sel.value = "";

    const out = await httpJson(`${apiBase()}/user/list?enabled=1`, { method: "GET" });
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

  async function accountList() {
    const owner_id = getOwnerIdStrict();
    const pack_id = getPackId();
    const pack_version = getPackVersion();

    const url =
      `${apiBase()}/account/list` +
      `?owner_id=${encodeURIComponent(owner_id)}` +
      `&pack_id=${encodeURIComponent(pack_id)}` +
      `&pack_version=${encodeURIComponent(pack_version)}` +
      `&enabled=1`;

    setStatus("info", "账号刷新中…");
    const out = await httpJson(url, { method: "GET" });

    const items = out.items || [];
    const sel = $("accountSelect");
    if (!sel) return;

    sel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = EMPTY_TEXT;
    sel.appendChild(empty);

    items.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = it.id;
      opt.textContent = `${it.handle || "(no handle)"} (${it.updated_at || ""})`;
      sel.appendChild(opt);
    });

    setPre("accountOut", out);

    const savedAccount = lsGet(LS_ACCOUNT_KEY) || "";
    if (savedAccount && items.some((x) => x.id === savedAccount)) {
      sel.value = savedAccount;
    }

    setStatus("ok", `Accounts：${items.length} 个`);
  }

  async function presetRefreshList() {
    const pack_id = getPackId();
    const pack_version = getPackVersion();
    const stage = $("stageFilter")?.value || "";
    const enabled = $("enabledOnly")?.value ?? "";

    const account_id = ($("accountSelect")?.value || "").trim();

    let url =
      `${apiBase()}/preset/list?pack_id=${encodeURIComponent(pack_id)}` +
      `&pack_version=${encodeURIComponent(pack_version)}`;

    if (stage) url += `&stage=${encodeURIComponent(stage)}`;
    if (enabled !== "") url += `&enabled=${encodeURIComponent(enabled)}`;
    if (account_id) url += `&account_id=${encodeURIComponent(account_id)}`;

    setStatus("info", "角色刷新中…");
    const out = await httpJson(url, { method: "GET" });
    const items = out.items || [];

    const sel = $("presetSelect");
    if (!sel) return;

    sel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";

    if (!account_id) empty.textContent = "请选择有效账号";
    else if (items.length === 0) empty.textContent = "当前筛选条件无角色";
    else empty.textContent = "请选择";

    sel.appendChild(empty);

    items.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = it.id;
      opt.textContent = `${it.name} [${it.stage}] (${it.updated_at || ""})`;
      sel.appendChild(opt);
    });

    setPre("presetOut", { ok: true, items_count: items.length });
    setStatus("ok", `Presets：${items.length} 条`);
  }

  async function presetLoad() {
    const preset_id = getPresetIdStrict();
    const url =
      `${apiBase()}/preset/get?preset_id=${encodeURIComponent(preset_id)}` +
      `&pack_id=${encodeURIComponent(getPackId())}` +
      `&pack_version=${encodeURIComponent(getPackVersion())}`;

    setStatus("info", "加载 preset 状态中…");
    const out = await httpJson(url, { method: "GET" });
    if (!out.item) throw new Error("preset_get 返回为空");

    currentPreset = out.item;
    setPre("presetOut", out.item);
    setStatus("ok", `Preset 已加载：${out.item.name || out.item.id}`);
    applyEnabledUi(out.item.enabled);
  }

  /** =====================================================
   * ACTIONS
   * ===================================================== */
  async function accountCreate() {
    const owner_id = getOwnerIdStrict();
    const handle = ($("accountHandle")?.value || "").trim() || null;

    const body = {
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      owner_id,
      handle,
      note: null,
    };

    setStatus("info", "账号创建中…");
    const out = await httpJson(`${apiBase()}/account/create`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setPre("accountOut", out);
    setStatus("ok", `账号已创建：${out?.account?.id || "na"}`);

    await accountList();

    if (out?.account?.id && $("accountSelect")) {
      $("accountSelect").value = out.account.id;
      lsSet(LS_ACCOUNT_KEY, out.account.id);
    }

    await presetRefreshList();
  }

  async function presetBindAccount() {
    const preset_id = getPresetIdStrict();
    const account_id = getAccountIdStrict();

    const body = {
      preset_id,
      account_id,
      pack_id: getPackId(),
      pack_version: getPackVersion(),
    };

    setStatus("info", "绑定 preset → account 中…");
    const out = await httpJson(`${apiBase()}/preset/bind_account`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setPre("accountOut", out);
    setStatus("ok", "绑定完成");

    await presetRefreshList();
  }

  async function previewPrompt() {
    if (__inFlight.preview) return;
    __inFlight.preview = true;

    try {
      const preset_id = getPresetIdStrict();
      if (!currentPreset?.id || currentPreset.id !== preset_id) await presetLoad();
      ensurePresetEnabledForOps();

            const pack_id = getPackId();
      const pack_version = getPackVersion();

      const decoratedPayload = await decoratePayloadWithStructure({
        payload: currentPreset.payload,
        preset: currentPreset,
        pack_id,
        pack_version,
      });

      const out = await httpJson(`${apiBase()}/preview`, {
        method: "POST",
        body: JSON.stringify({
          pack_id,
          pack_version,
          preset_id,
          stage: currentPreset.stage,
          payload: decoratedPayload,
        }),
      });

      setPre("previewOut", out?.prompt_text || JSON.stringify(out, null, 2));
      setStatus("ok", "Preview 成功");
    } finally {
      __inFlight.preview = false;
    }
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
    }
    return null;
  }

  function normalizeTags(v) {
    if (v == null) return "";
    if (Array.isArray(v))
      return v
        .map(String)
        .map((x) => (x.startsWith("#") ? x : `#${x}`))
        .join(" ");
    const s = String(v).trim();
    if (!s) return "";
    const parts = s.split(/[\s,，]+/).filter(Boolean);
    if (parts.length <= 1) return s.startsWith("#") ? s : `#${s}`;
    return parts.map((x) => (x.startsWith("#") ? x : `#${x}`)).join(" ");
  }

  function formatClientText(outputObj) {
    const title = pick(outputObj, ["title", "标题"]) ?? "";
    const subtitle = pick(outputObj, ["subtitle", "副标题", "sub_title"]) ?? "";
    const content = pick(outputObj, ["content", "正文", "内容", "body", "text"]) ?? "";
    const tags = normalizeTags(pick(outputObj, ["tags", "标签", "hashtags"]));
    return `标题：${title}\n副标题：${subtitle}\n--------\n正文：\n${content}\n--------\n标签：${tags}`;
  }

  async function generateContent() {
    if (__inFlight.generate) return;
    __inFlight.generate = true;

    const btn = document.getElementById("btnGenerate");
    if (btn) btn.disabled = true;

    try {
      const preset_id = getPresetIdStrict();
      if (!currentPreset?.id || currentPreset.id !== preset_id) await presetLoad();
      ensurePresetEnabledForOps();

      setStatus("info", "Generate 中…");

            const pack_id = getPackId();
      const pack_version = getPackVersion();

      const decoratedPayload = await decoratePayloadWithStructure({
        payload: currentPreset.payload,
        preset: currentPreset,
        pack_id,
        pack_version,
      });

      const out = await httpJson(`${apiBase()}/generate`, {
        method: "POST",
        body: JSON.stringify({
          pack_id,
          pack_version,
          preset_id,
          stage: currentPreset.stage,
          payload: decoratedPayload,
        }),
      });

      setPre("genRaw", out);

      const text = out.output_text || out.outputText;
      if (typeof text === "string" && text.trim()) {
        setPre("genText", text);
      } else {
        const outputObj = out.output || out.output_json || {};
        setPre("genText", typeof outputObj === "string" ? outputObj : JSON.stringify(outputObj, null, 2));
      }

      setStatus("ok", `Generate 完成：job_id=${out?.job_id || "na"}`);
    } finally {
      __inFlight.generate = false;
      if (btn) btn.disabled = false;
    }
  }

  function readNonNegInt(id) {
    const v = ($(id)?.value ?? "").toString().trim();
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.trunc(n);
  }

  function renderEvaluationReadable(evaluation) {
    if (!evaluation) return "（暂无评估结果）";

    const actionMap = {
      advance: "✅ 达到升级条件（将进入下一阶段）",
      observe: "⏳ 继续观察（暂不升级）",
      disable: "⛔ 判定为淘汰（不再参与后续生成）",
      none: "ℹ️ 数据不足，尚未触发评估动作",
    };

    const lines = [];
    lines.push(`【评估结论】`);
    lines.push(actionMap[evaluation.action] || evaluation.action);
    lines.push("");

    if (evaluation.metrics) {
      const m = evaluation.metrics;
      lines.push("【数据概览】");
      lines.push(`- 已运行天数：${m.age_days} 天`);
      lines.push(`- 发布内容数：${m.posts}`);
      lines.push(`- 浏览量：${m.views}`);
      lines.push(`- 点赞量：${m.likes}`);
      lines.push(`- 收藏量：${m.collects}`);
      lines.push(`- 评论量：${m.comments}`);
      lines.push(`- 私信量：${m.dm_inbound}`);
      lines.push(`- 总互动数：${m.interactions}`);
      lines.push("");
    }

    if (evaluation.window) {
      const w = evaluation.window;
      lines.push("【评估周期】");
      lines.push(`- 周期总数：${w.max_windows} 个`);
      lines.push(`- 每个评估周期：${w.window_days} 天`);
      lines.push(`- 当前周期：第 ${w.window_index} 个`);
    }

    return lines.join("\n");
  }

  async function feedbackUpsert() {
    const preset_id = getPresetIdStrict();
    ensureDateDefault("fbDate");

    const date = ($("fbDate")?.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date 格式必须为 YYYY-MM-DD");

    const body = {
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      preset_id,
      date,
      totals: {
        posts: readNonNegInt("fbPosts"),
        views: readNonNegInt("fbViews"),
        likes: readNonNegInt("fbLikes"),
        collects: readNonNegInt("fbCollects"),
        comments: readNonNegInt("fbComments"),
        dm_inbound: readNonNegInt("fbDmInbound"),
      },
      note: ($("fbNote")?.value || "").trim() || null,
    };

    setStatus("info", "feedback/upsert 提交中…");
    const out = await httpJson(`${apiBase()}/feedback/upsert`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setPre("evalOut", renderEvaluationReadable(out?.evaluation));
    try {
      await presetLoad();
    } catch {}

    setStatus("ok", `feedback 已写入；action=${out?.evaluation?.action || "none"}`);
  }

  function renderOutcomeUpsertReadable(resp, body) {
    if (!resp) return "（无返回）";
    const ok = resp.ok === true;
    const windowLabelMap = { daily: "每日", weekly: "每周", monthly: "每月" };
    const windowLabel = windowLabelMap[body?.window] || (body?.window || "");

    const leadCreated = Number(body?.lead_created || 0);
    const paid = Number(body?.paid || 0);
    const amountYuan = Number(body?.amount_yuan || 0);
    const amount = amountYuan.toFixed(2);
    const leadsCount = Number(body?.leads_count || 0);
    const note = (body?.note || "").trim();

    const lines = [];
    lines.push("【交易记录提交】");
    lines.push(ok ? "✅ 已保存" : "⚠️ 未确认保存");
    lines.push("");
    if (body?.date) lines.push(`- 日期：${body.date}`);
    if (windowLabel) lines.push(`- 统计周期：${windowLabel}`);
    lines.push(`- 新增客户：${leadCreated ? "是" : "否"}`);
    lines.push(`- 新增成交：${paid ? "是" : "否"}`);
    if (paid) lines.push(`- 成交金额：${amount}元`);
    if (leadsCount) lines.push(`- 新增客户数量：${leadsCount}`);
    if (note) {
      lines.push("");
      lines.push(`备注：${note}`);
    }
    return lines.join("\n");
  }

  async function outcomeUpsert() {
    const preset_id = getPresetIdStrict();
    const account_id = getAccountIdStrict();
    ensureDateDefault("ocDate");

    const date = ($("ocDate")?.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Outcome date 格式必须为 YYYY-MM-DD");

    if (!currentPreset?.id || currentPreset.id !== preset_id) await presetLoad();
    ensurePresetEnabledForOps();

    const leadCreated = Number($("ocLeadCreated")?.value || 0);
    const paid = Number($("ocPaid")?.value || 0);

    let leadsCount = Number($("ocLeadsCount")?.value || 0);
    let amountYuan = Number($("ocAmountYuan")?.value || 0);

    if (leadCreated !== 1) leadsCount = 0;
    if (paid !== 1) amountYuan = 0;

    const body = {
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      account_id,
      preset_id,
      job_id: null,
      date,
      window: $("ocWindow")?.value || "daily",
      lead_created: leadCreated,
      paid: paid,
      amount_yuan: amountYuan,
      leads_count: leadsCount,
      note: ($("ocNote")?.value || "").trim() || null,
    };

    setStatus("info", "outcome/upsert 提交中…");
    const out = await httpJson(`${apiBase()}/outcome/upsert`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setPre("outcomeOut", renderOutcomeUpsertReadable(out, body));
    setStatus("ok", "Outcome 已写入");
  }

  async function statsPreset() {
    const preset_id = getPresetIdStrict();
    setStatus("info", "拉取 stats/preset 中…");
    const url = `${apiBase()}/stats/preset?preset_id=${encodeURIComponent(preset_id)}`;
    const out = await httpJson(url, { method: "GET" });
    setPre("statsOut", out);
    setStatus("ok", "Stats 已更新");
  }

  /** =====================================================
   * EVENT HANDLERS
   * ===================================================== */
  function showError(e) {
    console.error(e);
    setStatus("error", e?.message || String(e));
  }

  async function handleOwnerChanged() {
    const owner = ($("ownerId")?.value || "").trim();
    lsSet(LS_OWNER_KEY, owner);
    lsDel(LS_ACCOUNT_KEY);

    clearAccountsUI();
    clearPresetsUI();

    if (!owner) return;

    await accountList();

    const currentAccount = ($("accountSelect")?.value || "").trim();
    if (currentAccount) lsSet(LS_ACCOUNT_KEY, currentAccount);

    if (currentAccount) await presetRefreshList();
  }

  async function handleAccountChanged() {
    const account = ($("accountSelect")?.value || "").trim();
    lsSet(LS_ACCOUNT_KEY, account);

    clearPresetsUI();
    if (!account) return;

    await presetRefreshList();
  }

  /** =====================================================
   * INIT
   * ===================================================== */
  function setDefaults() {
    // 不再硬编码 apiBase/packId/packVer：由 bootApiBase + /packs/index 决定
    const setVal = (id, val) => {
      const el = $(id);
      if (el) el.value = val;
    };

    // 兼容：如果页面没有 config.json 或你要临时 override，可手工填输入框
    if ($("apiBase") && $("apiBase").value) {
      // 保留用户输入
    } else {
      setVal("apiBase", "");
    }

    setVal("enabledOnly", "1");

    if ($("fbDate")) ensureDateDefault("fbDate");
    if ($("ocDate")) ensureDateDefault("ocDate");
  }

  function bindEvents() {
    $("ownerId")?.addEventListener("change", () => handleOwnerChanged().catch(showError));
    $("accountSelect")?.addEventListener("change", () => handleAccountChanged().catch(showError));
    $("presetSelect")?.addEventListener("change", () => presetLoad().catch(showError));

    $("stageFilter")?.addEventListener("change", () => presetRefreshList().catch(showError));
    $("enabledOnly")?.addEventListener("change", () => presetRefreshList().catch(showError));

    $("btnAccountRefresh")?.addEventListener("click", () => accountList().catch(showError));
    $("btnAccountCreate")?.addEventListener("click", () => accountCreate().catch(showError));

    $("btnPresetRefresh")?.addEventListener("click", () => presetRefreshList().catch(showError));
    $("btnPresetLoad")?.addEventListener("click", () => presetLoad().catch(showError));
    $("btnPresetBindAccount")?.addEventListener("click", () => presetBindAccount().catch(showError));

    $("btnPreview")?.addEventListener("click", () => previewPrompt().catch(showError));
    $("btnGenerate")?.addEventListener("click", () => generateContent().catch(showError));

    $("btnFeedbackUpsert")?.addEventListener("click", () => feedbackUpsert().catch(showError));
    $("btnOutcomeUpsert")?.addEventListener("click", () => outcomeUpsert().catch(showError));
    $("btnStatsPreset")?.addEventListener("click", () => statsPreset().catch(showError));
  }

  async function boot() {
    setDefaults();
    bindEvents();

    setStatus("info", "初始化 api_base 中…");
    await bootApiBase();

    setStatus("info", "初始化 pack 列表中…");
    await bootPackSelectors();

    setStatus("info", "初始化 owners 中…");
    await loadOwners();

    const savedOwner = lsGet(LS_OWNER_KEY) || "";
    if (savedOwner && $("ownerId")) {
      $("ownerId").value = savedOwner;
      await handleOwnerChanged();
    }

    setStatus("ok", "就绪");
  }

  boot().catch(showError);
})();




