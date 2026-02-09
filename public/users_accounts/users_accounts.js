/* users_accounts.js (replace whole file) */

// ---- helpers ----
const $ = (id) => document.getElementById(id);

function setStatus(type, msg) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (type === "err" ? " err" : "");
}

function safeTrim(v) {
  return (v ?? "").toString().trim();
}

function isLikelyInternalId(v) {
  // internal id: xhs / dy / ks / ... (letters/digits/_/-/.)
  return /^[a-zA-Z0-9_\-\.]+$/.test(v);
}

function getSelectOption(el) {
  if (!el) return null;
  const idx = el.selectedIndex;
  if (idx < 0) return null;
  return el.options[idx] || null;
}

/**
 * 关键：支持两种写法（保证未来加 pack 不改 JS）
 * ✅ 推荐：<option value="xhs">小红书</option>  -> value=internal, text=label
 * ✅ 兼容：<option value="小红书" data-pack-id="xhs">小红书</option> -> text/value是显示，data-pack-id是internal
 */
function getSelectedInternalValue(selectEl) {
  const opt = getSelectOption(selectEl);
  if (!opt) return "";

  const dataId =
    opt.dataset.packId ||
    opt.dataset.pack_id ||
    opt.getAttribute("data-pack-id") ||
    opt.getAttribute("data-pack_id") ||
    "";

  if (dataId) return safeTrim(dataId);

  const v = safeTrim(opt.value);
  if (isLikelyInternalId(v)) return v;

  // fallback: no data, value not internal ->只能用 value（会导致写入中文）
  return v;
}

function getSelectedLabel(selectEl) {
  const opt = getSelectOption(selectEl);
  if (!opt) return "";
  const t = safeTrim(opt.textContent);
  return t || safeTrim(opt.value);
}

function apiBase() {
  return safeTrim($("apiBase")?.value || "").replace(/\/+$/, "");
}

function getPackId() {
  return getSelectedInternalValue($("packId"));
}
function getPackVersion() {
  // packVersion 通常 value 就是版本号
  const el = $("packVersion");
  return safeTrim(el?.value || "");
}
function getPackLabel() {
  return getSelectedLabel($("packId"));
}
function getPackVersionLabel() {
  return getSelectedLabel($("packVersion"));
}

// ---- UI sync ----
function ensurePackOptionsIfEmpty() {
  const packSel = $("packId");
  const verSel = $("packVersion");
  if (packSel && packSel.options.length === 0) {
    // fallback only: keep internal xhs, show 小红书
    packSel.innerHTML = `<option value="xhs">小红书</option>`;
  }
  if (verSel && verSel.options.length === 0) {
    verSel.innerHTML = `<option value="v1.0.0">v1.0.0</option>`;
  }
}

function syncAccountPackFields() {
  // account区的 pack/platform/version 只做“显示确认”，不允许选择
  const packLabel = getPackLabel();
  const packId = getPackId();
  const verLabel = getPackVersionLabel();
  const ver = getPackVersion();

  // accountPackId: 兼容 input 或 select
  const aPack = $("accountPackId");
  if (aPack) {
    if (aPack.tagName === "SELECT") {
      aPack.innerHTML = `<option value="${packId}">${packLabel}</option>`;
      aPack.value = packId;
      aPack.disabled = true;
    } else {
      aPack.value = packLabel;
      aPack.disabled = true;
    }
  }

  const aVer = $("accountPackVersion");
  if (aVer) {
    if (aVer.tagName === "SELECT") {
      aVer.innerHTML = `<option value="${ver}">${verLabel}</option>`;
      aVer.value = ver;
      aVer.disabled = true;
    } else {
      aVer.value = verLabel || ver;
      aVer.disabled = true;
    }
  }

  // 如果你 HTML 里 account区还有 platform 显示框（比如 accountPlatform）
  const aPlat = $("accountPlatform");
  if (aPlat) {
    // 平台显示=pack label（如小红书/抖音），内部仍写 packId
    if (aPlat.tagName === "SELECT") {
      aPlat.innerHTML = `<option value="${packId}">${packLabel}</option>`;
      aPlat.value = packId;
      aPlat.disabled = true;
    } else {
      aPlat.value = packLabel;
      aPlat.disabled = true;
    }
  }
}

function setAccountFormEnabled(enabled) {
  const ids = [
    "accountHandle",
    "accountNote",
    "btnCreateAccount",
    // pack/platform/version 显示项永远禁用，由 syncAccountPackFields 控制
    "accountPackId",
    "accountPackVersion",
    "accountPlatform",
  ];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    if (id === "accountPackId" || id === "accountPackVersion" || id === "accountPlatform") {
      el.disabled = true;
      continue;
    }
    el.disabled = !enabled;
  }

  const hint = $("accountHint");
  if (hint) hint.textContent = enabled ? "" : "请选择用户后再创建账号。";
}

