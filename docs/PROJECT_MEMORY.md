# Project Memory: fb-frustrated-customers

Last updated: 2026-06-30

## Purpose

`fb-frustrated-customers` monitors authorized Facebook group content for quilting frustrations and quilting machine advice requests. The current system uses a Chrome extension running in the user's normal logged-in Facebook browser session, uploads matched candidates to a DigitalOcean server, analyzes stored matches with OpenAI, and shows reports in a password-protected dashboard.

## Current Decisions

- Project name: `fb-frustrated-customers`.
- Local repo: `/Users/ericsmith/projects/fb-frustrated-customers`.
- GitHub remote: `git@github.com:ericsmith-commits/fb-frustrated-customers.git`.
- Runtime server: DigitalOcean droplet at `198.199.70.201`.
- SSH alias: `social`, using repo-local `ssh_config`.
- Remote app path: `/opt/fb-frustrated-customers`.
- Systemd service: `fb-frustrated-customers.service`.
- Dashboard URL: `http://198.199.70.201:3080/dashboard`.
- Health URL: `http://198.199.70.201:3080/health`.
- Ingest endpoint: `http://198.199.70.201:3080/api/ingest/facebook`.
- Reports are dashboard-only. Gmail/email/SMS delivery was intentionally removed.
- Daily scheduled report time: 10 PM America/Chicago, controlled by `REPORT_HOUR` and `REPORT_TIMEZONE`.
- Raw matched content is retained indefinitely in server-side JSONL files.

## Security And Boundaries

- Do not commit secrets, tokens, passwords, private keys, raw `.env` files, or Facebook credentials.
- Server secrets live in `/opt/fb-frustrated-customers/.env` on the droplet.
- The Chrome extension uses a bearer ingest token configured locally in extension settings.
- The app does not store Facebook login credentials.
- The app does not bypass MFA, CAPTCHA, checkpoints, access denials, or platform blocks.
- Facebook collection is user-session assisted through the Chrome extension, not headless scraping from the droplet.
- Raw Facebook data and generated reports may contain personal data. Keep data backups private.

## Architecture

### Chrome Extension

Path: `extension/`

Responsibilities:

- Runs inside the user's normal logged-in Chrome session.
- Scans approved Facebook group pages.
- Matches candidate content using configured keywords.
- Captures visible text, author name when visible, source/permalink URLs, timestamp text, matched keywords, and extraction time.
- Uploads candidate matches to the server ingest endpoint.
- Includes debug/preview options for troubleshooting. Production scans should run with debug/unmatched mode off.

Chrome load path:

```text
chrome://extensions -> Developer mode -> Load unpacked -> /Users/ericsmith/projects/fb-frustrated-customers/extension
```

### Server

Path: `server/index.js`

Responsibilities:

- `GET /health`
- `POST /api/ingest/facebook`
- Basic-auth dashboard at `/dashboard`
- `GET /api/status`
- `GET /api/items`
- `GET /api/runs`
- `GET /api/reports`
- `POST /api/reports/generate`
- Daily 10 PM dashboard report generation

Storage:

```text
/opt/fb-frustrated-customers/data/runs.jsonl
/opt/fb-frustrated-customers/data/items.jsonl
/opt/fb-frustrated-customers/data/reports.jsonl
/opt/fb-frustrated-customers/data/state.json
```

OpenAI is used when `OPENAI_API_KEY` is configured. The default model is set by `OPENAI_MODEL` in `.env.example`.

## Common Commands

Local validation:

```sh
cd /Users/ericsmith/projects/fb-frustrated-customers
npm run check
npm run smoke
```

Remote service:

```sh
./scripts/remote 'systemctl status fb-frustrated-customers.service --no-pager'
./scripts/remote 'systemctl restart fb-frustrated-customers.service'
./scripts/remote 'journalctl -u fb-frustrated-customers.service -n 100 --no-pager'
```

Deploy source to droplet, preserving `.env` and runtime data:

```sh
rsync -az --delete --exclude .git --exclude .env --exclude data --exclude logs --exclude node_modules -e "ssh -F /Users/ericsmith/projects/fb-frustrated-customers/ssh_config" /Users/ericsmith/projects/fb-frustrated-customers/ social:/opt/fb-frustrated-customers/
./scripts/remote 'systemctl restart fb-frustrated-customers.service'
```

## Data Backup

The source repo intentionally ignores runtime data. Back up droplet data to a separate local git repo:

```sh
cd /Users/ericsmith/projects/fb-frustrated-customers
./scripts/backup-data
```

Default local backup repo:

```text
/Users/ericsmith/projects/fb-frustrated-customers-data-backup
```

The user decided to skip a private GitHub repo for data backups, so backups are local-only unless that decision changes.

## Current Operational Workflow

1. Run the Chrome extension scan from the user's logged-in Facebook session.
2. Confirm new candidates appear in the dashboard.
3. Click `Generate Report`.
4. Wait for the dashboard progress status. OpenAI reports can take 30-60 seconds.
5. View the result in the dashboard's `Latest Report` section.
6. Periodically run `./scripts/backup-data`.
7. Check that scheduled 10 PM reports continue appearing in the dashboard.

## Known Gotchas

- If `Generate Report` appears idle, wait up to 60 seconds and hard-refresh the dashboard if needed. The current UI shows progress, but old browser cache may serve older HTML until refreshed.
- If AI report generation fails, first check OpenAI quota and the service logs.
- If scans find too many irrelevant items, disable extension debug/unmatched mode and tighten keywords.
- If scans find zero items, use the extension preview/debug tools to confirm Facebook DOM content is visible to the extension.
- The droplet does not independently browse Facebook groups; collection depends on the local Chrome extension.

## What Has Been Removed Or Deferred

- Gmail reporting was built as a helper path, then intentionally removed.
- SMS delivery is out of scope.
- A private GitHub repo for raw data backup was skipped; local-only backup is the current decision.
- Official Meta API support is deferred unless proper permissions/access become available.
