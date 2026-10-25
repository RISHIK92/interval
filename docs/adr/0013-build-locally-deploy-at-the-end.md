# 0013. Build every phase locally; deploy once everything is built

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

All phases are built and verified locally. The first real deployment, in either ADR-0011 mode, happens only once everything is fully built. Until then, infrastructure is written, tested and synthesised (CDK) or run locally (the VM-mode compose stack), but never deployed.

## Context

- ADR-0005's owner input said "local until the beta (Week 6)". This extends that to all phases.
- docs/roadmap/phase-1.md Week 6 plans a beta with about 30 students and 30 working developers. Phase 1's success measures (docs/roadmap/phase-1-slices.md, measures table) come from that beta's usage.

## Consequences

- **Infra slices:** S08, S09 and S18 still build and test infrastructure. The VM compose stack must run end to end locally, which is its main test.
- **Beta conflict:** the Week 6 beta and the usage-based success measures cannot happen without a deployment. Until the owner decides otherwise, the W6 beta slices are built and verified locally (seeded or synthetic users), and real-user measurement waits for the final deployment.
- **Deploy-only checks:** cost budgets (OPS-4) and AWS-only checks are verified at deploy time.

## Open questions

- Should a small real-user beta still happen before everything is built (it would need a deployment), or does all user validation wait? Asked of the owner; recorded in docs/progress.md.
