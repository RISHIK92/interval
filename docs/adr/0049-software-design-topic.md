# 0049. A fifth topic: software design

- Status: ACCEPTED (owner, 2026-11-23: option 2)
- Date: 2026-11-23
- Supersedes: none
- Superseded by: none

## Context

The LLD practice catalog (`docs/lld-practice-catalog.md`, Q-WD-28) needs 58 concepts on object-oriented design, SOLID and design patterns. Every concept has a topic (`concept.topic`), and the topic type allows only the four launch topics. Product §2 says: "Launch topics are narrow and deep: system design, databases, distributed systems, and backend, covered by about 250 concepts." C-32 kept those four over the wireframes' longer list. Asked where the new concepts go, the owner chose a new "software design" topic now, over filing them under backend (2026-11-23).

A topic is more than a label. The `topic` type drives:

- onboarding's choices (stored in `user_preferences.topics`);
- the feed and the starter feeds, which rank reading from sources tagged with a topic (CACHE-1, ADR-0008);
- source topics at ingestion;
- topic art (ADR-0019);
- Paths' topic paths;
- Explore's spaces (ADR-0046: "spaces = the topics").

Today no source is tagged software design, so a topic with only practice problems and concepts has no reading behind it.

## Options

1. **A fifth topic everywhere at once.**
   - Effect: add `software-design` to the type; onboarding offers it; feed, Explore and Paths show it.
   - Pros: one meaning, everywhere.
   - Cons: someone who picks only software design gets an empty feed until sources exist (§5C's starter feed has nothing). It breaks "narrow and deep" without the content behind it.
   - Reversal: hard once users have chosen it.
2. **The fifth topic, offered where content exists (recommended).**
   - Effect: add `software-design` to the type, so concepts, practice problems, quizzes, review and mastery use it now.
   - Effect: onboarding, the feed's topic chips and Explore's spaces offer it only once there are sources tagged software design that have produced reading. A config-free rule: a topic is offered when its starter feed has cards.
   - Effect: Paths may offer a software-design path built from practice problems and concepts.
   - Pros: no empty feed, and the owner's choice holds.
   - Cons: a rule to test ("offered when it has reading").
   - Reversal: moderate.
3. **File the concepts under backend** (the earlier recommendation, which the owner declined).

## Recommendation (not a decision)

Option 2. It does what the owner chose (a fifth topic now) without showing anyone an empty feed. Adding reading sources for software design (ING-2 rights checked per source) is a separate content step.

## Consequences

- **Migration:** `alter type topic add value 'software-design'`. Postgres can't remove an enum value, so reversing this means a new type.
- **Codegen and shared lists:** codegen updates the TS and Python types. Every list of topics (onboarding choices, topic art, the starter-feed builder, Explore spaces) gains the new topic behind the "has reading" rule.
- **Seeds:** the 58 concepts go into the concept seed with `topic: software-design`, as version 4.
- **Docs:** product §2's launch list isn't edited (decisions and product are read-only). This ADR records the change, and C-32 gets a note.

## Open questions

- Which reading sources count for software design? This is the content step, with each source's rights profile checked (ING-2).
- Should onboarding show the topic as "coming soon" before it has reading, or hide it?
