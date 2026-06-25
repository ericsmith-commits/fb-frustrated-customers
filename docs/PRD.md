# PRD: Facebook Frustrated Customers Monitor

## Working Name

Facebook Frustrated Customers Monitor

GitHub repository name target: `fb-frustrated-customers`

## Purpose

Build a 24/7 server-hosted web app that collects authorized Facebook content related to quilting frustrations and quilting machine advice-seeking, analyzes it with OpenAI, and sends a daily report to `ericsmith@gammill.com`.

## Operating Environment

- Runs on the DigitalOcean server defined in `/Users/ericsmith/projects/AGENTS.md`.
- Runs continuously as a server service.
- Scheduled daily job runs at 10:00 PM America/Chicago.
- Includes a small password-protected admin dashboard.
- Project files are backed up to git.

## Data Source

Primary source: Facebook.

Target source type:

- Specific Facebook Groups the user is already a member of.
- Exact group URLs/IDs are still required.

Required collection:

- Posts/comments mentioning quilting frustrations.
- Posts/comments seeking advice on quilting machines.

Important implementation constraint:

- Use authorized Meta/Facebook API access wherever available.
- Do not store Facebook passwords in git.
- Do not implement CAPTCHA/MFA bypass or evasive browser automation.
- If a source cannot be accessed through authorized API access, mark it unsupported until access/permission is resolved.
- Current planning assumption: Facebook group access is the largest feasibility risk. Meta's old Groups API documentation path redirects to the generic docs home, the checked Group feed reference redirects to the generic Graph API reference, and the checked `groups_access_member_info` permission reference returns HTTP 404 as of 2026-06-25. The build must validate each requested group source before promising automated collection.

Access status:

- No Meta Developer app exists yet.
- No Meta app permissions or access tokens exist yet.
- No Facebook group URLs/IDs supplied yet.

Recommended source strategy:

- Build a source adapter layer so the app can support whichever authorized source path is available.
- First attempt an official Meta API/token path for each group.
- If Meta does not expose group content for the requested source, keep the app functional for dashboarding, reporting, and manual/CSV imports, but mark that group as blocked for automated Facebook collection.

## Analysis

Use OpenAI to classify, cluster, and summarize relevant Facebook content.

Initial classification categories:

- Quilting frustration.
- Quilting machine advice request.
- Product/service opportunity.
- Urgency/risk.
- Brand or competitor mention.
- Not relevant.

The report should summarize:

- Top frustration themes.
- Top machine-advice questions.
- Notable posts/comments with links when available.
- Potential customer opportunities.
- Suggested follow-up talking points.
- Trend changes versus previous runs once historical data exists.

## Delivery

Daily email report recipient:

- `ericsmith@gammill.com`

Email provider:

- Google Workspace.
- Preferred implementation path is Gmail API OAuth or Google Workspace SMTP relay, depending on which credentials/admin access the user can supply.

Text/SMS delivery:

- Out of scope for v1. Email only.

## Admin Dashboard

Minimum dashboard features:

- View last run status.
- Trigger a manual run.
- Manage monitored Facebook sources.
- View recent matched items.
- View generated reports.
- Configure report recipient.
- Configure schedule.
- View errors and login/API permission issues.

## Credentials And Secrets

Secrets must be stored outside git, preferably in server-side `.env` files or a server secrets file with restrictive permissions.

Expected secrets:

- OpenAI API key.
- Meta/Facebook app credentials and access token(s), if available.
- Google Workspace email credentials, OAuth client, refresh token, or SMTP relay credentials.
- Admin dashboard password/session secret.

## Suggested Technical Stack

- TypeScript/Node.js.
- Next.js or Express plus React for the admin dashboard.
- SQLite initially, with a clean path to Postgres if volume grows.
- Meta Graph API client for Facebook data access.
- OpenAI Responses API for classification and report generation.
- Email via Google Workspace using Gmail API OAuth or SMTP relay.
- Systemd service plus app-level scheduler for 10:00 PM America/Chicago.
- Docker optional; systemd with Node is acceptable for the current single-server setup.

## Backfill And Retention

- Initial backfill target: posts/comments from the last six months.
- Daily run target: new posts/comments since the previous successful run.
- Retain matched raw content indefinitely.
- Include author names in stored matches and reports.

## Git

- Commit author name: `ericsmith-commits`
- Commit author email: `ericsmith@gammill.com`
- Target remote repository name: `fb-frustrated-customers`

## Open Questions

1. What are the exact Facebook Group URLs/IDs to monitor?
2. Are you an admin/moderator of those groups, or only a member?
3. Are these groups public, private visible, or private hidden?
4. Can you create a Meta Developer app and complete any required review/permission steps if Meta requires it?
5. For Google Workspace email, should we use Gmail API OAuth, or can your Workspace admin configure SMTP relay?
6. What admin dashboard username/password should be used, or should we generate one and store it on the server?
7. Should the local folder remain `/Users/ericsmith/projects/social`, or should this project be renamed to `fb-frustrated-customers`?
