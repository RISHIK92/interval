# Webhook URL rules: blocked hosts (extension round)

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The security team wants to block particular hosts, and the block must apply when creating,
updating and testing hooks alike.

- `blockHost(host)`: from now on, a URL whose host (as defined in the base round, in lower
  case) equals `host` in lower case breaks a fourth rule, `blocked`, reported after the
  other three. Only that exact host is blocked, never its subdomains. Blocking a blocked
  host changes nothing. An empty host fails.
- Existing hooks keep their URLs: the rules are checked only when a URL is given.
