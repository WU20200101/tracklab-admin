/* TrackLab Client
 * - 选择 account / preset
 * - preview prompt（通过 preset 读取 stage+payload）
 * - generate（preset_id）
 * - feedback/upsert（累计）-> 展示 evaluation
 * - outcome/upsert + stats/preset
 */

const $ = (id) => document.getElementById(id);

let currentPreset = null; // preset/get item

const OWNER_IDS = [
  "wuxiaofei",
  "wife",
  "ops1",
  "test_owner_01",
  "test_owner_02",
];

const LS_OWNER_KEY = "tracklab_owner_id";

function renderOwnerSelect() {
  const sel = $("ownerId");
  sel.innerHTML = "";

  const saved = localStorage.getItem(LS_OWNER_KEY) || "";
  const list = OWNER_IDS.slice();

  // 如果 saved 不在列表里，仍然保留（避免你改了列表后丢失）
  if (saved && !list.includes(saved)) list.unshift(saved);

  // 空占位
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "请选择";
  sel.appendChild(empty);

  list.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  });

  if (saved) sel.value = saved;
}

function bindOwnerPersist() {
  $("ownerId").addEventListener("change", () => {
    localStorage.setItem(LS_OWNER_KEY, $("ownerId").value || "");
  });
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
  if (!msg) { el.innerHTML = ""; return; }
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
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data || {};
}

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

function getOwnerIdStrict() {
  const v = ($("ownerId").value || "").trim();
  if (!v) throw new Error("owner_id 为空：先填 Owner ID");
  return v;
}
function getAccountIdStrict() {
  const v = ($("accountSelect").value || "").trim();
  if (!v) throw new Error("account_id 为空：先选择 Account");
  return v;
}
function getPresetIdStrict() {
  const v = ($("presetSelect").value || "").trim();
  if (!v) throw new Error("preset_id 为空：先选择 Preset");
  return v;
}

function setPre(id, obj) {
  $(id).textContent = (obj == null) ? "(empty)" : (typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
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

async function accountList() {
  const owner_id = getOwnerIdStrict();
  const url = `${apiBase()}/account/list?owner_id=${encodeURIComponent(owner_id)}`;
  setStatus("info", "刷新 accounts 中…");
  const out = await httpJson(url, { method: "GET" });

  const items = out.items || [];
  const sel = $("accountSelect");
  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = items.length ? "请选择" : "(empty)";
  sel.appendChild(empty);

  items.forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = `${it.handle || "(no handle)"} (${it.updated_at || ""})`;
    sel.appendChild(opt);
  });

  setPre("accountOut", out);
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

  setStatus("info", "创建 account 中…");
  const out = await httpJson(`${apiBase()}/account/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  setPre("accountOut", out);
  setStatus("ok", `Account 已创建：${out?.account?.id || "na"}`);
  await accountList();
  if (out?.account?.id) $("accountSelect").value = out.account.id;
}

async function presetRefreshList() {
  const pack_id = getPackId();
  const pack_version = getPackVersion();
  const stage = $("stageFilter").value;
  const enabled = $("enabledOnly").value;

  // 取当前选择的 account_id（没选就空）
  const account_id = ($("accountSelect").value || "").trim();

  let url =
    `${apiBase()}/preset/list?pack_id=${encodeURIComponent(pack_id)}` +
    `&pack_version=${encodeURIComponent(pack_version)}`;

  if (stage) url += `&stage=${encodeURIComponent(stage)}`;
  if (enabled !== "") url += `&enabled=${encodeURIComponent(enabled)}`;

  // 新增：按 account 过滤
  if (account_id) url += `&account_id=${encodeURIComponent(account_id)}`;

  setStatus("info", "刷新 presets 中…");
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
}

async function previewPrompt() {
  // 和你 admin.js 一致：preview 必须基于 preset 的 stage+payload
  if (!currentPreset?.id) await presetLoad();

  const out = await httpJson(`${apiBase()}/preview`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      stage: currentPreset.stage,
      payload: currentPreset.payload,
    }),
  });

  // 只展示 prompt_text，避免 JSON 干扰
  setPre("previewOut", out?.prompt_text || JSON.stringify(out, null, 2));
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
  if (Array.isArray(v)) return v.map(String).map((x) => x.startsWith("#") ? x : `#${x}`).join(" ");
  const s = String(v).trim();
  if (!s) return "";
  // 若是用空格/逗号分隔的裸 tag，做一个轻量兜底
  const parts = s.split(/[\s,，]+/).filter(Boolean);
  if (parts.length <= 1) return s.startsWith("#") ? s : `#${s}`;
  return parts.map((x) => x.startsWith("#") ? x : `#${x}`).join(" ");
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

  setStatus("info", "Generate 中…");
  const out = await httpJson(`${apiBase()}/generate`, {
    method: "POST",
    body: JSON.stringify({
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      preset_id,
    }),
  });

  // raw
  setPre("genRaw", out);

  // formatted text
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

  // 如果 advance：刷新 preset 状态（拿到新 stage）
  try { await presetLoad(); } catch {}

  setStatus("ok", `feedback 已写入；action=${out?.evaluation?.action || "none"}`);
}

async function outcomeUpsert() {
  const preset_id = getPresetIdStrict();
  const account_id = getAccountIdStrict();
  ensureDateDefault("ocDate");

  const date = ($("ocDate").value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Outcome date 格式必须为 YYYY-MM-DD");

  const body = {
    pack_id: getPackId(),
    pack_version: getPackVersion(),
    account_id,
    preset_id,
    job_id: null,
    date,
    window: ($("ocWindow").value || "daily"),
    lead_created: Number($("ocLeadCreated").value || 0),
    paid: Number($("ocPaid").value || 0),
    amount_cents: Number($("ocAmountCents").value || 0),
    leads_count: Number($("ocLeadsCount").value || 0),
    note: ($("ocNote").value || "").trim() || null,
  };

  setStatus("info", "outcome/upsert 提交中…");
  const out = await httpJson(`${apiBase()}/outcome/upsert`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  setPre("outcomeOut", out);
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

function setDefaults() {
  $("apiBase").value = "https://tracklab-api.wuxiaofei1985.workers.dev";
  $("packId").value = "xhs";
  $("packVer").value = "v1.0.0";
  $("enabledOnly").value = "1";
  ensureDateDefault("fbDate");
  ensureDateDefault("ocDate");
}

function bindEvents() {
  $("btnAccountRefresh").addEventListener("click", () => accountList().catch(showError));
  $("btnAccountCreate").addEventListener("click", () => accountCreate().catch(showError));

  $("btnPresetRefresh").addEventListener("click", () => presetRefreshList().catch(showError));
  $("btnPresetLoad").addEventListener("click", () => presetLoad().catch(showError));
  $("btnPresetBindAccount").addEventListener("click", () => presetBindAccount().catch(showError));

  $("btnPreview").addEventListener("click", () => previewPrompt().catch(showError));
  $("btnGenerate").addEventListener("click", () => generateContent().catch(showError));

  $("btnFeedbackUpsert").addEventListener("click", () => feedbackUpsert().catch(showError));
  $("btnOutcomeUpsert").addEventListener("click", () => outcomeUpsert().catch(showError));
  $("btnStatsPreset").addEventListener("click", () => statsPreset().catch(showError));

  $("accountSelect").addEventListener("change", () => {
  presetRefreshList().catch(showError);
});
}

setDefaults();
bindEvents();

renderOwnerSelect();
bindOwnerPersist();



