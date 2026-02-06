/* TrackLab Client (Updated v2026-02-04)
 * - Owner ID 下拉：从 /owner/list 拉取（真实 D1）
 * - Owner change -> 自动刷新 accounts，并清空 presets
 * - Account change -> 自动刷新 presets（带 account_id 过滤）
 * - presetRefreshList 修复语法问题（函数体完整）
 * - 保留：preview / generate / feedback / outcome / stats
 */

/** ===== storage control ===== **/
const REMEMBER_LAST = false; // ← 只要是 false，就完全不记忆

function lsGet(key) {
  if (!REMEMBER_LAST) return "";
  try {
    return lsGet(key) || "";
  } catch {
    return "";
  }
}

function lsSet(key, value) {
  if (!REMEMBER_LAST) return;
  try {
    lsSet(key, value);
  } catch {}
}

function lsDel(key) {
  try {
    lsDel(key);
  } catch {}
}

const $ = (id) => document.getElementById(id);
const EMPTY_TEXT = "请选择";

let currentPreset = null; // preset/get item

const LS_OWNER_KEY = "tracklab_owner_id";
const LS_ACCOUNT_KEY = "tracklab_account_id";

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
    const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data || {};
}

function apiBase() {
  const v = $("apiBase").value.trim().replace(/\/+$/, "");
  if (!v) throw new Error("接口地址不能为空");
  return v;
}

function getPackId() {
  return $("packId").value;
}

function getPackVersion() {
  // 兼容：旧版 id=packVer；新版可能改为 id=packVersion
  const el = $("packVer") || $("packVersion");
  if (!el) throw new Error("版本号缺失");
  const v = (el.value || "").trim();
  if (!v) throw new Error("版本号不能为空");
  return v;
}


function getOwnerIdStrict() {
  const v = ($("ownerId").value || "").trim();
  if (!v) throw new Error("用户名为空：先选择用户名");
  return v;
}
function getAccountIdStrict() {
  const v = ($("accountSelect").value || "").trim();
  if (!v) throw new Error("账号为空：先选择账号");
  return v;
}
function getPresetIdStrict() {
  const v = ($("presetSelect").value || "").trim();
  if (!v) throw new Error("角色为空：先选择角色");
  return v;
}

function ensurePresetEnabledForOps() {
  if (!currentPreset) throw new Error("未加载角色");
  if (Number(currentPreset.enabled) !== 1) {
    throw new Error("该角色已淘汰，不可预览脚本、生成内容、填写反馈、填写交易记录");
  }
}

function applyEnabledUi(enabled) {
  const disabled = Number(enabled) !== 1;
  $("btnPreview") && ($("btnPreview").disabled = disabled);
  $("btnGenerate") && ($("btnGenerate").disabled = disabled);
  $("btnFeedbackUpsert") && ($("btnFeedbackUpsert").disabled = disabled);
  $("btnOutcomeUpsert") && ($("btnOutcomeUpsert").disabled = disabled);
}

function setPre(id, obj) {
  const el = document.getElementById(id);
  if (!el) return; // 关键：删掉 UI 后不报错
  el.textContent =
    obj == null ? EMPTY_TEXT : typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
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

function clearPresetsUI() {
  const sel = $("presetSelect");
  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = EMPTY_TEXT;
  sel.appendChild(empty);

  currentPreset = null;
}

function clearAccountsUI() {
  const sel = $("accountSelect");
  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = EMPTY_TEXT;
  sel.appendChild(empty);
}

async function loadOwners(){
  const sel = $("ownerId");
  if (!sel) return;

  sel.innerHTML = `<option value="">请选择</option>`;
  sel.value = "";

  const out = await httpjson(`${apiBase()}/user/list?enabled=1`, { method: "GET" });
  const items = out.items || [];

  items.forEach(u => {
    const id = String(u.id || "").trim();
    if (!id) return;

    const label = (u.display_name && String(u.display_name).trim())
      ? String(u.display_name).trim()
      : (u.username && String(u.username).trim())
        ? String(u.username).trim()
        : id;

    const opt = document.createElement("option");
    opt.value = id;          // ✅ 关联字段：users.id
    opt.textContent = label; // ✅ 显示字段：display_name（fallback username）
    sel.appendChild(opt);
  });
}


  // 还原上次选择（如果仍存在）
  const saved = lsGet(LS_OWNER_KEY) || "";
  if (saved && items.includes(saved)) sel.value = saved;
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

  // 还原上次 account（同一 owner 下）
  const savedAccount = lsGet(LS_ACCOUNT_KEY) || "";
  if (savedAccount && items.some((x) => x.id === savedAccount)) {
    sel.value = savedAccount;
  }

  setStatus("ok", `Accounts：${items.length} 个`);
}

