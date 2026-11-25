# Changelog generator: breaking changes first (extension round)

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Users skim release notes for what will break their build. Breaking commits (a header with
`!`) should come first, under their own heading.

- `breakingSection(on)`: from now on, each release lists the breaking commits under
  `### BREAKING`, before every other section, and leaves them out of the section their
  type would put them in. Like the others, the section appears only when it has commits.
  `breakingSection(false)` goes back to listing them by type. It starts out off, and applies to
  every commit a release lists, whenever it was recorded.
- Lines under `### BREAKING` have the usual form, in commit order.
