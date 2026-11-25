# Webhook URL rules

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A service sends webhooks to URLs its users register. Creating a hook, updating a hook and
testing a URL each check the URL against the same rules, and all three must report the
same violations for the same URL.

A URL's **host** is the part after its first `://`, up to the first `/`, `?` or `#` after
that, and without anything from a `:` on (the port), compared in lower case. A URL with
no `://` has an empty host. For example, the host of `https://Pager.example:8443/in?x=1`
is `pager.example`.

The rules, each reported by its name, in this order:

1. `length`: the URL is longer than 200 characters.
2. `scheme`: the URL doesn't start with exactly `https://` (lower case).
3. `host`: the host is empty, `localhost`, or a loopback or private IPv4 address: one
   whose first number is 10 or 127, or whose first two numbers are 172 and 16 to 31, or
   192 and 168.
   A host is an IPv4 address only when it's four numbers from 0 to 255 joined by `.`,
   each written as one to three digits (so `010.0.0.1` is `10.0.0.1`, and `10.0.0.256`
   or `10.example.com` is an ordinary name).

- `WebhookRules()`: starts with no hooks.
- `createHook(url)`: the URL's violations. When there are none, a hook is created with the
  id `hook-<n>`, where n is the number of hooks created so far plus one (`hook-1`,
  `hook-2`, ...). When there are any, nothing changes.
- `updateHook(hookId, url)`: the URL's violations. When there are none, the hook now
  sends to `url`. When there are any, the hook keeps its URL. An unknown hook id fails.
- `testUrl(url)`: the URL's violations, and nothing else happens.
- `hooks()`: every hook as `<id> <url>`, in the order the hooks were created.

An empty URL fails in every call. A call that fails changes nothing, and failing comes first: an
unknown hook id fails even when the URL would be refused. Hook ids are case-sensitive. URLs
are printable ASCII with no spaces and no `@`, at most 400 characters. There are at most
10^4 calls.
