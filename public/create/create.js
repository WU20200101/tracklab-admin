/* TrackLab preset create page
 * - 只用于：创建 preset + 绑定到 account
 * - 不做：升级/淘汰/反馈/统计
 */

(() => {
  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

  function setStatus(type, msg) {
    const el = $("status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "status" + (type === "err" ? " err" : "");
  }
  
  function apiBase() {
    const u = new URL(location.href);
    const fromQuery = u.searchParams.get("api");
    if (fromQuery) return fromQuery.replace(/\/+$/, "");
    const el = $("apiBase");
    const v = (el && el.value ? el.value : "").trim().replace(/\/+$/, "");
    if (!v) throw new Error("api_base_empty");
    return v;
  }

  function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  }

  async function fetchPacksIndex() {
  return await httpjson(`${apiBase()}/packs/index`, { method: "GET" });
  }
  
  async function bootPackSelectors() {
  const packSel = $("packId");
  const verSel  = $("packVersion");
  if (!packSel || !verSel) return;

  const idx = await fetchPacksIndex();

  const packs = idx.packs || [];
  const defPackId = idx.default?.pack_id || "";
  const defVer = idx.default?.pack_version || "";

  packSel.innerHTML =
    `<option value="">请选择</option>` +
    packs.map(p => `<option value="${escapeHtml(p.pack_id)}">${escapeHtml(p.label || p.pack_id)}</option>`).join("");

  // 默认选择：完全由 index.json 决定（前端不判断）
  if (!packSel.value) packSel.value = defPackId;

  function renderVersions() {
  const curPackId = (packSel.value || "").trim();
  const p = packs.find(x => x.pack_id === curPackId);
  const vers = p?.versions || [];

  verSel.innerHTML =
    `<option value="">请选择</option>` +
    vers.map(v => `<option value="${escapeHtml(v.pack_version)}">${escapeHtml(v.label || v.pack_version)}</option>`).join("");

  // 版本默认：只按 pack 的 default_pack_version 或全局 default 生效
  if (!verSel.value) {
    const pv = p?.default_pack_version || "";
    if (pv) verSel.value = pv;
    else if (curPackId === defPackId) verSel.value = defVer;
    // 否则保持空，让用户选（不做任何 fallback 选择）
  }
}

  renderVersions();

  packSel.addEventListener("change", () => {
    verSel.value = "";
    renderVersions();
  });
  }

  async function httpjson(url, opt = {}) {
    const res = await fetch(url, {
      ...opt,
      headers: { "content-type": "application/json", ...(opt.headers || {}) },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.error || data?.message || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function getPackId() { return $("packId")?.value || ""; }
  
  function getPackVersion() {
    const v = ($("packVersion")?.value || "").trim();
    if (!v) throw new Error("pack_version_required");
    return v;
  }

  function stageRank(s) {
    if (!s) return -1;
    const m = String(s).match(/^S(\d+)$/i);
    return m ? Number(m[1]) : 999;
  }
  function minStage(stages) {
    if (!Array.isArray(stages) || stages.length === 0) return null;
    return stages.slice().sort((a, b) => stageRank(a) - stageRank(b))[0];
  }

  function getAllFieldsFromSchema(schema) {
    if (!schema) return [];
    if (Array.isArray(schema.fields)) return schema.fields.map((f) => ({ ...f }));
    if (Array.isArray(schema.groups)) {
      const out = [];
      for (const g of schema.groups) {
        for (const f of g.fields || []) out.push({ ...f, __group: g.label || g.id || "" });
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

  // ===== State
  let uiSchema = null;
  let manifest = null;

  let currentOwnerId = "";
  let currentAccountId = "";

  const INIT_STAGE = "S0";

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      await bootPackSelectors();   // 先加载 packs/index 填下拉
      bindEvents();
      await boot();                // boot 本身是 async，直接 await
    } catch (e) {
      setStatus("err", e.message || String(e));
    }
  });

  function bindEvents() {
    on("ownerId", "change", () => handleOwnerChanged().catch((e) => setStatus("err", e.message)));
    on("accountSelect", "change", () =>
      handleAccountChanged().catch((e) => setStatus("err", e.message))
    );
    on("presetName", "input", () => updateCreateButtonState());
    on("btnCreate", "click", () => createPresetBound().catch((e) => setStatus("err", e.message)));
  }

  async function boot() {
    await loadPackSchema();
    await loadOwners();
    await handleOwnerChanged();
    renderFormS0(); // schema 到了就直接渲染 S0
    setStatus("ok", "就绪");
  }

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

  async function loadOwners() {
    const sel = $("ownerId");
    if (!sel) return;

    sel.innerHTML = `<option value="">请选择</option>`;
    sel.value = "";

    // users 表：value 用 id；显示 display_name
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

    clearAccounts();
    clearResult();

    if (!currentOwnerId) {
      updateCreateButtonState();
      return;
    }

    await refreshAccounts();
    await handleAccountChanged();
  }

  function clearAccounts() {
    const sel = $("accountSelect");
    if (sel) {
      sel.innerHTML = `<option value="">请先选择用户名</option>`;
      sel.value = "";
    }
  }

  async function refreshAccounts() {
    setStatus("ok", "加载账号…");

    const pack_id = getPackId();
    const pack_version = getPackVersion();

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

    sel.value = "";
    currentAccountId = "";
  }

  async function handleAccountChanged() {
    currentAccountId = $("accountSelect")?.value || "";
    clearResult();
    updateCreateButtonState();
  }

  function updateCreateButtonState() {
    const btn = $("btnCreate");
    if (!btn) return;
    const name = ($("presetName")?.value || "").trim();
    btn.disabled = !(currentOwnerId && currentAccountId && name && uiSchema);
  }

  function renderFormS0() {
    const c = $("formContainer");
    if (!c) return;
    c.innerHTML = "";

    if (!uiSchema) {
      c.innerHTML = `<div class="sub">Schema 未加载</div>`;
      return;
    }

    const fields = getAllFieldsFromSchema(uiSchema);

    // 仅渲染：min editable stage <= S0（即 S0 可见）；并且只允许编辑 S0 editable
    const visible = fields.filter((f) => {
      const first = minStage(f.editable_stages);
      if (!first) return false;
      return stageRank(first) <= stageRank(INIT_STAGE);
    });

    if (!visible.length) {
      c.innerHTML = `<div class="sub">当前 pack 未定义 S0 可填写字段</div>`;
      return;
    }

    // 简化：本页只做 S0，所以不做按 stage 分组展示
    const box = document.createElement("div");
    box.className = "fieldcard";
    box.innerHTML = `
      <div class="fieldhead">
        <div><b>S0</b></div>
        <div class="pill">当前阶段可编辑</div>
      </div>
    `;

    for (const f of visible) {
      const key = f.key;
      const label = f.label || key;

      const wrap = document.createElement("div");
      wrap.style.marginBottom = "10px";

      const lab = document.createElement("label");
      const required = Array.isArray(f.required_stages) && f.required_stages.includes(INIT_STAGE);
      lab.textContent = label + (required ? " *" : "");
      wrap.appendChild(lab);

      const input = buildInputForField(f, null);
      input.id = `fld__${key}`;
      setControlDisabled(input, false);

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
      el.value = value === true ? "true" : value === false ? "false" : "";
      return el;
    }

    const el = document.createElement("input");
    el.type = "text";
    el.value = value == null ? "" : String(value);
    return el;
  }

  function readS0PayloadOrThrow() {
    const fields = getAllFieldsFromSchema(uiSchema);

    const editableFields = fields.filter(
      (f) => Array.isArray(f.editable_stages) && f.editable_stages.includes(INIT_STAGE)
    );

    const payload = {};

    for (const f of editableFields) {
      const key = f.key;
      const root = $(`fld__${key}`);
      if (!root) continue;

      let v = null;

      if ((f.type || "") === "multi_enum") {
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

      if (Array.isArray(f.required_stages) && f.required_stages.includes(INIT_STAGE)) {
        if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
          throw new Error(`缺少必填：${f.label || f.key}`);
        }
      }

      payload[key] = v;
    }

    return payload;
  }

  async function createPresetBound() {
    if (!currentOwnerId) throw new Error("请先选择用户名");
    if (!currentAccountId) throw new Error("请先选择账号");
    if (!uiSchema) throw new Error("Schema 未加载");

    const name = ($("presetName")?.value || "").trim();
    if (!name) throw new Error("请填写角色名称");

    setStatus("ok", "创建中…");
    clearResult();

    const payload = readS0PayloadOrThrow();

    // === 核心：创建 preset + 绑定到账号 ===
    // 你的后端如果是“创建时带 account_id 就自动写 binding”，用下面这个即可。
    // 如果你是分两步：先 /preset/create 再 /binding/create，需要把这里改成两次调用（我在注释中给出示意）。
    const body = {
      pack_id: getPackId(),
      pack_version: getPackVersion(),
      stage: INIT_STAGE,
      name,
      owner_id: currentOwnerId,
      account_id: currentAccountId,
      payload,
    };

    // 优先尝试一个你可能已经做过的“原子接口名”
    // 1) /preset/create_bound  (推荐：原子写 preset + binding)
    // 2) fallback: /preset/create
    let created = null;
    try {
      created = await httpjson(`${apiBase()}/preset/create_bound`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (e) {
      // 如果你没有 create_bound，就 fallback 到 create
      if (e.status === 404 || /not\s*found/i.test(e.message)) {
        created = await httpjson(`${apiBase()}/preset/create`, {
          method: "POST",
          body: JSON.stringify(body),
        });

        // 如果你后端的 /preset/create 不会写 binding，需要在这里再调用一次：
        // await httpjson(`${apiBase()}/preset_binding/create`, {
        //   method:"POST",
        //   body: JSON.stringify({
        //     owner_id: currentOwnerId,
        //     account_id: currentAccountId,
        //     preset_id: created.preset_id || created.item?.id,
        //     pack_id: getPackId(),
        //     pack_version: getPackVersion(),
        //     stage: INIT_STAGE
        //   })
        // });
      } else {
        throw e;
      }
    }

    const preset_id =
      created?.preset_id ||
      created?.id ||
      created?.item?.id ||
      created?.preset?.id ||
      "";

    if (!preset_id) {
      // 不硬猜结构；直接把返回展示给你排查
      $("createResult").innerHTML = `<span class="warn">创建接口返回成功但未解析到 preset_id。请检查返回结构。</span>`;
      setStatus("ok", "已创建（需检查返回结构）");
      return;
    }

    $("createResult").innerHTML = `
      <div class="ok"><b>创建成功</b></div>
      <div class="sub">preset_id：<code>${escapeHtml(preset_id)}</code></div>
      <div class="sub">下一步：去“角色升级平台”选择该账号 → 刷新角色列表 → 加载并继续升级/生成。</div>
    `;

    // 创建后立刻 preview，方便你确认 shadow/赛道段落是否生效
    await previewPrompt(preset_id, payload);

    setStatus("ok", "创建完成");
  }

  async function previewPrompt(preset_id, payload) {
    const pre = $("debugPrompt");
    if (!pre) return;

    const out = await httpjson(`${apiBase()}/preview`, {
      method: "POST",
      body: JSON.stringify({
        pack_id: getPackId(),
        pack_version: getPackVersion(),
        stage: INIT_STAGE,
        payload,
        preset_id,
      }),
    });

    pre.textContent = out.prompt_text || "创建后将显示生成脚本预览";
  }

  function clearResult() {
    if ($("createResult")) $("createResult").textContent = "";
    if ($("debugPrompt")) $("debugPrompt").textContent = "创建后将显示生成脚本预览";
  }
})();
