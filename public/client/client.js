(() => {
  const REMEMBER_LAST = false;

  const EMPTY_TEXT = "请选择";
  const LS_OWNER_KEY = "tracklab_owner_id";
  const LS_ACCOUNT_KEY = "tracklab_account_id";

  let currentPreset = null;

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
    const el = $("js-status");
    if (!el) return;

    el.className = "ui-status " + (
      type === "ok" ? "ui-status--ok" :
      type === "error" ? "ui-status--err" :
      type === "warn" ? "ui-status--warn" :
      "ui-status--info"
    );

    el.textContent = msg || "";
  }

  function setPre(id, obj) {
    const el = $(id);
    if (!el) return;
    el.textContent =
      obj == null ? EMPTY_TEXT : typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  }

  function lsGet(key) {
    if (!REMEMBER_LAST) return "";
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  }
  function lsSet(key, value) {
    if (!REMEMBER_LAST) return;
    try { localStorage.setItem(key, String(value ?? "")); } catch {}
  }
  function lsDel(key) {
    if (!REMEMBER_LAST) return;
    try { localStorage.removeItem(key); } catch {}
  }

  async function httpJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data || {};
  }

  function apiBase() {
    const v = ($("js-api-base")?.value || "").trim().replace(/\/+$/, "");
    if (!v) throw new Error("接口地址不能为空");
    return v;
  }
  function getPackId() { return $("js-pack-id")?.value || ""; }
  function getPackVersion() { return ($("js-pack-version")?.value || "").trim(); }

  function getOwnerIdStrict() {
    const v = ($("js-owner-select")?.value || "").trim();
    if (!v) throw new Error("用户名为空：先选择用户名");
    return v;
  }
  function getAccountIdStrict() {
    const v = ($("js-account-select")?.value || "").trim();
    if (!v) throw new Error("账号为空：先选择账号");
    return v;
  }
  function getPresetIdStrict() {
    const v = ($("js-preset-select")?.value || "").trim();
    if (!v) throw new Error("角色为空：先选择角色");
    return v;
  }

  function ensurePresetEnabledForOps() {
    if (!currentPreset) throw new Error("未加载角色");
    if (Number(currentPreset.enabled) !== 1) throw new Error("该角色已淘汰，不可操作");
  }

  function applyEnabledUi(enabled) {
    const disabled = Number(enabled) !== 1;
    if ($("js-preview-btn")) $("js-preview-btn").disabled = disabled;
    if ($("js-generate-btn")) $("js-generate-btn").disabled = disabled;
    if ($("js-feedback-submit-btn")) $("js-feedback-submit-btn").disabled = disabled;
    if ($("js-outcome-submit-btn")) $("js-outcome-submit-btn").disabled = disabled;
  }

  function clearPresetsUI() {
    const sel = $("js-preset-select");
    if (!sel) return;
    sel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = EMPTY_TEXT;
    sel.appendChild(empty);
    currentPreset = null;
  }

  function clearAccountsUI() {
    const sel = $("js-account-select");
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

  async function loadOwners() {
    const sel = $("js-owner-select");
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
    const sel = $("js-account-select");
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

    setPre("js-account-out", out);

    const savedAccount = lsGet(LS_ACCOUNT_KEY) || "";
    if (savedAccount && items.some((x) => x.id === savedAccount)) sel.value = savedAccount;

    setStatus("ok", `Accounts：${items.length} 个`);
  }

  async function presetRefreshList() {
    const pack_id = getPackId();
    const pack_version = getPackVersion();
    const stage = $("js-stage-filter")?.value || "";
    const enabled = $("js-preset-enabled-filter")?.value ?? "";

    const account_id = ($("js-account-select")?.value || "").trim();

    let url =
      `${apiBase()}/preset/list?pack_id=${encodeURIComponent(pack_id)}` +
      `&pack_version=${encodeURIComponent(pack_version)}`;

    if (stage) url += `&stage=${encodeURIComponent(stage)}`;
    if (enabled !== "") url += `&enabled=${encodeURIComponent(enabled)}`;
    if (account_id) url += `&account_id=${encodeURIComponent(account_id)}`;

    setStatus("info", "角色刷新中…");
    const out = await httpJson(url, { method: "GET" });
    const items = out.items || [];

    const sel = $("js-preset-select");
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

    setPre("js-preset-out", { ok: true, items_count: items.length, items });
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
    setPre("js-preset-out", out.item);
    setStatus("ok", `Preset 已加载：${out.item.name || out.item.id}`);
    applyEnabledUi(out.item.enabled);
  }

  async function accountCreate() {
    const owner_id = getOwnerIdStrict();
    const handle = ($("js-account-handle")?.value || "").trim() || null;

    const body = { pack_id: getPackId(), pack_version: getPackVersion(), owner_id, handle, note: null };

    setStatus("info", "账号创建中…");
    const out = await httpJson(`${apiBase()}/account/create`, { method: "POST", body: JSON.stringify(body) });

    setPre("js-account-out", out);
    setStatus("ok", `账号已创建：${out?.account?.id || "na"}`);

    await accountList();

    if (out?.account?.id && $("js-account-select")) {
      $("js-account-select").value = out.account.id;
      lsSet(LS_ACCOUNT_KEY, out.account.id);
    }

    await presetRefreshList();
  }

  async function presetBindAccount() {
    const preset_id = getPresetIdStrict();
    const account_id = getAccountIdStrict();

    const body = { preset_id, account_id, pack_id: getPackId(), pack_version: getPackVersion() };

    setStatus("info", "绑定 preset → account 中…");
    const out = await httpJson(`${apiBase()}/preset/bind_account`, { method: "POST", body: JSON.stringify(body) });

    setPre("js-account-out", out);
    setStatus("ok", "绑定完成");
    await presetRefreshList();
  }

  async function previewPrompt() {
    if (!currentPreset?.id) await presetLoad();
    ensurePresetEnabledForOps();

    const out = await httpJson(`${apiBase()}/preview`, {
      method: "POST",
      body: JSON.stringify({
        pack_id: getPackId(),
        pack_version: getPackVersion(),
        stage: currentPreset.stage,
        payload: currentPreset.payload,
      }),
    });

    setPre("js-preview-out", out?.prompt_text || JSON.stringify(out, null, 2));
    setStatus("ok", "Preview 成功");
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
    }
    return null;
  }
  function normalizeTags(v) {
    if (v == null) return "";
    if (Array.isArray(v)) return v.map(String).map((x) => (x.startsWith("#") ? x : `#${x}`)).join(" ");
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
    const preset_id = getPresetIdStrict();

    if (!currentPreset?.id || currentPreset.id !== preset_id) await presetLoad();
    ensurePresetEnabledForOps();

    setStatus("info", "Generate 中…");
    const out = await httpJson(`${apiBase()}/generate`, {
      method: "POST",
      body: JSON.stringify({ pack_id: getPackId(), pack_version: getPackVersion(), preset_id }),
    });

    setPre("js-gen-raw", out);
    setPre("js-gen-text", formatClientText(out?.output || {}));

    setStatus("ok", `Generate 完成：job_id=${out?.job_id || "na"}`);
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
    ensureDateDefault("js-fb-date");

    const date = ($("js-fb-date")?.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date 格式必须为 YYYY-MM-DD");

    const body = {
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      preset_id,
      date,
      totals: {
        posts: readNonNegInt("js-fb-posts"),
        views: readNonNegInt("js-fb-views"),
        likes: readNonNegInt("js-fb-likes"),
        collects: readNonNegInt("js-fb-collects"),
        comments: readNonNegInt("js-fb-comments"),
        dm_inbound: readNonNegInt("js-fb-dm"),
      },
      note: ($("js-fb-note")?.value || "").trim() || null,
    };

    setStatus("info", "feedback/upsert 提交中…");
    const out = await httpJson(`${apiBase()}/feedback/upsert`, { method: "POST", body: JSON.stringify(body) });

    setPre("js-eval-out", renderEvaluationReadable(out?.evaluation));
    try { await presetLoad(); } catch {}
    setStatus("ok", `feedback 已写入；action=${out?.evaluation?.action || "none"}`);
  }

  function renderOutcomeUpsertReadable(resp, body) {
    if (!resp) return "（无返回）";
    const ok = resp.ok === true;
    const windowLabelMap = { daily: "每日", weekly: "每周", monthly: "每月" };
    const windowLabel = windowLabelMap[body?.window] || (body?.window || "");

    const leadCreated = Number(body?.lead_created || 0);
    const paid = Number(body?.paid || 0);
    const amountYuan = Number(body?.amount_yuan || 0).toFixed(2);
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
    if (paid) lines.push(`- 成交金额：${amountYuan}元`);
    if (leadsCount) lines.push(`- 新增客户数量：${leadsCount}`);
    if (note) { lines.push(""); lines.push(`备注：${note}`); }
    return lines.join("\n");
  }

  async function outcomeUpsert() {
    const preset_id = getPresetIdStrict();
    const account_id = getAccountIdStrict();
    ensureDateDefault("js-oc-date");

    const date = ($("js-oc-date")?.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Outcome date 格式必须为 YYYY-MM-DD");

    if (!currentPreset?.id || currentPreset.id !== preset_id) await presetLoad();
    ensurePresetEnabledForOps();

    const leadCreated = Number($("js-oc-lead-created")?.value || 0);
    const paid = Number($("js-oc-paid")?.value || 0);

    let leadsCount = Number($("js-oc-leads-count")?.value || 0);
    let amountYuan = Number($("js-oc-amount")?.value || 0);

    if (leadCreated !== 1) leadsCount = 0;
    if (paid !== 1) amountYuan = 0;

    const body = {
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      account_id,
      preset_id,
      job_id: null,
      date,
      window: $("js-oc-window")?.value || "daily",
      lead_created: leadCreated,
      paid,
      amount_yuan: amountYuan,
      leads_count: leadsCount,
      note: ($("js-oc-note")?.value || "").trim() || null,
    };

    setStatus("info", "outcome/upsert 提交中…");
    const out = await httpJson(`${apiBase()}/outcome/upsert`, { method: "POST", body: JSON.stringify(body) });

    setPre("js-outcome-out", renderOutcomeUpsertReadable(out, body));
    setStatus("ok", "Outcome 已写入");
  }

  async function statsPreset() {
    const preset_id = getPresetIdStrict();
    setStatus("info", "拉取 stats/preset 中…");
    const url = `${apiBase()}/stats/preset?preset_id=${encodeURIComponent(preset_id)}`;
    const out = await httpJson(url, { method: "GET" });
    setPre("js-stats-out", out);
    setStatus("ok", "Stats 已更新");
  }

  function showError(e) { console.error(e); setStatus("error", e?.message || String(e)); }

  async function handleOwnerChanged() {
    const owner = ($("js-owner-select")?.value || "").trim();
    lsSet(LS_OWNER_KEY, owner);
    lsDel(LS_ACCOUNT_KEY);

    clearAccountsUI();
    clearPresetsUI();

    if (!owner) return;

    await accountList();

    const currentAccount = ($("js-account-select")?.value || "").trim();
    if (currentAccount) lsSet(LS_ACCOUNT_KEY, currentAccount);

    if (currentAccount) await presetRefreshList();
  }

  async function handleAccountChanged() {
    const account = ($("js-account-select")?.value || "").trim();
    lsSet(LS_ACCOUNT_KEY, account);

    clearPresetsUI();
    if (!account) return;

    await presetRefreshList();
  }

  function setDefaults() {
    if ($("js-api-base")) $("js-api-base").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
  }

  function bindEvents() {
    $("js-owner-select")?.addEventListener("change", () => handleOwnerChanged().catch(showError));
    $("js-account-select")?.addEventListener("change", () => handleAccountChanged().catch(showError));
    $("js-preset-select")?.addEventListener("change", () => presetLoad().catch(showError));

    $("js-stage-filter")?.addEventListener("change", () => presetRefreshList().catch(showError));
    $("js-preset-enabled-filter")?.addEventListener("change", () => presetRefreshList().catch(showError));

    $("js-account-refresh-btn")?.addEventListener("click", () => accountList().catch(showError));
    $("js-account-create-btn")?.addEventListener("click", () => accountCreate().catch(showError));

    $("js-preset-refresh-btn")?.addEventListener("click", () => presetRefreshList().catch(showError));
    $("js-preset-load-btn")?.addEventListener("click", () => presetLoad().catch(showError));
    $("js-preset-bind-account-btn")?.addEventListener("click", () => presetBindAccount().catch(showError));

    $("js-preview-btn")?.addEventListener("click", () => previewPrompt().catch(showError));
    $("js-generate-btn")?.addEventListener("click", () => generateContent().catch(showError));

    $("js-feedback-submit-btn")?.addEventListener("click", () => feedbackUpsert().catch(showError));
    $("js-outcome-submit-btn")?.addEventListener("click", () => outcomeUpsert().catch(showError));
    $("js-stats-btn")?.addEventListener("click", () => statsPreset().catch(showError));
  }

  async function boot() {
    setDefaults();
    bindEvents();

    setStatus("info", "初始化 owners 中…");
    await loadOwners();

    const savedOwner = lsGet(LS_OWNER_KEY) || "";
    if (savedOwner && $("js-owner-select")) {
      $("js-owner-select").value = savedOwner;
      await handleOwnerChanged();
    }

    setStatus("ok", "就绪");
  }

  boot().catch(showError);
})();
