"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fbfc-smoke-"));
const port = 43187;
const adminUsername = "smoke-admin";
const adminPassword = "smoke-password";
const ingestToken = "smoke-token";

const child = spawn(process.execPath, ["server/index.js"], {
  cwd: rootDir,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    ADMIN_USERNAME: adminUsername,
    ADMIN_PASSWORD: adminPassword,
    INGEST_TOKEN: ingestToken,
    OPENAI_API_KEY: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

function basicAuth() {
  return `Basic ${Buffer.from(`${adminUsername}:${adminPassword}`).toString("base64")}`;
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Server did not start. Output:\n${output}`);
}

async function main() {
  await waitForServer();

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);

  const ingest = await fetch(`http://127.0.0.1:${port}/api/ingest/facebook`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ingestToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      runId: "smoke-run",
      mode: "smoke",
      groups: [{ url: "https://www.facebook.com/groups/example", status: "scanned", itemCount: 1 }],
      items: [
        {
          contentHash: "smoke-hash",
          groupUrl: "https://www.facebook.com/groups/example",
          permalink: "https://www.facebook.com/groups/example/posts/1",
          authorName: "Smoke Tester",
          matchedKeywords: ["tension", "help"],
          text: "I need help with quilting machine tension and skipped stitches.",
          extractedAt: new Date().toISOString()
        }
      ]
    })
  });
  assert.equal(ingest.status, 200);
  const ingestJson = await ingest.json();
  assert.equal(ingestJson.newItems, 1);

  const status = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: { Authorization: basicAuth() }
  });
  assert.equal(status.status, 200);
  const statusJson = await status.json();
  assert.equal(statusJson.status.counts.items, 1);

  const report = await fetch(`http://127.0.0.1:${port}/api/reports/generate`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sinceHours: 24 })
  });
  assert.equal(report.status, 200);
  const reportJson = await report.json();
  assert.equal(reportJson.report.itemCount, 1);

  console.log("smoke ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill("SIGTERM");
  });
