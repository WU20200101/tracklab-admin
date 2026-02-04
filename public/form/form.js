const API_BASE = "https://tracklab-api.wuxiaofei1985.workers.dev";
const PACK_ID = "xhs";
const PACK_VERSION = "v1.0.0";

let uiSchema = null;
let currentPreset = null;

/* ---------- 基础工具 ---------- */

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

/* ---------- 初始化 ---------- */

async function boot() {
  $("#apiBase").value = API_BASE;

  uiSchema = await api(`/schema/ui?pack=${PACK_ID}&version=${PACK_VERSION}`);

  const owners = await api(`/owners/list`);
  fillSelect($("#ownerSelect"), owners, "id", "name");

  $("#ownerSelect").onchange = loadAccounts;
  $("#accountSelect").onchange = loadPresets;
  $("#presetSelect").onchange = loadPresetDetail;
}

function fillSelect(el, list, valueKey, labelKey) {
  el.innerHTML = `<option value="">请选择</option>`;
  list.forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it[valueKey];
    opt.textContent = it[labelKey];
    el.appendChild(opt);
  });
}

/* ---------- 账号 / Preset ---------- */

async function loadAccounts() {
  $("#accountSelect").innerHTML = "";
  $("#presetSelect").innerHTML = "";
  clearForm();

  const ownerId = $("#ownerSelect").value;
  if (!ownerId) return;

  const accounts = await api(`/accounts/list?owner_id=${ownerId}`);
  fillSelect($("#accountSelect"), accounts, "id", "label");
}

async function loadPresets() {
  $("#presetSelect").innerHTML = "";
  clearForm();

  const accountId = $("#accountSelect").value;
  if (!accountId) return;

  const presets = await api(`/preset/list?account_id=${accountId}`);
  fillSelect($("#presetSelect"), presets, "id", "label");
}

async function loadPresetDetail() {
  clearForm();

  const presetId = $("#presetSelect").value;
  if (!presetId) return;

  currentPreset = await api(`/preset/get?id=${presetId}`);
  renderForm();
}

/* ---------- 表单渲染 ---------- */

function renderForm() {
  const container = $("#formContainer");
  container.innerHTML = "";

  const stage = currentPreset.stage;
  const payload = currentPreset.payload || {};

  uiSchema.fields.forEach((field) => {
    if (field.stage > stage) return;

    const wrap = document.createElement("div");
    wrap.className = "form-item";

    const label = document.createElement("label");
    label.textContent = field.label;
    wrap.appendChild(label);

    const input = document.createElement("input");
    input.value = payload[field.key] ?? "";
    if (field.stage < stage) input.disabled = true;

    input.dataset.key = field.key;
    wrap.appendChild(input);

    container.appendChild(wrap);
  });

  $("#saveBar").classList.remove("hidden");
}

/* ---------- 保存 ---------- */

$("#saveBtn").onclick = async () => {
  const inputs = $("#formContainer").querySelectorAll("input");
  const nextPayload = { ...currentPreset.payload };

  inputs.forEach((i) => {
    if (!i.disabled) {
      nextPayload[i.dataset.key] = i.value.trim();
    }
  });

  await api(`/preset/update`, {
    method: "POST",
    body: JSON.stringify({
      id: currentPreset.id,
      payload: nextPayload,
    }),
  });

  currentPreset.payload = nextPayload;
  renderPromptPreview();
};

/* ---------- Prompt ---------- */

async function renderPromptPreview() {
  const out = await api(`/prompt/build`, {
    method: "POST",
    body: JSON.stringify({
      preset_id: currentPreset.id,
    }),
  });

  $("#promptPreview").textContent = out.prompt || "(empty)";
}

/* ---------- 工具 ---------- */

function clearForm() {
  $("#formContainer").innerHTML = "";
  $("#promptPreview").textContent = "(empty)";
  $("#saveBar").classList.add("hidden");
}

/* ---------- 启动 ---------- */

boot();
