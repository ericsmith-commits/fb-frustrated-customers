# fb-frustrated-customers

GitHub target:

- `git@github.com:ericsmith-commits/fb-frustrated-customers.git`

## Chrome Extension MVP

The first collector is a Chrome extension that runs inside the user's normal logged-in Facebook browser session.

Load it from:

```text
/Users/ericsmith/projects/fb-frustrated-customers/extension
```

Chrome install path:

```text
chrome://extensions -> Developer mode -> Load unpacked
```

See [extension/README.md](extension/README.md) for usage and the server ingest payload.

## Server MVP

The server receives extension payloads, deduplicates/stores raw matches, shows a Basic-auth dashboard, and can generate a local or OpenAI-backed report.

Deployed server:

- App directory: `/opt/fb-frustrated-customers`
- Systemd service: `fb-frustrated-customers.service`
- Health URL: `http://198.199.70.201:3080/health`
- Dashboard URL: `http://198.199.70.201:3080/dashboard`
- Extension ingest endpoint: `http://198.199.70.201:3080/api/ingest/facebook`
- Server secrets: `/opt/fb-frustrated-customers/.env` on the droplet

Run locally:

```sh
cp .env.example .env
./scripts/generate-secrets
npm start
```

Then open:

```text
http://127.0.0.1:3080/dashboard
```

Validation:

```sh
npm run check
npm run smoke
```

Gmail OAuth setup:

1. In Google Cloud Console, create or select a project.
2. Enable the Gmail API for that project.
3. Configure the OAuth consent screen for the Gmail account that will send reports.
4. Create an OAuth client for a desktop app.
5. Download that OAuth client's JSON file.
6. Run the local helper from this project:

```sh
npm run gmail:oauth -- --credentials-file ~/Downloads/client_secret_....json --login-hint ericsmith@gammill.com
```

Open the printed Google URL in Chrome, approve Gmail sending, then add the printed `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` values to `/opt/fb-frustrated-customers/.env` on the droplet and restart the service.

Remote service commands:

```sh
./scripts/remote 'systemctl status fb-frustrated-customers.service --no-pager'
./scripts/remote 'systemctl restart fb-frustrated-customers.service'
./scripts/remote 'journalctl -u fb-frustrated-customers.service -n 100 --no-pager'
```

Remote host:

- IP: `198.199.70.201`
- SSH alias: `social`
- SSH config: `./ssh_config`
- Private key: `~/.ssh/social_do_ed25519`

## First-time SSH setup

Add this public key to `/root/.ssh/authorized_keys` on the DigitalOcean droplet:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPhAv1jAQdNajZhfpA/cMAKDnq7cGYFDP/sT2hp1tfDF social-digitalocean
```

From the DigitalOcean web console, run:

```sh
mkdir -p /root/.ssh
chmod 700 /root/.ssh
printf '%s\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPhAv1jAQdNajZhfpA/cMAKDnq7cGYFDP/sT2hp1tfDF social-digitalocean' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

Then test from this project:

```sh
ssh -F ./ssh_config social whoami
```

Or use the helper:

```sh
./scripts/remote whoami
```
