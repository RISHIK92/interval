# Changelog generator

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a changelog generator for a repository that writes conventional commit messages.
Commits come in one by one; a release turns every commit since the last release into
release notes.

- `Changelog()`: an empty changelog.
- `commit(sha, message)`: records the commit and returns true when `message` is a
  conventional commit header (below) and `sha` hasn't been recorded before, released or
  not. Otherwise it returns false and records nothing.
- `release(version)`: turns every commit recorded since the last release into release
  notes, returns them as lines (below) and leaves nothing unreleased. Releasing a version
  that was already released, or releasing with no unreleased commits, fails.
- `unreleased()`: the number of commits recorded since the last release.

**Header.** A message is a header when it is, with nothing before or after:

1. a type: one or more lowercase letters `a`–`z`;
2. optionally a scope: `(`, one or more characters that are neither `(` nor `)`, then `)`;
3. optionally `!`;
4. `: ` (a colon and one space);
5. a description: one or more characters, kept exactly as given.

So `feat(api)!: drop v1` has type `feat`, scope `api` and description `drop v1`, while
`feat:x`, `Feat: x`, `feat(): x` and `feat!(api): x` aren't headers.

**Release notes.** The first line is `## <version>`. Then come up to three sections, in this
order, each only when it has commits: `### Features` (type `feat`), `### Fixes` (type
`fix`) and `### Other` (every other type). Under its section heading, each commit is one
line in commit order: `- <description> (<sha>)`, or `- <scope>: <description> (<sha>)` when
it has a scope, where `<sha>` is the sha's first 7 characters (all of it when shorter). A
`!` doesn't change where a commit is listed or how.

An empty sha, message or version fails. A call that fails changes nothing. Shas,
messages and versions are printable ASCII and case-sensitive, at most 100 characters
each, and there are at most 10^4 calls.
