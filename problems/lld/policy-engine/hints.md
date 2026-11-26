> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each policy's text were parsed once into an object that can answer "do you match this request?", what would deciding a request become?

## Approach

Interpret the policy language by parsing each text once, when it's added, into a policy object: its effect, role, action, hour range (or none) and a resource pattern object. The pattern keeps a list of parts (a literal character, "any run", or "the user's name"), and matching expands the user's name into literal characters, then runs a small dynamic program over pattern items and resource characters. Deciding is a chain: walk the policies in the order they were added asking each whether it matches; do it once looking only at denies and then once at allows, so a deny anywhere beats every allow, and fall off the end to the no-match answer.

## Code sketch

```text
class Glob
  parts: list of (char | ANY | USER)
  Glob(text)                          // TODO: split on {user}; braces elsewhere fail
  matches(resource, user) -> bool     // TODO: expand USER, then a DP over items

class Policy
  id, effect, role, action, resource: Glob, hours: (from, to) or none
  Policy(id, text)                    // TODO: 4 or 6 words; validate each
  matches(user, roles, action, resource, hour) -> bool

class PolicyEngine
  policies: list of Policy, in order added

  addPolicy(id, text) -> bool         // TODO: parse first, then refuse a taken id
  removePolicy(id) -> bool            // TODO
  decide(user, roles, action, resource, hour) -> string
    // TODO: validate the request
    // TODO: first matching deny, else first matching allow, else "no-match"
```
