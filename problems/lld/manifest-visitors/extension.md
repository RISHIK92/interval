# Manifest checks: security audit (extension round)

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The security team wants its own pass over the manifests. It reads fields the other
operations ignore, and the three kinds of manifest stay exactly as they are.

- `securityAudit()`: a fourth operation over every manifest, in the order they were
  added, returning a line for each risk found:
  - a deployment with `privileged` 1 gives `"deployment/<name>: privileged"`;
  - a service with `public` 1 gives `"service/<name>: public"`;
  - a config map with `secrets` above 0 gives `"configmap/<name>: plain-text secrets"`.

  It is reached only through this method: `runVisitor` still knows only its three
  operations.
