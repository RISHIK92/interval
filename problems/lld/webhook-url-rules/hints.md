> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Three methods have to report the same violations for the same URL. Where should the rules live so that a fourth rule can't end up in only two of them?

## Approach

Put every rule in one validator object (a URL policy) with a single `violations(url)` method that returns the rule names in their fixed order. `createHook`, `updateHook` and `testUrl` all call it and differ only in what they do with an empty answer: store a new hook, replace a hook's URL, or nothing. Keep host parsing and the "is this address internal" check as small functions the policy uses, apart from the hook bookkeeping. Hooks live in an insertion-ordered map from id to URL, so `hooks()` comes out in creation order and an update keeps its place.

## Code sketch

```text
class UrlPolicy
  violations(url) -> list
    // TODO: fail on an empty URL
    // TODO: host = hostOf(url)
    // TODO: append "length", "scheme", "host" in order when broken

hostOf(url) -> string        // TODO: after "://", cut at / ? # :, lower case
internal(host) -> bool       // TODO: "", localhost, or a private IPv4

class WebhookRules
  policy: UrlPolicy
  urls: ordered map id -> url

  createHook(url) -> list
    // TODO: found = policy.violations(url); store "hook-<n>" if empty
  updateHook(hookId, url) -> list
    // TODO: fail on an unknown id first; replace the URL if no violations
  testUrl(url) -> list       // TODO: policy.violations(url)
  hooks() -> list            // TODO: "<id> <url>" in creation order
```