async function accountCreate() {
  const owner_id = getOwnerIdStrict();
  const handle = ($("accountHandle").value || "").trim() || null;

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

  if (out?.account?.id) {
    $("accountSelect").value = out.account.id;
    lsSet(LS_ACCOUNT_KEY, out.account.id);
  }

  // 创建后立即刷新 presets（按新 account 过滤）
  await presetRefreshList();
}

async function presetRefreshList() {
  const pack_id = getPackId();
  const pack_version = getPackVersion();
  const stage = $("stageFilter").value;
  const enabled = $("enabledOnly").value;

  const account_id = ($("accountSelect").value || "").trim();

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
  sel.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";

  // ✅ 三态文案：未选账号 / 有账号但无结果 / 有结果
  if (!account_id) {
    empty.textContent = "请选择有效账号";
  } else if (items.length === 0) {
    empty.textContent = "当前筛选条件无角色";
  } else {
    empty.textContent = "请选择";
  }

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

  // 绑定后刷新列表，确保只剩属于该 account 的 presets
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

  setPre("previewOut", out?.prompt_text || JSON.stringify(out, null, 2));
  setStatus("ok", "Preview 成功");
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return null;
}

function normalizeStageFilter(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  // 常见“全部级别/不限/All”
  if (s === "全部级别" || s === "全部" || s.toLowerCase() === "all") return "";

  // 已经是 S0-S3
  if (/^S[0-3]$/i.test(s)) return s.toUpperCase();

  // "0" "1" "2" "3"
  if (/^[0-3]$/.test(s)) return `S${s}`;

  // "3级" / "3 级" / "Level 3"
  const m = s.match(/([0-3])/);
  if (m) return `S${m[1]}`;

  return ""; // 兜底：不传 stage
}

function normalizeTags(v) {
  if (v == null) return "";
  if (Array.isArray(v))
    return v.map(String).map((x) => (x.startsWith("#") ? x : `#${x}`)).join(" ");
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

function renderEvaluationReadable(evaluation) {
  if (!evaluation) return "（暂无评估结果）";

  const actionMap = {
    advance: "✅ 达到升级条件（将进入下一阶段）",
    observe: "⏳ 继续观察（暂不升级）",
    disable: "⛔ 判定为淘汰（不再参与后续生成）",
    none: "ℹ️ 数据不足，尚未触发评估动作"
  };

  const lines = [];

  // 1) 结论行
  lines.push(`【评估结论】`);
  lines.push(actionMap[evaluation.action] || evaluation.action);
  lines.push("");

  // 2) 数据摘要
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

  // 3) 观察窗口
  if (evaluation.window) {
    const w = evaluation.window;
    lines.push("【评估周期】");
    lines.push(`- 周期总数：${w.max_windows} 个`);
    lines.push(`- 每个评估周期：${w.window_days} 天`);
    lines.push(`- 当前周期：第 ${w.window_index} 个`);
  }

  return lines.join("\n");
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

async function generateContent() {
  const preset_id = getPresetIdStrict();

  // 确保 currentPreset 对应当前选择的 preset，再做 enabled gate
  if (!currentPreset?.id || currentPreset.id !== preset_id) await presetLoad();
  ensurePresetEnabledForOps();

  setStatus("info", "Generate 中…");
  const out = await httpJson(`${apiBase()}/generate`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      preset_id,
    }),
  });

  setPre("genRaw", out); // 你若已删 genRaw UI，这里不会报错（setPre 会 no-op）
  const outputObj = out?.output || {};
  setPre("genText", formatClientText(outputObj));

  setStatus("ok", `Generate 完成：job_id=${out?.job_id || "na"}`);
}


