// TrackLab - users + accounts page
// Depends on ui.css existing classes: wrap/card/row/col/input/select/btn/status/fieldset/disabled etc.

function $(id) { return document.getElementById(id); }

function setStatus(type, msg) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (type === "err" ? " err" : "");
}

function apiBase() {
  return String($("apiBase").value || "").replace(/\/+$/, "");
}

async function apiGet(path) {
  const url = apiBase() + path;
  const res = await fetch(url, { method: "GET" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    const msg = json?.error || `http_${res.status}`;
    const detail = json?.detail ? ` | ${json.detail}` : "";
    throw new Error(msg + detail);
  }
  return json;
}

async function apiPost(path, body) {
  const url = apiBase() + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    const msg = json?.error || `http_${res.status}`;
    const detail = json?.detail ? ` | ${json.detail}` : "";
    throw new Error(msg + detail);
  }
  return json;
}

function normalizeUsername(u) {
  return String(u || "").trim();
}

function validUsername(u) {
  // allow a-z A-Z 0-9 _ -
  if (!u) return false;
  if (u.length < 3 || u.length > 32) return false;
  return /^[a-zA-Z0-9_-]+$/.test(u);
}

function setAccountFormEnabled(enabled) {
  const box = $("accountForm");
  const list = $("accountList");
  if (!box) return;

  if (enabled) {
    box.classList.remove("disabled");
    [...box.querySelectorAll("input,select,button")].forEach(el => el.disabled = false);
    if (list) list.disabled = false;
  } else {
    box.classList.add("disabled");
    [...box.querySelectorAll("input,select,button")].forEach(el => el.disabled = true);
    if (list) list.disabled = true;
  }
}

function setUserOptions(users) {
  const sel = $("userSelect");
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "请选择";
  sel.appendChild(opt0);

  (users || []).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id; // users.id
    opt.textContent = u.display_name ? `${u.display_name}` : `${u.username || u.id}`;
    opt.dataset.username = u.username || "";
    opt.dataset.displayName = u.display_name || "";
    sel.appendChild(opt);
  });
}

function setAccountOptions(accounts) {
  const sel = $("accountList");
  sel.innerHTML = "";
  if (!accounts || accounts.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（暂无账号）";
    sel.appendChild(opt);
    return;
  }
  accounts.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    const created = a.created_at ? ` (${a.created_at})` : "";
    opt.textContent = `${a.handle || a.id}${created}`;
    sel.appendChild(opt);
  });
}

async function loadUsers() {
  const data = await apiGet("/user/list");
  const users = data?.users || [];
  setUserOptions(users);
  return users;
}

async function loadAccounts(ownerId) {
  if (!ownerId) {
    setAccountOptions([]);
    return [];
  }
  const data = await apiGet(`/account/list?owner_id=${encodeURIComponent(ownerId)}`);
  const accounts = data?.accounts || [];
  setAccountOptions(accounts);
  return accounts;
}

async function onCreateUser() {
  setStatus("", "创建用户中…");
  const username = normalizeUsername($("username").value);
  const display_name = String($("displayName").value || "").trim();

  if (!validUsername(username)) {
    setStatus("err", "用户名不合法：仅允许英文/数字/_/-，长度 3–32。");
    return;
  }
  if (!display_name) {
    setStatus("err", "昵称（display_name）不能为空。");
    return;
  }

  try {
    await apiPost("/user/create", { username, display_name });
    setStatus("", "用户创建成功。刷新用户列表中…");
    await loadUsers();
    setStatus("", "用户创建成功。");
  } catch (e) {
    setStatus("err", `创建用户失败：${e.message}`);
  }
}

async function onCreateAccount() {
  const owner_id = $("userSelect").value;
  if (!owner_id) {
    setStatus("err", "请先选择用户。");
    return;
  }

  const pack_id = $("packId").value;
  const pack_version = $("packVersion").value;
  const handle = String($("handle").value || "").trim();
  const note = String($("note").value || "").trim();

  if (!pack_id || !pack_version) {
    setStatus("err", "pack_id / pack_version 不能为空。");
    return;
  }
  if (!handle) {
    setStatus("err", "handle 不能为空。");
    return;
  }

  setStatus("", "创建账号中…");
  try {
    await apiPost("/account/create", {
      owner_id,
      pack_id,
      pack_version,
      handle,
      note,
    });
    setStatus("", "账号创建成功。刷新账号列表中…");
    await loadAccounts(owner_id);
    setStatus("", "账号创建成功。");
  } catch (e) {
    setStatus("err", `创建账号失败：${e.message}`);
  }
}

async function boot() {
  setStatus("", "加载用户列表…");
  setAccountFormEnabled(false);

  // purely for display
  const platform = $("platform").value;
  const version = $("version").value;
  $("schemaInfo").textContent = `环境：${platform} / ${version}`;

  try {
    await loadUsers();
    setStatus("", "就绪");
  } catch (e) {
    setStatus("err", `初始化失败：${e.message}`);
  }

  $("btnCreateUser").addEventListener("click", onCreateUser);
  $("btnReloadUsers").addEventListener("click", async () => {
    try {
      setStatus("", "刷新用户列表…");
      await loadUsers();
      setStatus("", "已刷新用户列表。");
    } catch (e) {
      setStatus("err", `刷新用户失败：${e.message}`);
    }
  });

  $("userSelect").addEventListener("change", async () => {
    const ownerId = $("userSelect").value;
    if (!ownerId) {
      setAccountFormEnabled(false);
      await loadAccounts("");
      setStatus("", "就绪");
      return;
    }
    setAccountFormEnabled(true);
    try {
      setStatus("", "加载账号列表…");
      await loadAccounts(ownerId);
      setStatus("", "就绪");
    } catch (e) {
      setStatus("err", `加载账号失败：${e.message}`);
    }
  });

  $("btnCreateAccount").addEventListener("click", onCreateAccount);
  $("btnReloadAccounts").addEventListener("click", async () => {
    const ownerId = $("userSelect").value;
    if (!ownerId) {
      setStatus("err", "请先选择用户。");
      return;
    }
    try {
      setStatus("", "刷新账号列表…");
      await loadAccounts(ownerId);
      setStatus("", "已刷新账号列表。");
    } catch (e) {
      setStatus("err", `刷新账号失败：${e.message}`);
    }
  });
}

boot();
