// users_accounts.js (no hard binding version - v5)

let apiBase = "";
let currentPackId = "";
let currentPackVersion = "";

/* ---------- 通用 ---------- */

function getApiBase() {
  return document.querySelector("#apiBase").value.trim();
}

function showStatus(msg, isError = false) {
  const el = document.querySelector("#status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "red" : "green";
}

async function httpJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ---------- Pack 下拉 ---------- */

async function loadPackOptions() {
  try {
    apiBase = getApiBase();
    const data = await httpJSON(`${apiBase}/packs`);

    const packSelect = document.querySelector("#packSelect");
    packSelect.innerHTML = "";

    // 先插入“请选择”
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择";
    packSelect.appendChild(placeholder);

    if (Array.isArray(data.packs)) {
      data.packs.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.pack_id;
        opt.textContent = p.pack_id;
        packSelect.appendChild(opt);
      });
    }

    packSelect.value = "";
  } catch (e) {
    showStatus(e.message, true);
  }
}

async function loadVersionOptions(packId) {
  try {
    if (!packId) return;

    const data = await httpJSON(`${apiBase}/pack/${packId}`);
    const versionSelect = document.querySelector("#versionSelect");

    versionSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择";
    versionSelect.appendChild(placeholder);

    if (Array.isArray(data.versions)) {
      data.versions.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        versionSelect.appendChild(opt);
      });
    }

    versionSelect.value = "";
  } catch (e) {
    showStatus(e.message, true);
  }
}

/* ---------- 用户 ---------- */

async function createUser() {
  try {
    apiBase = getApiBase();

    const username = document.querySelector("#username").value.trim();
    const nickname = document.querySelector("#nickname").value.trim();

    if (!username) {
      showStatus("用户名不能为空", true);
      return;
    }

    await httpJSON(`${apiBase}/users`, {
      method: "POST",
      body: JSON.stringify({ username, nickname })
    });

    showStatus("用户创建成功");
    refreshUserList();
  } catch (e) {
    showStatus(e.message, true);
  }
}

async function refreshUserList() {
  try {
    apiBase = getApiBase();

    const data = await httpJSON(`${apiBase}/users`);
    const select = document.querySelector("#userSelect");

    select.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择";
    select.appendChild(placeholder);

    if (Array.isArray(data.users)) {
      data.users.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.username;
        opt.textContent = u.username;
        select.appendChild(opt);
      });
    }

    select.value = "";
  } catch (e) {
    showStatus(e.message, true);
  }
}

/* ---------- 账号 ---------- */

async function createAccount() {
  try {
    apiBase = getApiBase();

    const username = document.querySelector("#userSelect").value;
    const accountName = document.querySelector("#accountName").value.trim();
    const packId = document.querySelector("#packSelect").value;
    const version = document.querySelector("#versionSelect").value;
    const note = document.querySelector("#note").value.trim();

    if (!username || !packId || !version) {
      showStatus("请选择用户、平台、版本", true);
      return;
    }

    await httpJSON(`${apiBase}/accounts`, {
      method: "POST",
      body: JSON.stringify({
        username,
        account_name: accountName,
        pack_id: packId,
        pack_version: version,
        note
      })
    });

    showStatus("账号创建成功");
  } catch (e) {
    showStatus(e.message, true);
  }
}

/* ---------- 事件绑定 ---------- */

document.addEventListener("DOMContentLoaded", () => {
  loadPackOptions();
  refreshUserList();

  document.querySelector("#packSelect")
    ?.addEventListener("change", e => {
      loadVersionOptions(e.target.value);
    });

  document.querySelector("#createUserBtn")
    ?.addEventListener("click", createUser);

  document.querySelector("#refreshUserBtn")
    ?.addEventListener("click", refreshUserList);

  document.querySelector("#createAccountBtn")
    ?.addEventListener("click", createAccount);
});
