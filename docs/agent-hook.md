# The agent hook (§7, ADR-0035)

While a coding agent works on a task, Interval offers a short session, and when it
finishes, your place is saved. The hook sends only "started" and "finished": never
prompts, code or anything about the task.

## Set up

1. On Interval, open **Profile → Agent hook**, name the device (e.g. "Work laptop") and
   add it. Copy the token: it's shown once.
2. Build it with `scripts/build-cli.sh`, then copy the one for your machine from
   `dist/interval/` (e.g. `interval-darwin-arm64`) onto your PATH as `interval`.
3. Save the token and tell the CLI where Interval is:

   ```sh
   interval login ivd_…
   export INTERVAL_URL=https://your-interval-site   # in your shell profile
   ```

   `INTERVAL_TOKEN` works instead of `interval login` (it wins when both are set).
   `interval login` keeps the token readable by you only, in your config folder:
   `~/Library/Application Support/interval/token` on macOS,
   `~/.config/interval/token` on Linux. `INTERVAL_URL` must be https (plain http
   only for localhost), and a site that redirects is refused: use its final address.

## Claude Code

In `~/.claude/settings.json` (or a project's `.claude/settings.json`), start when you
send a prompt and stop when Claude finishes:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "interval start" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "interval stop" }] }
    ]
  }
}
```

Claude Code passes the hook a JSON event on stdin; the CLI never reads it.

## Any other agent

Run `interval start` when a task begins and `interval stop` when it ends.

## What it does

- `interval start` tells Interval a task began. About 45 seconds later, if no
  `interval stop` came, macOS and Linux show a notification offering a quick session
  (none on Windows). On macOS it comes from "Script Editor": allow its notifications in
  System Settings the first time. With two agents running at once, one's stop silences
  the other's notification.
- `interval stop` tells Interval the task finished; the page you had open is saved as
  your place, and Home leads with it.
- Each sends one request, `{"idempotency_key": "…"}`, retried with the same key if the
  network fails, for 3 seconds at most in all. If Interval can't be reached the CLI
  warns and exits 0. A missing token or site, a refused token or a redirect exits 1:
  Claude Code shows the message and goes on (only exit 2 would block it).
- Revoke a device on Profile at any time; its token stops working at once.
