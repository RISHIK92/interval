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

## Install the hook for your agent

One command writes the hook into your agent's **user-level** config. It never writes a
project's config, which could be committed and switch the hook on for everyone else.

```sh
interval hook install --agent claude    # or codex, cursor, gemini
interval hook uninstall --agent claude  # removes only Interval's entries
```

- **Merging:** it keeps everything already in the file. It replaces any Interval hook
  there, including a hand-written `interval start` (also by its full path), so there is
  only ever one.
- **Backup:** it saves the file as it was to `<file>.interval-backup`.
- **Running it again** changes nothing.
- **A file that isn't valid JSON** is left alone: fix it, then run the command again.
  Gemini CLI allows comments in its `settings.json`, but the installer can't merge a file
  that has them.
- **Symlinks:** a config file that is a symlink, from a dotfiles manager for example,
  stays a symlink, and the file it points at is the one that changes.
- **Project-level hooks:** earlier versions of these docs suggested adding
  `interval start` to a project's `.claude/settings.json`. Remove that after installing,
  or every prompt will start twice. The installer only touches the user-level file.
- **Formatting:** the file is rewritten with two-space indents and its keys sorted.

| Agent        | File                                                      | Start event          | Stop event   |
| ------------ | --------------------------------------------------------- | -------------------- | ------------ |
| Claude Code  | `~/.claude/settings.json`                                 | `UserPromptSubmit`   | `Stop`       |
| OpenAI Codex | `~/.codex/hooks.json` (`$CODEX_HOME/hooks.json` when set) | `UserPromptSubmit`   | `Stop`       |
| Cursor       | `~/.cursor/hooks.json`                                    | `beforeSubmitPrompt` | `stop`       |
| Gemini CLI   | `~/.gemini/settings.json`                                 | `BeforeAgent`        | `AfterAgent` |

Each runs `interval start --for <agent>` and `interval stop --for <agent>`. With
`--for`, the CLI:

- prints the answer the agent expects: nothing for Claude Code, `{}` for Codex's stop,
  `{"continue":true}` and `{}` for Cursor, and `{}` for Gemini;
- always exits 0, even when Interval can't be reached or the token is refused, so a hook
  never holds up or blocks its agent. Problems go to stderr.

The agent passes its hook a JSON event on stdin, including your prompt. The CLI never
reads it.

Notes per agent (each checked against its docs on 2026-11-27):

- **Codex** runs a new hook only after you trust it: open `/hooks` in Codex once and
  trust Interval's two hooks.
- **Cursor** reloads the file on save; restart Cursor if the hooks don't load. User hooks
  don't run in Cursor's cloud agents.
- **Gemini CLI** now serves only paid API-key and enterprise users. Since 18 June 2026,
  Antigravity CLI has replaced it for everyone else. Antigravity has no installer yet,
  because it has no "prompt sent" event and its docs don't say whether a hook can block.
  Run `interval start`/`stop` by hand there.

## Any other agent

Run `interval start` when a task begins and `interval stop` when it ends.

## Status and suggestions

`interval status` shows what your agent is doing, as the hooks reported it, and
3 things to read that fit your break, each as a link into Interval.

```
Agent: working for 2m 10s
For a 3–8 min break:
1. Why consensus · 2 min
   https://your-interval-site/read/10?moment=1&chip=3-8&pos=1&via=agent
```

- **The agent's state:** "working", "finished" for 10 minutes after it finishes, then
  "idle".
- **Break length:** `--chip 1-3|3-8|8-15` picks one; otherwise it uses the one you chose
  at onboarding.
- **`--json`** prints the API's answer as it came.

The VS Code extension and the desktop app read the same API, `GET /api/agent/status`,
with the same device token. It needs the agent hook in your plan and allows 60 reads a
minute per device. It returns only:

- the task's state and times, which is all a hook sends;
- each suggestion's title, minutes and link, never its content.

An opened link counts as an open "via agent".

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
  warns and exits 0. Run by hand, a missing token or site, a refused token or a redirect
  exits 1. Run by an installed hook (`--for`), it always exits 0.
- Revoke a device on Profile at any time; its token stops working at once.

## Notifications in the browser (web push)

On **Profile → Agent hook**, "Notify me on this device" asks the browser for permission
and subscribes it. About 45 seconds after a task starts, if it hasn't finished, Interval
itself pushes "Your agent is still working. Open Interval for a quick session" to every
browser you turned it on in, besides the CLI's own notification. The push carries only
that text. "Turn off" removes this browser.

It needs a VAPID key pair: `pnpm push:keys` prints one. Put `VAPID_PUBLIC_KEY` where the
web app reads it, and `VAPID_PRIVATE_KEY` with `VAPID_SUBJECT` (`mailto:` or the https
site) where the worker does. Without them, push is simply off.
