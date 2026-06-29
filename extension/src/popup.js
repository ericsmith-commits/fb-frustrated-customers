const stateEl = document.getElementById("state");
const messageEl = document.getElementById("message");
const progressTextEl = document.getElementById("progressText");
const progressBarEl = document.getElementById("progressBar");
const lastRunEl = document.getElementById("lastRun");
const itemCountEl = document.getElementById("itemCount");
const scanCurrentButton = document.getElementById("scanCurrent");
const previewCurrentButton = document.getElementById("previewCurrent");
const scanGroupsButton = document.getElementById("scanGroups");
const exportButton = document.getElementById("exportLastRun");
const optionsButton = document.getElementById("openOptions");
const previewOutputEl = document.getElementById("previewOutput");

let pollTimer = null;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function setBusy(isBusy) {
  scanCurrentButton.disabled = isBusy;
  previewCurrentButton.disabled = isBusy;
  scanGroupsButton.disabled = isBusy;
}

function renderStatus(data) {
  const status = data.runStatus || { state: "idle", message: "No scans yet." };
  const lastRun = data.lastRun || null;

  stateEl.textContent = status.state || "idle";
  messageEl.textContent = status.message || "";

  const total = Number(status.totalGroups || 0);
  const completed = Number(status.completedGroups || 0);
  if (total > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
    progressBarEl.style.width = `${pct}%`;
    progressTextEl.textContent = `${completed} of ${total} groups scanned`;
  } else {
    progressBarEl.style.width = status.state === "complete" ? "100%" : "0";
    progressTextEl.textContent = "";
  }

  if (lastRun) {
    lastRunEl.textContent = new Date(lastRun.finishedAt || lastRun.startedAt).toLocaleString();
    itemCountEl.textContent = String(lastRun.items ? lastRun.items.length : 0);
  } else {
    lastRunEl.textContent = "None";
    itemCountEl.textContent = "0";
  }

  setBusy(status.state === "running");
}

async function refreshStatus() {
  const data = await sendMessage({ type: "GET_RUN_STATUS" });
  renderStatus(data);

  if (data.runStatus && data.runStatus.state === "running" && !pollTimer) {
    pollTimer = setInterval(refreshStatus, 1500);
  }

  if ((!data.runStatus || data.runStatus.state !== "running") && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function runScan(type) {
  setBusy(true);
  messageEl.textContent = "Starting scan...";
  if (!pollTimer) {
    pollTimer = setInterval(refreshStatus, 1500);
  }

  try {
    const result = await sendMessage({ type });
    if (!result.ok) {
      messageEl.textContent = result.error || "Scan failed.";
    }
  } catch (error) {
    messageEl.textContent = error && error.message ? error.message : String(error);
  } finally {
    await refreshStatus();
  }
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

scanCurrentButton.addEventListener("click", () => {
  runScan("SCAN_CURRENT_TAB");
});

previewCurrentButton.addEventListener("click", async () => {
  setBusy(true);
  previewOutputEl.textContent = "Reading visible page...";
  try {
    const result = await sendMessage({ type: "PREVIEW_CURRENT_TAB" });
    if (!result.ok) {
      previewOutputEl.textContent = result.error || "Preview failed.";
      return;
    }

    const payload = result.payload;
    previewOutputEl.textContent = [
      `URL: ${payload.url}`,
      `Article roots: ${payload.articleCount}`,
      `Page text length: ${payload.pageTextLength}`,
      "",
      "First visible candidates:",
      ...(payload.previews || []).map((preview) => {
        return [
          `#${preview.index + 1} length=${preview.textLength} author=${preview.authorName || "(unknown)"}`,
          preview.text
        ].join("\n");
      })
    ].join("\n\n---\n\n");
  } catch (error) {
    previewOutputEl.textContent = error && error.message ? error.message : String(error);
  } finally {
    setBusy(false);
  }
});

scanGroupsButton.addEventListener("click", () => {
  runScan("SCAN_APPROVED_GROUPS");
});

exportButton.addEventListener("click", async () => {
  const result = await sendMessage({ type: "EXPORT_LAST_RUN" });
  if (!result.ok || !result.payload) {
    messageEl.textContent = "No previous run is available to export.";
    return;
  }
  downloadJson(`fb-collector-${result.payload.runId || "last-run"}.json`, result.payload);
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refreshStatus().catch((error) => {
  messageEl.textContent = error && error.message ? error.message : String(error);
});
