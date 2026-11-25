# Startup settings: TLS (extension round)

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The service can now serve TLS, which needs a certificate and its key together. Half a TLS
configuration must never exist.

- `withTls(certPath, keyPath)`: both paths non-empty turns TLS on with them, replacing
  any earlier pair, and returns true. Both empty turns TLS off and returns true. Exactly
  one empty returns false and nothing changes.
- While TLS is on, `describe()` ends with ` tls=<certPath>,<keyPath>`, for example
  `port=8443 workers=4 timeoutMs=3000 tls=cert.pem,key.pem`. Paths are printable ASCII
  with no spaces or commas.
