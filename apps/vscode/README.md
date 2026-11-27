# Interval for VS Code

Shows what your coding agent is doing, as Interval's agent hook reported it, and opens
a quick session that fits the wait in your browser. Works in VS Code and in Cursor.

## Sign in

1. Make a device token on Interval: Profile → Agent hook. It's the same token
   `interval login` takes.
2. Set `interval.url` to your Interval site.
3. Run **Interval: Sign in** and paste the token. It's kept in VS Code's secret storage,
   never in settings. **Interval: Sign out** removes it; revoke the device on your
   Profile to stop the token working anywhere.

## Settings

- `interval.url`: your Interval site. https only; plain http only for `localhost`,
  `127.0.0.1` and `::1`, since the token travels with every request.
- `interval.chip`: the break length the suggestions fit (`1-3`, `3-8` or `8-15`
  minutes). Empty uses the one you chose on Interval.

## What it shows

- The status bar: the agent working (and for how long), done, or idle. Click it, or run
  **Interval: Open a quick session**, to pick one of up to 3 suggestions; with none, it
  opens Interval's Home at your break length.
- Problems (a refused token, a plan without the agent hook, a site that can't be
  reached) show in the item's tooltip.

## What it sends

Only `GET {interval.url}/api/agent/status`, with the device token, every 15 seconds
while the window has focus. It never reads your code, file names, workspace or
terminal. It opens only links on your Interval site.