function readNonNegInt(id) {
  const v = ($(id)?.value ?? "").toString().trim();
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

async function feedbackUpsert() {
  const preset_id = getPresetIdStrict();
  ensureDateDefault("fbDate");

  const date = ($("fbDate").value || "").trim();
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
    note: ($("fbNote").value || "").trim() || null,
  };

  setStatus("info", "feedback/upsert 提交中…");
  const out = await httpJson(`${apiBase()}/feedback/upsert`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  setPre("evalOut", out?.evaluation || out);
  setPre("evalOut", renderEvaluationReadable(out?.evaluation));

  // advance 后刷新 preset 事实
  try {
    await presetLoad();
  } catch {}

  setStatus("ok", `feedback 已写入；action=${out?.evaluation?.action || "none"}`);
}

async function outcomeUpsert() {
  const preset_id = getPresetIdStrict();
  const account_id = getAccountIdStrict();
  ensureDateDefault("ocDate");

  const date = ($("ocDate").value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Outcome date 格式必须为 YYYY-MM-DD");

  if (!currentPreset?.id || currentPreset.id !== preset_id) await presetLoad();
  ensurePresetEnabledForOps();

  // —— 业务一致性修正（必须）——
const leadCreated = Number($("ocLeadCreated").value || 0);
const paid = Number($("ocPaid").value || 0);

let leadsCount = Number($("ocLeadsCount").value || 0);
let amountYuan = Number($("ocAmountYuan").value || 0);

// 规则：未新增客户 → 数量强制为 0
if (leadCreated !== 1) {
  leadsCount = 0;
}

// 规则：未新增成交 → 金额强制为 0
if (paid !== 1) {
  amountYuan = 0;
}

const body = {
  pack_id: getPackId(),
  pack_version: getPackVersion(),
  account_id,
  preset_id,
  job_id: null,
  date,
  window: $("ocWindow").value || "daily",

  lead_created: leadCreated,
  paid: paid,
  amount_yuan: amountYuan,
  leads_count: leadsCount,

  note: ($("ocNote").value || "").trim() || null,
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

function showError(e) {
  console.error(e);
  setStatus("error", e?.message || String(e));
}

async function handleOwnerChanged() {
  const owner = ($("ownerId").value || "").trim();
  lsSet(LS_OWNER_KEY, owner);
  lsDel(LS_ACCOUNT_KEY);

  clearAccountsUI();
  clearPresetsUI();

  if (!owner) return;
  await accountList();

  // accountList 可能恢复了上次 account；同步保存
  const currentAccount = ($("accountSelect").value || "").trim();
  if (currentAccount) lsSet(LS_ACCOUNT_KEY, currentAccount);

  // 有 account 才刷新 presets（否则 list 会是全量 enabled=1）
  if (currentAccount) await presetRefreshList();
}

async function handleAccountChanged() {
  const account = ($("accountSelect").value || "").trim();
  lsSet(LS_ACCOUNT_KEY, account);

  clearPresetsUI();
  if (!account) return;

  await presetRefreshList();
}

function setDefaults() {
  const setVal = (id, val) => {
    const el = $(id);
    if (el) el.value = val;
  };

  setVal("apiBase", "https://tracklab-api.wuxiaofei1985.workers.dev");
  setVal("packId", "xhs");

  if ($("packVer")) setVal("packVer", "v1.0.0");
  if ($("packVersion")) setVal("packVersion", "v1.0.0");

  setVal("enabledOnly", "1"); // 不存在就跳过

  if ($("fbDate")) ensureDateDefault("fbDate");
  if ($("ocDate")) ensureDateDefault("ocDate");
}

function bindEvents() {
  $("ownerId")?.addEventListener("change", () => handleOwnerChanged().catch(showError));
  $("accountSelect")?.addEventListener("change", () => handleAccountChanged().catch(showError));
  $("presetSelect")?.addEventListener("change", () => presetLoad().catch(showError));

  // ✅补：级别/有效性筛选变化时刷新角色列表
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



/** 启动：先加载 owners，再按 localStorage 恢复联动 */
async function boot() {
  setDefaults();
  bindEvents();

  setStatus("info", "初始化 owners 中…");
  await loadOwners();

  // 如果已经有保存的 owner，触发一次联动加载
  const savedOwner = lsGet(LS_OWNER_KEY) || "";
  if (savedOwner) {
    $("ownerId").value = savedOwner;
    await handleOwnerChanged();
  }

  setStatus("ok", "就绪");
}

boot().catch(showError);