function getSelectedUserId() {
  const el = $("userSelect");
  if (!el) return "";
  const v = safeTrim(el.value);
  if (!v || v === "0" || v === "请选择") return "";
  return v;
}

// ---- API ----
async function httpJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { ok: false, error: "invalid_json", raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---- users ----
async function refreshUsers() {
  const base = apiBase();
  if (!base) throw new Error("missing_api_base");

  const data = await httpJson(`${base}/users/list`);
  const items = Array.isArray(data?.items) ? data.items : [];

  const sel = $("userSelect");
  if (sel) {
    sel.innerHTML = `<option value="">请选择</option>` + items
      .map((u) => {
        const id = safeTrim(u.id);
        const dn = safeTrim(u.display_name || u.username || u.id);
        return `<option value="${id}">${escapeHtml(dn)}</option>`;
      })
      .join("");
  }

  // 可选：显示列表
  const ul = $("usersList");
  if (ul) {
    ul.innerHTML = items
      .map((u) => {
        const dn = escapeHtml(safeTrim(u.display_name || ""));
        const un = escapeHtml(safeTrim(u.username || ""));
        const id = escapeHtml(safeTrim(u.id || ""));
        return `<div class="row"><div><b>${dn || un}</b></div><div class="muted">${un} · ${id}</div></div>`;
      })
      .join("");
  }

  // 根据当前选择，启用/禁用 account 表单
  const uid = getSelectedUserId();
  setAccountFormEnabled(!!uid);
}

async function createUser() {
  const base = apiBase();
  if (!base) throw new Error("missing_api_base");

  const username = safeTrim($("newUsername")?.value);
  const display_name = safeTrim($("newDisplayName")?.value);

  if (!username) {
    setStatus("err", "用户名不能为空");
    return;
  }

  await httpJson(`${base}/users/create`, {
    method: "POST",
    body: JSON.stringify({ username, display_name }),
  });

  setStatus("ok", "用户已创建");
  $("newUsername") && ($("newUsername").value = "");
  $("newDisplayName") && ($("newDisplayName").value = "");
  await refreshUsers();
}

// ---- accounts ----
async function createAccount() {
  const base = apiBase();
  if (!base) throw new Error("missing_api_base");

  const owner_id = getSelectedUserId();
  if (!owner_id) {
    setStatus("err", "请先选择用户");
    return;
  }

  // 重要：写入 D1 用 internal pack_id（xhs/dy/ks...）
  const pack_id = getPackId();
  const pack_version = getPackVersion();

  if (!pack_id || !pack_version) {
    setStatus("err", "pack_id / pack_version 缺失，请检查顶部选择");
    return;
  }

  const handle = safeTrim($("accountHandle")?.value);
  const note = safeTrim($("accountNote")?.value);

  if (!handle) {
    setStatus("err", "账号名称不能为空");
    return;
  }

  await httpJson(`${base}/accounts/create`, {
    method: "POST",
    body: JSON.stringify({ owner_id, pack_id, pack_version, handle, note }),
  });

  setStatus("ok", "账号已创建");
  $("accountHandle") && ($("accountHandle").value = "");
  $("accountNote") && ($("accountNote").value = "");
}

// ---- events ----
function bindEvents() {
  $("btnCreateUser")?.addEventListener("click", (e) => {
    e.preventDefault();
    createUser().catch((err) => {
      console.error(err);
      setStatus("err", readableErr(err));
    });
  });

  $("btnRefreshUsers")?.addEventListener("click", (e) => {
    e.preventDefault();
    refreshUsers().catch((err) => {
      console.error(err);
      setStatus("err", readableErr(err));
    });
  });

  $("btnCreateAccount")?.addEventListener("click", (e) => {
    e.preventDefault();
    createAccount().catch((err) => {
      console.error(err);
      setStatus("err", readableErr(err));
    });
  });

  $("userSelect")?.addEventListener("change", () => {
    const uid = getSelectedUserId();
    setAccountFormEnabled(!!uid);
  });

  $("packId")?.addEventListener("change", () => {
    syncAccountPackFields();
  });
  $("packVersion")?.addEventListener("change", () => {
    syncAccountPackFields();
  });
}

// ---- utils ----
function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readableErr(err) {
  if (!err) return "unknown_error";
  if (err.body?.error) return err.body.error;
  if (err.body?.message) return err.body.message;
  return err.message || String(err);
}

// ---- boot ----
async function boot() {
  ensurePackOptionsIfEmpty();
  syncAccountPackFields();
  setAccountFormEnabled(!!getSelectedUserId());
  await refreshUsers();
  setStatus("ok", "就绪");
}

window.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  boot().catch((err) => {
    console.error(err);
    setStatus("err", readableErr(err));
  });
});
