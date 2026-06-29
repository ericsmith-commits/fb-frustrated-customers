importScripts("defaults.js");

const STORAGE_KEYS = {
  settings: "collectorSettings",
  lastRun: "lastRun",
  runStatus: "runStatus"
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(values) {
  return chrome.storage.local.set(values);
}

async function getSettings() {
  const stored = await storageGet([STORAGE_KEYS.settings]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEYS.settings] || {})
  };
}

async function setRunStatus(status) {
  await storageSet({
    [STORAGE_KEYS.runStatus]: {
      ...status,
      updatedAt: nowIso()
    }
  });
}

async function getActiveFacebookTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id || !/^https:\/\/(www|web)\.facebook\.com\/groups\//i.test(tab.url || "")) {
    throw new Error("Open an approved Facebook group page before scanning the current page.");
  }
  return tab;
}

async function ensureContentScript(tabId) {
  const checks = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__FB_FRUSTRATED_CUSTOMERS_COLLECTOR_LOADED__)
  });
  const isLoaded = checks.some((check) => Boolean(check.result));

  if (!isLoaded) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
  }
}

async function sendScanMessage(tabId, type, settings) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type, settings });
  } catch (_error) {
    await ensureContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, { type, settings });
  }
}

async function waitForTabComplete(tabId) {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") return;

  await new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function uploadBatch(payload, settings) {
  if (!settings.uploadEnabled || !settings.serverEndpoint) {
    return { uploaded: false, reason: "Upload disabled or server endpoint missing." };
  }

  const headers = { "Content-Type": "application/json" };
  if (settings.ingestToken) {
    headers.Authorization = `Bearer ${settings.ingestToken}`;
  }

  const response = await fetch(settings.serverEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Upload failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return { uploaded: true };
}

async function saveRun(run) {
  await storageSet({ [STORAGE_KEYS.lastRun]: run });
}

function makeRunId() {
  return `run_${Date.now().toString(36)}`;
}

async function scanCurrentTab() {
  const settings = await getSettings();
  const tab = await getActiveFacebookTab();
  const runId = makeRunId();

  await setRunStatus({
    state: "running",
    mode: "current-page",
    runId,
    message: "Scanning current page."
  });

  const scan = await sendScanMessage(tab.id, "SCAN_WITH_SCROLL", settings);
  const payload = {
    runId,
    mode: "current-page",
    startedAt: nowIso(),
    finishedAt: nowIso(),
    groups: [
      {
        url: scan.groupUrl || tab.url,
        status: scan.status,
        reason: scan.reason || "",
        itemCount: scan.items ? scan.items.length : 0
      }
    ],
    items: scan.items || []
  };

  let upload = { uploaded: false };
  if (scan.ok) {
    try {
      upload = await uploadBatch(payload, settings);
    } catch (error) {
      upload = {
        uploaded: false,
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  payload.upload = upload;
  await saveRun(payload);
  await setRunStatus({
    state: scan.ok ? "complete" : "needs-attention",
    mode: "current-page",
    runId,
    message: scan.ok
      ? `Found ${payload.items.length} candidate item(s).`
      : `Scan stopped: ${scan.reason || scan.status}.`
  });

  return payload;
}

async function previewCurrentTab() {
  const settings = await getSettings();
  const tab = await getActiveFacebookTab();
  return sendScanMessage(tab.id, "PREVIEW_VISIBLE", {
    ...settings,
    previewLimit: 12
  });
}

async function scanApprovedGroups() {
  const settings = await getSettings();
  const runId = makeRunId();
  const startedAt = nowIso();
  const groupUrls = Array.isArray(settings.groupUrls) ? settings.groupUrls.filter(Boolean) : [];
  const groups = [];
  const allItems = [];

  await setRunStatus({
    state: "running",
    mode: "approved-groups",
    runId,
    message: `Starting ${groupUrls.length} approved group scan(s).`,
    totalGroups: groupUrls.length,
    completedGroups: 0
  });

  let tab = null;

  try {
    for (let index = 0; index < groupUrls.length; index += 1) {
      const groupUrl = groupUrls[index];
      await setRunStatus({
        state: "running",
        mode: "approved-groups",
        runId,
        message: `Opening group ${index + 1} of ${groupUrls.length}.`,
        currentGroupUrl: groupUrl,
        totalGroups: groupUrls.length,
        completedGroups: index
      });

      if (!tab) {
        tab = await chrome.tabs.create({ url: groupUrl, active: true });
      } else {
        await chrome.tabs.update(tab.id, { url: groupUrl, active: true });
      }

      await waitForTabComplete(tab.id);
      await sleep(Math.max(1000, Number(settings.pageLoadDelayMs || 3500)));

      const scan = await sendScanMessage(tab.id, "SCAN_WITH_SCROLL", settings);
      const itemCount = scan.items ? scan.items.length : 0;

      groups.push({
        url: groupUrl,
        resolvedUrl: scan.url || groupUrl,
        status: scan.status,
        reason: scan.reason || "",
        itemCount
      });

      if (scan.ok && scan.items) {
        allItems.push(...scan.items);
      }

      await setRunStatus({
        state: scan.ok ? "running" : "needs-attention",
        mode: "approved-groups",
        runId,
        message: scan.ok
          ? `Found ${itemCount} item(s) in group ${index + 1}.`
          : `Attention needed for group ${index + 1}: ${scan.reason || scan.status}.`,
        currentGroupUrl: groupUrl,
        totalGroups: groupUrls.length,
        completedGroups: index + 1
      });

      if (!scan.ok) break;
      await sleep(1200);
    }
  } catch (error) {
    groups.push({
      url: tab && tab.url ? tab.url : "",
      status: "error",
      reason: error && error.message ? error.message : String(error),
      itemCount: 0
    });
  }

  const deduped = new Map();
  for (const item of allItems) {
    deduped.set(item.contentHash, item);
  }

  const payload = {
    runId,
    mode: "approved-groups",
    startedAt,
    finishedAt: nowIso(),
    groups,
    items: Array.from(deduped.values())
  };

  let upload = { uploaded: false };
  const failedGroup = groups.find((group) => group.status && group.status !== "scanned");
  if (!failedGroup) {
    try {
      upload = await uploadBatch(payload, settings);
    } catch (error) {
      upload = {
        uploaded: false,
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  payload.upload = upload;
  await saveRun(payload);
  await setRunStatus({
    state: failedGroup ? "needs-attention" : "complete",
    mode: "approved-groups",
    runId,
    message: failedGroup
      ? `Stopped at ${failedGroup.url}: ${failedGroup.reason || failedGroup.status}.`
      : `Finished. Found ${payload.items.length} unique candidate item(s).`,
    totalGroups: groupUrls.length,
    completedGroups: groups.length
  });

  return payload;
}

async function exportLastRun() {
  const stored = await storageGet([STORAGE_KEYS.lastRun]);
  return stored[STORAGE_KEYS.lastRun] || null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    storageSet({ [STORAGE_KEYS.settings]: message.settings || DEFAULT_SETTINGS }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "GET_RUN_STATUS") {
    storageGet([STORAGE_KEYS.runStatus, STORAGE_KEYS.lastRun]).then((stored) => {
      sendResponse({
        runStatus: stored[STORAGE_KEYS.runStatus] || { state: "idle", message: "No scans yet." },
        lastRun: stored[STORAGE_KEYS.lastRun] || null
      });
    });
    return true;
  }

  if (message.type === "SCAN_CURRENT_TAB") {
    scanCurrentTab()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "PREVIEW_CURRENT_TAB") {
    previewCurrentTab()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "SCAN_APPROVED_GROUPS") {
    scanApprovedGroups()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "EXPORT_LAST_RUN") {
    exportLastRun().then((payload) => sendResponse({ ok: true, payload }));
    return true;
  }

  return false;
});
