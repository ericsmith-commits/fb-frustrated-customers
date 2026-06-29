const form = document.getElementById("settingsForm");
const groupUrlsEl = document.getElementById("groupUrls");
const keywordsEl = document.getElementById("keywords");
const uploadEnabledEl = document.getElementById("uploadEnabled");
const debugIncludeUnmatchedEl = document.getElementById("debugIncludeUnmatched");
const serverEndpointEl = document.getElementById("serverEndpoint");
const ingestTokenEl = document.getElementById("ingestToken");
const maxScrollsEl = document.getElementById("maxScrolls");
const scrollDelayMsEl = document.getElementById("scrollDelayMs");
const pageLoadDelayMsEl = document.getElementById("pageLoadDelayMs");
const statusEl = document.getElementById("status");
const resetDefaultsButton = document.getElementById("resetDefaults");

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function linesToArray(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function arrayToLines(values) {
  return (values || []).join("\n");
}

function renderSettings(settings) {
  groupUrlsEl.value = arrayToLines(settings.groupUrls);
  keywordsEl.value = arrayToLines(settings.keywords);
  uploadEnabledEl.checked = Boolean(settings.uploadEnabled);
  debugIncludeUnmatchedEl.checked = Boolean(settings.debugIncludeUnmatched);
  serverEndpointEl.value = settings.serverEndpoint || "";
  ingestTokenEl.value = settings.ingestToken || "";
  maxScrollsEl.value = String(settings.maxScrolls);
  scrollDelayMsEl.value = String(settings.scrollDelayMs);
  pageLoadDelayMsEl.value = String(settings.pageLoadDelayMs);
}

function readSettings() {
  return {
    groupUrls: linesToArray(groupUrlsEl.value),
    keywords: linesToArray(keywordsEl.value),
    uploadEnabled: uploadEnabledEl.checked,
    debugIncludeUnmatched: debugIncludeUnmatchedEl.checked,
    serverEndpoint: serverEndpointEl.value.trim(),
    ingestToken: ingestTokenEl.value,
    maxScrolls: Number(maxScrollsEl.value || DEFAULT_SETTINGS.maxScrolls),
    scrollDelayMs: Number(scrollDelayMsEl.value || DEFAULT_SETTINGS.scrollDelayMs),
    pageLoadDelayMs: Number(pageLoadDelayMsEl.value || DEFAULT_SETTINGS.pageLoadDelayMs)
  };
}

function showStatus(message) {
  statusEl.textContent = message;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    statusEl.textContent = "";
  }, 3000);
}

async function loadSettings() {
  const settings = await sendMessage({ type: "GET_SETTINGS" });
  renderSettings(settings || DEFAULT_SETTINGS);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage({ type: "SAVE_SETTINGS", settings: readSettings() });
  showStatus("Saved");
});

resetDefaultsButton.addEventListener("click", async () => {
  renderSettings(DEFAULT_SETTINGS);
  await sendMessage({ type: "SAVE_SETTINGS", settings: DEFAULT_SETTINGS });
  showStatus("Defaults restored");
});

loadSettings().catch((error) => {
  showStatus(error && error.message ? error.message : String(error));
});
