#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const ROOT_DIR = path.resolve(__dirname, "..");
loadEnvFile(path.join(ROOT_DIR, ".env"));

const CONFIG = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3080),
  dataDir: path.resolve(ROOT_DIR, process.env.DATA_DIR || "data"),
  adminUsername: process.env.ADMIN_USERNAME || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  ingestToken: process.env.INGEST_TOKEN || "",
  reportRecipient: process.env.REPORT_RECIPIENT || "ericsmith@gammill.com",
  reportSender: process.env.REPORT_SENDER || "ericsmith@gammill.com",
  reportTimezone: process.env.REPORT_TIMEZONE || "America/Chicago",
  reportHour: Number(process.env.REPORT_HOUR || 22),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.5",
  gmailClientId: process.env.GMAIL_CLIENT_ID || "",
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET || "",
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN || ""
};

const FILES = {
  runs: path.join(CONFIG.dataDir, "runs.jsonl"),
  items: path.join(CONFIG.dataDir, "items.jsonl"),
  reports: path.join(CONFIG.dataDir, "reports.jsonl"),
  state: path.join(CONFIG.dataDir, "state.json")
};

const itemHashes = new Set();

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  ensureDataFiles();
  await loadItemHashes();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      sendJson(response, 500, {
        ok: false,
        error: "Internal server error."
      });
    });
  });

  server.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`fb-frustrated-customers listening on http://${CONFIG.host}:${CONFIG.port}`);
    if (!CONFIG.adminUsername || !CONFIG.adminPassword) {
      console.warn("ADMIN_USERNAME and ADMIN_PASSWORD are not configured. Dashboard routes will be unavailable.");
    }
    if (!CONFIG.ingestToken) {
      console.warn("INGEST_TOKEN is not configured. Extension ingest will be unavailable.");
    }
  });

  startDailyScheduler();
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function ensureDataFiles() {
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  for (const filePath of [FILES.runs, FILES.items, FILES.reports]) {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "");
  }
  if (!fs.existsSync(FILES.state)) {
    writeJsonFile(FILES.state, { lastScheduledReportDate: "" });
  }
}

async function loadItemHashes() {
  const items = await readJsonl(FILES.items);
  for (const item of items) {
    if (item.contentHash) itemHashes.add(item.contentHash);
  }
}

