# 0017. Five-tab bar with the later tabs shown disabled

- Status: ACCEPTED
- Date: 2026-10-26
- Supersedes: none (amends ADR-0006 C-06)
- Superseded by: none

## Context

ADR-0006 (ACCEPTED), C-06: "Home and Library tabs plus Profile from the avatar. No Explore or search in Phase 1 (Q-P1-42)." The proposal it accepted read: "For Phase 1, show Home and Library only; hide Explore, Paths and Play until their phase." Q-P1-19 (answered): "Home and Library tabs, Profile from the avatar (ADR-0006 C-06)." Q-P1-42 (answered): "Not in Phase 1. Explore tab hidden."

The owner's app design (docs/wireframes/app-design.html, screens 2 and 8) shows five tabs: Home, Explore, Paths, Play and Library. In the design pass (2026-10-26) the owner chose "restyle plus placeholders", and for the tab bar "five tabs, three shown disabled". Home and Library work; Explore, Paths and Play show greyed out with "Coming later" and are not links.

The design-pass foundation slice built it that way. CLAUDE.md ranks ACCEPTED ADRs above other instructions, so this change to C-06 needs its own record.

## Decision

Accepted by the owner on 2026-10-26: option A (five tabs, three disabled until their phase). The open questions below still need the owner's answers before the work that depends on them.

## Options

### A. Five tabs, three disabled until their phase

- Pros:
  - Matches the design.
  - The beta sees where the product is going.
  - The bar's layout stays fixed as phases arrive: each tab only turns on.
- Cons:
  - Three controls that do nothing during the beta, which can read as broken.
  - It reverses an accepted decision.
  - Search is still not in Phase 1, so Explore is a promise.
- Cost to reverse: low, a one-file change (TabBar).

### B. Two tabs in the design's style (C-06 as accepted)

- Pros:
  - No conflict.
  - Nothing on screen that doesn't work.
- Cons:
  - The bar changes shape when each later tab arrives.
- Cost to reverse: low.

### C. Five tabs built, only the live ones rendered

- Pros:
  - The component is ready for later phases.
  - C-06 holds on screen.
- Cons:
  - Unused branches in the code until Phase 2.
- Cost to reverse: low.

## Recommendation (not a decision)

The docs support B (C-06, Q-P1-19 and Q-P1-42 all say two tabs, with the rest hidden). The owner chose A in the design pass. If A stands, accepting this ADR records it and amends C-06 for the beta. Nothing else depends on the choice: Explore stays without search until its phase either way.

## Consequences

- If accepted:
  - C-06's "hide Explore, Paths and Play" becomes "show them disabled with 'Coming later'";
  - Q-P1-42's "Explore tab hidden" is read the same way;
  - apps/web/src/app/TabBar.tsx already implements this, and its comment cites this ADR.
- If rejected: TabBar shows Home and Library only (option B or C), one file.

## Open questions

- Should a tap on a disabled tab show anything (for example a short "Coming in Phase 2" note), or nothing?
