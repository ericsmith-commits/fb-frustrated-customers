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
- User is only a member, not an admin/moderator.
- Group privacy mix includes public, private visible, and private hidden groups.

Target groups:

- `https://www.facebook.com/groups/505493696258285`
- `https://www.facebook.com/groups/quiltforbeginner`
- `https://www.facebook.com/groups/734897391515879`
- `https://www.facebook.com/groups/quiltingwithgrace`
- `https://www.facebook.com/groups/QuiltworxSupportNetwork`
- `https://www.facebook.com/groups/1161775635931586`
- `https://www.facebook.com/groups/1863239133741750`
- `https://www.facebook.com/groups/1717605408509439`
- `https://www.facebook.com/groups/1775399766066931`
- `https://www.facebook.com/groups/piecenquiltshowntell`
- `https://www.facebook.com/groups/246655093339813`
- `https://www.facebook.com/groups/944995005538991`
- `https://www.facebook.com/groups/2424992714378784`
- `https://www.facebook.com/groups/720719184665984`
- `https://www.facebook.com/groups/1199808553537539`
- `https://www.facebook.com/groups/longarmquiltersmastermind`
- `https://www.facebook.com/groups/3406021916228247`
- `https://www.facebook.com/groups/2085363975094785`
- `https://www.facebook.com/groups/126156127426591`
- `https://www.facebook.com/groups/156508974375452`
- `https://www.facebook.com/groups/1408108043616113`
- `https://www.facebook.com/groups/quiltingpatternsfree/`
- `https://www.facebook.com/groups/myhobbyisquilting2024`
- `https://www.facebook.com/groups/809294995361853`
- `https://www.facebook.com/groups/1490640654347572`
- `https://www.facebook.com/groups/124027754298403`
- `https://www.facebook.com/groups/1514454045381367`
- `https://www.facebook.com/groups/1845507839076195`

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
- Facebook group URLs are supplied.
- User is only a member of the groups.
- Raw Facebook username/password login is not an acceptable integration method for this project. The app should use an authorized API/OAuth path, or mark Facebook group automation as blocked and support manual/CSV imports.

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
- Implementation path: Gmail API OAuth.
- Sender account: `ericsmith@gammill.com`.

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
- Google Workspace Gmail API OAuth client credentials and refresh token.
- Generated admin dashboard username/password and session secret, stored only on the server.

## Suggested Technical Stack

- TypeScript/Node.js.
- Next.js or Express plus React for the admin dashboard.
- SQLite initially, with a clean path to Postgres if volume grows.
- Meta Graph API client for Facebook data access.
- OpenAI Responses API for classification and report generation.
- Email via Google Workspace using Gmail API OAuth.
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
- Target GitHub owner/account: `ericsmith-commits`
- Target remote URL: `git@github.com:ericsmith-commits/fb-frustrated-customers.git`
- Dedicated GitHub SSH key path: `~/.ssh/github_fb_frustrated_customers_ed25519`
- Dedicated GitHub SSH key fingerprint: `SHA256:R4kBQe/Db0uwkjo8yymhm6Y0OeXmIHcthohXs+v/jJQ`
- Local project folder should be renamed to `/Users/ericsmith/projects/fb-frustrated-customers`.

## Open Questions

1. Can you create a Meta Developer app and complete any required review/permission steps if Meta requires it?
2. Has the GitHub repository `ericsmith-commits/fb-frustrated-customers` been created, and has the copied SSH public key been added to GitHub?
3. Are manual CSV/import workflows acceptable for Facebook groups that cannot be accessed through Meta-approved APIs?