async function handleRequest(request, response) {
  setBaseHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = normalizePathname(requestUrl.pathname);

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "fb-frustrated-customers",
      time: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/ingest/facebook") {
    await handleIngest(request, response);
    return;
  }

  if (!requireAdmin(request, response)) return;

  if (request.method === "GET" && (pathname === "/" || pathname === "/dashboard")) {
    sendHtml(response, renderDashboard());
    return;
  }

  if (request.method === "GET" && pathname === "/api/status") {
    await handleStatus(response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/items") {
    const limit = boundedNumber(requestUrl.searchParams.get("limit"), 1, 1000, 100);
    const items = await readJsonl(FILES.items);
    sendJson(response, 200, {
      ok: true,
      items: items.slice(-limit).reverse()
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/runs") {
    const limit = boundedNumber(requestUrl.searchParams.get("limit"), 1, 500, 50);
    const runs = await readJsonl(FILES.runs);
    sendJson(response, 200, {
      ok: true,
      runs: runs.slice(-limit).reverse()
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/reports") {
    const limit = boundedNumber(requestUrl.searchParams.get("limit"), 1, 100, 20);
    const reports = await readJsonl(FILES.reports);
    sendJson(response, 200, {
      ok: true,
      reports: reports.slice(-limit).reverse()
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/reports/generate") {
    const body = await readJsonBody(request, 1024 * 128).catch(() => ({}));
    const report = await generateAndStoreReport({
      sinceHours: boundedNumber(body.sinceHours, 1, 24 * 365, 24),
      sendEmail: Boolean(body.sendEmail)
    });
    sendJson(response, 200, { ok: true, report });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Not found."
  });
}

async function handleIngest(request, response) {
  if (!CONFIG.ingestToken) {
    sendJson(response, 503, {
      ok: false,
      error: "INGEST_TOKEN is not configured."
    });
    return;
  }

  const auth = request.headers.authorization || "";
  const expected = `Bearer ${CONFIG.ingestToken}`;
  if (!timingSafeEqual(auth, expected)) {
    sendJson(response, 401, {
      ok: false,
      error: "Invalid ingest token."
    });
    return;
  }

  const payload = await readJsonBody(request, 12 * 1024 * 1024);
  const normalized = normalizeIngestPayload(payload);

  const receivedAt = new Date().toISOString();
  const runRecord = {
    ...normalized.run,
    receivedAt,
    source: "chrome-extension"
  };

  const newItems = [];
  for (const item of normalized.items) {
    const contentHash = item.contentHash || hashItem(item);
    if (itemHashes.has(contentHash)) continue;
    itemHashes.add(contentHash);
    newItems.push({
      ...item,
      contentHash,
      runId: normalized.run.runId,
      receivedAt
    });
  }

  await appendJsonl(FILES.runs, runRecord);
  for (const item of newItems) {
    await appendJsonl(FILES.items, item);
  }

  sendJson(response, 200, {
    ok: true,
    runId: normalized.run.runId,
    receivedAt,
    receivedItems: normalized.items.length,
    newItems: newItems.length,
    duplicateItems: normalized.items.length - newItems.length
  });
}

async function handleStatus(response) {
  const [runs, items, reports] = await Promise.all([
    readJsonl(FILES.runs),
    readJsonl(FILES.items),
    readJsonl(FILES.reports)
  ]);

  sendJson(response, 200, {
    ok: true,
    status: {
      configured: {
        admin: Boolean(CONFIG.adminUsername && CONFIG.adminPassword),
        ingest: Boolean(CONFIG.ingestToken),
        openai: Boolean(CONFIG.openaiApiKey),
        gmail: Boolean(CONFIG.gmailClientId && CONFIG.gmailClientSecret && CONFIG.gmailRefreshToken)
      },
      counts: {
        runs: runs.length,
        items: items.length,
        reports: reports.length
      },
      latestRun: runs.at(-1) || null,
      latestReport: reports.at(-1) || null,
      reportSchedule: {
        timezone: CONFIG.reportTimezone,
        hour: CONFIG.reportHour
      }
    }
  });
}

function normalizeIngestPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Payload must be a JSON object.");
  }

  const runId = sanitizeText(payload.runId || `run_${Date.now().toString(36)}`, 120);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const groups = Array.isArray(payload.groups) ? payload.groups : [];

  if (items.length > 10000) {
    throw new HttpError(413, "Payload contains too many items.");
  }

  return {
    run: {
      runId,
      mode: sanitizeText(payload.mode || "unknown", 80),
      startedAt: sanitizeText(payload.startedAt || "", 80),
      finishedAt: sanitizeText(payload.finishedAt || "", 80),
      upload: payload.upload || null,
      groups: groups.map((group) => ({
        url: sanitizeText(group.url || "", 500),
        resolvedUrl: sanitizeText(group.resolvedUrl || "", 500),
        status: sanitizeText(group.status || "", 80),
        reason: sanitizeText(group.reason || "", 500),
        itemCount: Number(group.itemCount || 0)
      }))
    },
    items: items.map((item) => ({
      contentHash: sanitizeText(item.contentHash || "", 120),
      sourceUrl: sanitizeText(item.sourceUrl || "", 800),
      groupUrl: sanitizeText(item.groupUrl || "", 800),
      permalink: sanitizeText(item.permalink || "", 1000),
      authorName: sanitizeText(item.authorName || "", 200),
      timestampText: sanitizeText(item.timestampText || "", 80),
      matchedKeywords: Array.isArray(item.matchedKeywords)
        ? item.matchedKeywords.map((keyword) => sanitizeText(keyword, 120)).slice(0, 50)
        : [],
      text: sanitizeText(item.text || "", 25000),
      extractedAt: sanitizeText(item.extractedAt || "", 80)
    }))
  };
}

async function generateAndStoreReport(options = {}) {
  const sinceHours = options.sinceHours || 24;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const allItems = await readJsonl(FILES.items);
  const items = allItems.filter((item) => {
    const itemDate = new Date(item.extractedAt || item.receivedAt || 0);
    return Number.isFinite(itemDate.getTime()) && itemDate >= since;
  });

  const localSummary = buildLocalReport(items, sinceHours);
  let ai = null;

  if (CONFIG.openaiApiKey && items.length > 0) {
    ai = await generateOpenAiSummary(items, localSummary).catch((error) => ({
      ok: false,
      error: error && error.message ? error.message : String(error)
    }));
  }

  const report = {
    reportId: `report_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    sinceHours,
    itemCount: items.length,
    localSummary,
    ai,
    email: null
  };

  if (options.sendEmail) {
    report.email = await sendReportEmail(report).catch((error) => ({
      sent: false,
      error: error && error.message ? error.message : String(error)
    }));
  }

  await appendJsonl(FILES.reports, report);
  return report;
}

function buildLocalReport(items, sinceHours) {
  const keywordCounts = new Map();
  const groupCounts = new Map();
  const authorCounts = new Map();

  for (const item of items) {
    for (const keyword of item.matchedKeywords || []) {
      increment(keywordCounts, keyword);
    }
    increment(groupCounts, item.groupUrl || "unknown");
    if (item.authorName) increment(authorCounts, item.authorName);
  }

  return {
    title: `Facebook quilting opportunity report - last ${sinceHours} hour(s)`,
    generatedAt: new Date().toISOString(),
    totals: {
      matchedItems: items.length,
      groups: groupCounts.size,
      authors: authorCounts.size
    },
    topKeywords: topEntries(keywordCounts, 12),
    topGroups: topEntries(groupCounts, 12),
    topAuthors: topEntries(authorCounts, 12),
    notableItems: items.slice(-25).reverse().map((item) => ({
      authorName: item.authorName,
      groupUrl: item.groupUrl,
      permalink: item.permalink,
      matchedKeywords: item.matchedKeywords,
      excerpt: makeExcerpt(item.text, 360),
      extractedAt: item.extractedAt || item.receivedAt
    }))
  };
}

async function generateOpenAiSummary(items, localSummary) {
  const compactItems = items.slice(-120).map((item) => ({
    authorName: item.authorName,
    groupUrl: item.groupUrl,
    permalink: item.permalink,
    matchedKeywords: item.matchedKeywords,
    text: makeExcerpt(item.text, 1200),
    extractedAt: item.extractedAt || item.receivedAt
  }));

  const prompt = [
    "You are helping a quilting machine customer support team identify people who need help.",
    "Use the provided Facebook group candidate items.",
    "Return a concise daily report with:",
    "1. top frustration themes,",
    "2. machine advice requests,",
    "3. high-priority outreach opportunities,",
    "4. suggested helpful response angles,",
    "5. notable links/authors.",
    "Do not invent facts. Preserve author names and links exactly when present.",
    "",
    JSON.stringify({ localSummary, items: compactItems }, null, 2)
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: CONFIG.openaiModel,
      input: prompt
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI request failed with HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return {
    ok: true,
    model: CONFIG.openaiModel,
    text: extractOpenAiText(json),
    responseId: json.id || ""
  };
}

function extractOpenAiText(json) {
  if (typeof json.output_text === "string") return json.output_text;

  const chunks = [];
  for (const output of json.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }
  return chunks.join("\n").trim();
}

async function sendReportEmail(report) {
  if (!CONFIG.gmailClientId || !CONFIG.gmailClientSecret || !CONFIG.gmailRefreshToken) {
    return {
      sent: false,
      error: "Gmail API OAuth credentials are not configured."
    };
  }

  const accessToken = await refreshGmailAccessToken();
  const subject = `Facebook quilting report - ${new Date(report.createdAt).toLocaleDateString("en-US")}`;
  const body = renderReportText(report);
  const mime = [
    `From: ${CONFIG.reportSender}`,
    `To: ${CONFIG.reportRecipient}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body
  ].join("\r\n");

  const gmailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: base64Url(Buffer.from(mime, "utf8")) })
  });

  const json = await gmailResponse.json().catch(() => ({}));
  if (!gmailResponse.ok) {
    throw new Error(`Gmail send failed with HTTP ${gmailResponse.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return {
    sent: true,
    id: json.id || "",
    recipient: CONFIG.reportRecipient
  };
}

async function refreshGmailAccessToken() {
  const params = new URLSearchParams({
    client_id: CONFIG.gmailClientId,
    client_secret: CONFIG.gmailClientSecret,
    refresh_token: CONFIG.gmailRefreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Gmail token refresh failed with HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json.access_token;
}

function renderReportText(report) {
  const lines = [];
  lines.push(report.localSummary.title);
  lines.push("");
  lines.push(`Generated: ${report.createdAt}`);
  lines.push(`Matched items: ${report.itemCount}`);
  lines.push("");

  if (report.ai && report.ai.ok && report.ai.text) {
    lines.push(report.ai.text);
    lines.push("");
  } else if (report.ai && report.ai.error) {
    lines.push(`AI summary unavailable: ${report.ai.error}`);
    lines.push("");
  }

  lines.push("Top keywords:");
  for (const entry of report.localSummary.topKeywords) {
    lines.push(`- ${entry.key}: ${entry.count}`);
  }

  lines.push("");
  lines.push("Notable items:");
  for (const item of report.localSummary.notableItems.slice(0, 15)) {
    lines.push(`- ${item.authorName || "Unknown author"} (${(item.matchedKeywords || []).join(", ")})`);
    lines.push(`  ${item.permalink || item.groupUrl || ""}`);
    lines.push(`  ${item.excerpt}`);
  }

  return lines.join("\n");
}

function renderDashboard() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FB Frustrated Customers</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      color: #1f2933;
      background: #f6f7f9;
    }
    body { margin: 0; background: #f6f7f9; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid #d8dee6;
      background: #ffffff;
    }
    h1 { margin: 0; font-size: 21px; }
    main { max-width: 1220px; margin: 0 auto; padding: 22px; }
    section {
      margin-bottom: 18px;
      border: 1px solid #d8dee6;
      border-radius: 8px;
      background: #ffffff;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 13px 15px;
      border-bottom: 1px solid #e5e9ef;
    }
    h2 { margin: 0; font-size: 16px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 15px;
    }
    .metric {
      border: 1px solid #e5e9ef;
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfd;
    }
    .metric span {
      display: block;
      color: #5b6773;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .metric strong { display: block; margin-top: 6px; font-size: 22px; }
    .body { padding: 15px; }
    button {
      min-height: 34px;
      border: 1px solid #b8c2cc;
      border-radius: 6px;
      background: #ffffff;
      color: #17202a;
      cursor: pointer;
      font-weight: 700;
      padding: 7px 11px;
    }
    button.primary { background: #1f6feb; border-color: #1f6feb; color: #ffffff; }
    button:hover { background: #edf2f7; }
    button.primary:hover { background: #1558c0; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid #e5e9ef;
      padding: 9px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #5b6773;
      font-size: 11px;
      text-transform: uppercase;
    }
    .excerpt {
      max-width: 620px;
      line-height: 1.35;
    }
    .muted { color: #5b6773; }
    .status-ok { color: #267a3d; font-weight: 700; }
    .status-missing { color: #a15c00; font-weight: 700; }
    pre {
      overflow: auto;
      max-height: 420px;
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      background: #0f1720;
      color: #e6edf3;
      white-space: pre-wrap;
    }
    @media (max-width: 860px) {
      header { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <h1>FB Frustrated Customers</h1>
    <div>
      <button id="refresh">Refresh</button>
      <button id="generate" class="primary">Generate Report</button>
      <button id="generateSend">Generate + Email</button>
    </div>
  </header>
  <main>
    <section>
      <div class="section-header">
        <h2>System</h2>
        <span id="updated" class="muted"></span>
      </div>
      <div class="grid">
        <div class="metric"><span>Runs</span><strong id="runsCount">0</strong></div>
        <div class="metric"><span>Items</span><strong id="itemsCount">0</strong></div>
        <div class="metric"><span>Reports</span><strong id="reportsCount">0</strong></div>
        <div class="metric"><span>Schedule</span><strong id="schedule">10 PM</strong></div>
      </div>
      <div class="body" id="config"></div>
    </section>

    <section>
      <div class="section-header">
        <h2>Recent Matches</h2>
        <span class="muted">Latest stored raw candidates</span>
      </div>
      <div class="body">
        <table>
          <thead><tr><th>When</th><th>Author</th><th>Keywords</th><th>Excerpt</th><th>Link</th></tr></thead>
          <tbody id="itemsBody"></tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="section-header">
        <h2>Latest Report</h2>
        <span id="reportStatus" class="muted"></span>
      </div>
      <div class="body">
        <pre id="reportPreview">No report generated yet.</pre>
      </div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    async function api(path, options) {
      const response = await fetch(path, options);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Request failed');
      return json;
    }
    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      })[char]);
    }
    function renderConfig(configured) {
      const rows = Object.entries(configured).map(([key, value]) => {
        const label = value ? 'configured' : 'missing';
        const cls = value ? 'status-ok' : 'status-missing';
        return '<span class="' + cls + '">' + key + ': ' + label + '</span>';
      });
      $('config').innerHTML = rows.join(' &nbsp; ');
    }
    function renderItems(items) {
      $('itemsBody').innerHTML = items.map((item) => {
        const link = item.permalink || item.sourceUrl || item.groupUrl || '';
        return '<tr>' +
          '<td>' + escapeHtml(item.extractedAt || item.receivedAt || '') + '</td>' +
          '<td>' + escapeHtml(item.authorName || '') + '</td>' +
          '<td>' + escapeHtml((item.matchedKeywords || []).join(', ')) + '</td>' +
          '<td class="excerpt">' + escapeHtml((item.text || '').slice(0, 420)) + '</td>' +
          '<td>' + (link ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noreferrer">Open</a>' : '') + '</td>' +
          '</tr>';
      }).join('');
    }
    function renderReport(report) {
      if (!report) {
        $('reportPreview').textContent = 'No report generated yet.';
        $('reportStatus').textContent = '';
        return;
      }
      const aiText = report.ai && report.ai.text ? report.ai.text : '';
      const local = report.localSummary || {};
      $('reportStatus').textContent = report.createdAt + ' | items: ' + report.itemCount;
      $('reportPreview').textContent = aiText || JSON.stringify(local, null, 2);
    }
    async function refresh() {
      const [status, items, reports] = await Promise.all([
        api('/api/status'),
        api('/api/items?limit=50'),
        api('/api/reports?limit=1')
      ]);
      $('runsCount').textContent = status.status.counts.runs;
      $('itemsCount').textContent = status.status.counts.items;
      $('reportsCount').textContent = status.status.counts.reports;
      $('schedule').textContent = status.status.reportSchedule.hour + ':00 ' + status.status.reportSchedule.timezone;
      $('updated').textContent = new Date().toLocaleString();
      renderConfig(status.status.configured);
      renderItems(items.items);
      renderReport((reports.reports || [])[0]);
    }
    async function generate(sendEmail) {
      $('reportPreview').textContent = 'Generating report...';
      const result = await api('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinceHours: 24, sendEmail })
      });
      renderReport(result.report);
      await refresh();
    }
    $('refresh').addEventListener('click', () => refresh().catch(alert));
    $('generate').addEventListener('click', () => generate(false).catch(alert));
    $('generateSend').addEventListener('click', () => generate(true).catch(alert));
    refresh().catch((error) => {
      $('reportPreview').textContent = error.message || String(error);
    });
  </script>
</body>
</html>`;
}

function startDailyScheduler() {
  setInterval(() => {
    runScheduledReportIfDue().catch((error) => console.error("Scheduled report failed", error));
  }, 60 * 1000);
}

async function runScheduledReportIfDue() {
  const parts = getTimeParts(CONFIG.reportTimezone);
  if (parts.hour !== CONFIG.reportHour || parts.minute !== 0) return;

  const state = readJsonFile(FILES.state, { lastScheduledReportDate: "" });
  if (state.lastScheduledReportDate === parts.date) return;

  state.lastScheduledReportDate = parts.date;
  writeJsonFile(FILES.state, state);
  await generateAndStoreReport({ sinceHours: 24, sendEmail: true });
}

function getTimeParts(timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function requireAdmin(request, response) {
  if (!CONFIG.adminUsername || !CONFIG.adminPassword) {
    sendHtml(response, renderSetupRequired(), 503);
    return false;
  }

  const auth = request.headers.authorization || "";
  if (!auth.startsWith("Basic ")) {
    sendBasicAuthChallenge(response);
    return false;
  }

  const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (!timingSafeEqual(username, CONFIG.adminUsername) || !timingSafeEqual(password, CONFIG.adminPassword)) {
    sendBasicAuthChallenge(response);
    return false;
  }

  return true;
}

function sendBasicAuthChallenge(response) {
  response.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="fb-frustrated-customers"'
  });
  response.end("Authentication required.");
}

function renderSetupRequired() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Setup Required</title></head><body><h1>Setup Required</h1><p>ADMIN_USERNAME and ADMIN_PASSWORD must be configured in .env.</p></body></html>`;
}

async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (_error) {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function setBaseHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function sendHtml(response, html, statusCode = 200) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function normalizePathname(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

async function readJsonl(filePath) {
  const text = await fs.promises.readFile(filePath, "utf8").catch(() => "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);
}

async function appendJsonl(filePath, value) {
  await fs.promises.appendFile(filePath, `${JSON.stringify(value)}\n`);
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function timingSafeEqual(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function hashItem(item) {
  return crypto
    .createHash("sha256")
    .update([item.groupUrl, item.authorName, item.text].join("|"))
    .digest("hex")
    .slice(0, 24);
}

function sanitizeText(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").slice(0, maxLength);
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function increment(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, limit) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function makeExcerpt(text, maxLength) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

