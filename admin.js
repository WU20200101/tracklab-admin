/* ===== 保留你原有的所有代码 ===== */
/* 假设你原来已经有以下全局变量或等价实现：
   - API_BASE
   - currentPackId
   - currentPackVersion
   - currentPresetId
   - refreshPresetList()
   - loadPresetById(id)
*/

/* ===== 新增：提交反馈 ===== */
async function submitFeedback() {
  if (!currentPresetId) {
    alert("请先选择一个 preset");
    return;
  }

  const date = document.getElementById("fb_date").value;
  if (!date) {
    alert("请选择日期");
    return;
  }

  const body = {
    pack_id: currentPackId,
    pack_version: currentPackVersion,
    preset_id: currentPresetId,
    date,
    totals: {
      posts: toInt("fb_posts"),
      views: toInt("fb_views"),
      likes: toInt("fb_likes"),
      collects: toInt("fb_collects"),
      comments: toInt("fb_comments"),
      dm_inbound: toInt("fb_dm")
    },
    note: document.getElementById("fb_note").value || ""
  };

  try {
    const res = await fetch(`${API_BASE}/feedback/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const json = await res.json();
    document.getElementById("feedbackOut").textContent =
      JSON.stringify(json, null, 2);

    if (!res.ok) {
      alert("反馈提交失败");
      return;
    }

    const action = json?.evaluation?.action;

    if (action === "advance") {
      alert(`已升级到 ${json.stage}`);
      await refreshPresetList();
      await loadPresetById(currentPresetId);
    } else if (action === "disable") {
      alert("该 preset 已被淘汰");
      await refreshPresetList();
      currentPresetId = null;
    } else {
      // none = 继续观察
      alert("反馈已记录：继续观察");
    }

  } catch (err) {
    console.error(err);
    alert("请求异常");
  }
}

function toInt(id) {
  const v = document.getElementById(id).value;
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
