# Chrome Extension MVP

This extension is a user-initiated Facebook group collector for the approved quilting groups in the PRD.

It runs inside the user's normal logged-in Chrome session. It does not store a Facebook username or password.

## Install In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

```text
/Users/ericsmith/projects/fb-frustrated-customers/extension
```

5. Pin `FB Collector` to the toolbar.

## Use

### Scan One Group

1. Open an approved Facebook group in Chrome.
2. Click the extension.
3. Click `Scan Current Group`.
4. Export the last run as JSON, or enable upload in settings once the server endpoint exists.

### Scan All Approved Groups

1. Click the extension.
2. Click `Run Approved Groups`.
3. Leave Chrome open while it moves through the group list.
4. The scan stops if it detects a login screen, checkpoint, CAPTCHA, security check, or temporary block.

## Settings

Open the extension settings to configure:

- Approved Facebook group URLs.
- Keywords/phrases.
- Scroll passes and delays.
- Optional server ingest endpoint.
- Optional ingest token.

The ingest token is stored only in Chrome extension local storage, not in git.

## Server Ingest Payload

When upload is enabled, the extension sends:

```json
{
  "runId": "run_example",
  "mode": "approved-groups",
  "startedAt": "2026-06-29T00:00:00.000Z",
  "finishedAt": "2026-06-29T00:02:00.000Z",
  "groups": [
    {
      "url": "https://www.facebook.com/groups/example",
      "resolvedUrl": "https://www.facebook.com/groups/example",
      "status": "scanned",
      "reason": "",
      "itemCount": 3
    }
  ],
  "items": [
    {
      "contentHash": "abc123",
      "sourceUrl": "https://www.facebook.com/groups/example",
      "groupUrl": "https://www.facebook.com/groups/example",
      "permalink": "https://www.facebook.com/groups/example/posts/123",
      "authorName": "Example Author",
      "timestampText": "2h",
      "matchedKeywords": ["tension", "help"],
      "text": "Visible post/comment text...",
      "extractedAt": "2026-06-29T00:01:00.000Z"
    }
  ],
  "upload": {
    "uploaded": true
  }
}
```

## Guardrails

- No Facebook password storage.
- No CAPTCHA, MFA, checkpoint, or block bypass.
- Only approved group URLs should be configured.
- Collection is user-initiated.
- The scanner only reads content visible to the logged-in browser session.

