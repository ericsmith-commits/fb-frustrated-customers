#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const DEFAULT_PORT = 3987;

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || options.help || command === "help") {
    printUsage();
    return;
  }

  if (command !== "authorize") {
    throw new Error(`Unknown command: ${command}`);
  }

  await authorize(options);
}

async function authorize(options) {
  const fileCredentials = options.credentialsFile ? readGoogleCredentials(options.credentialsFile) : {};
  const clientId = options.clientId || fileCredentials.clientId || process.env.GMAIL_CLIENT_ID || "";
  const clientSecret = options.clientSecret || fileCredentials.clientSecret || process.env.GMAIL_CLIENT_SECRET || "";
  const port = Number(options.port || DEFAULT_PORT);
  const loginHint = options.loginHint || process.env.REPORT_SENDER || "";

  if (!clientId) {
    throw new Error("Missing --client-id or GMAIL_CLIENT_ID.");
  }
  if (!clientSecret) {
    throw new Error("Missing --client-secret or GMAIL_CLIENT_SECRET.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port must be an integer between 1024 and 65535.");
  }

  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = crypto.randomBytes(18).toString("hex");
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GMAIL_SEND_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (loginHint) authUrl.searchParams.set("login_hint", loginHint);

  const codePromise = waitForOAuthCallback({ port, state });

  console.log("Open this URL in Chrome and finish the Google consent flow:");
  console.log("");
  console.log(authUrl.toString());
  console.log("");
  console.log(`Waiting for Google to redirect back to ${redirectUri} ...`);

  const code = await codePromise;
  const token = await exchangeCodeForToken({
    clientId,
    clientSecret,
    code,
    codeVerifier,
    redirectUri
  });

  if (!token.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Re-run this command and make sure the consent screen is accepted for the Gmail account that will send reports."
    );
  }

  console.log("");
  console.log("Authorization complete. Add these values to the server .env:");
  console.log("");
  console.log(`GMAIL_CLIENT_ID=${clientId}`);
  console.log(`GMAIL_CLIENT_SECRET=${clientSecret}`);
  console.log(`GMAIL_REFRESH_TOKEN=${token.refresh_token}`);
}

function waitForOAuthCallback({ port, state }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);

      if (requestUrl.pathname !== "/oauth2callback") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found.");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state") || "";
      const code = requestUrl.searchParams.get("code") || "";
      const error = requestUrl.searchParams.get("error") || "";

      if (error) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderCallbackPage("Google authorization was not completed.", error));
        closeServer(server);
        reject(new Error(`Google authorization failed: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderCallbackPage("Google authorization callback was invalid.", ""));
        closeServer(server);
        reject(new Error("Invalid OAuth callback."));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderCallbackPage("Google authorization complete.", "You can close this tab and return to Codex."));
      closeServer(server);
      resolve(code);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCodeForToken({ clientId, clientSecret, code, codeVerifier, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Google token exchange failed with HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

function renderCallbackPage(title, detail) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f7f9; color: #1f2933; }
    main { max-width: 640px; margin: 12vh auto; padding: 24px; background: #fff; border: 1px solid #d8dee6; border-radius: 8px; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
  </main>
</body>
</html>`;
}

function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = toCamelCase(rawKey);

    if (key === "help") {
      options.help = true;
      continue;
    }

    const value = inlineValue !== undefined ? inlineValue : args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${rawKey}.`);
    }
    options[key] = value;
    if (inlineValue === undefined) index += 1;
  }

  return {
    command: positional[0],
    options
  };
}

function readGoogleCredentials(filePath) {
  const resolvedPath = expandHome(filePath);
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const credentials = parsed.installed || parsed.web || parsed;
  const clientId = credentials.client_id || credentials.clientId || "";
  const clientSecret = credentials.client_secret || credentials.clientSecret || "";

  if (!clientId || !clientSecret) {
    throw new Error(`Could not find client_id and client_secret in ${resolvedPath}.`);
  }

  return { clientId, clientSecret };
}

function expandHome(filePath) {
  if (filePath === "~") return process.env.HOME || filePath;
  if (filePath.startsWith("~/")) {
    return path.join(process.env.HOME || "", filePath.slice(2));
  }
  return filePath;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function closeServer(server) {
  server.close((error) => {
    if (error) console.error(error.message || error);
  });
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printUsage() {
  console.log(`Usage:
  node scripts/gmail-oauth.js authorize --credentials-file ~/Downloads/client_secret_....json
  node scripts/gmail-oauth.js authorize --client-id <google-client-id> --client-secret <google-client-secret>

Options:
  --credentials-file <path>  Downloaded Google OAuth client JSON file.
  --login-hint <email>  Gmail account to suggest on the Google consent screen.
  --port <port>        Local callback port. Defaults to ${DEFAULT_PORT}.

The OAuth client should be a Google Cloud desktop app client with the Gmail API enabled.
Requested scope: ${GMAIL_SEND_SCOPE}`);
}
