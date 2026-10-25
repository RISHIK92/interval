---
description: Draft a new PROPOSED ADR from docs/adr/template.md
argument-hint: <short title>
---

Topic: $ARGUMENTS

1. Find the highest number in docs/adr/ and use the next one, zero-padded to four digits. File name: `NNNN-<kebab-case-title>.md`.
2. Copy the structure of docs/adr/template.md.
3. Status: PROPOSED. Never write ACCEPTED, REJECTED or SUPERSEDED. Only the owner changes status.
4. Context: state the problem precisely. Cite every decision ID, product section, conflict (C-NN) and question it touches. Quote the source text that creates the problem.
5. Options: 2 to 4 real options. For each: pros, cons, and the cost to reverse it later. Write for one full-time engineer on AWS.
6. Recommendation: mark it "Recommendation (not a decision)". Justify it from the docs, not from general preference. If the docs do not support a choice, say so and recommend nothing.
7. Consequences and open questions.
8. Add a row to the index table in docs/adr/README.md with status PROPOSED.
9. If the ADR addresses an item in docs/open-decisions.md, say so in your reply. Do not edit docs/decisions.md or docs/product.md.

Show the file path when done. Do not commit.
