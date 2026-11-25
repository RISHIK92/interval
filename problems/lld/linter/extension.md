# Lint rules: banned words (extension round)

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The team wants markers like `TODO` kept out of merged code. That's a new rule.

- `banWord(word)`: bans `word`, and enables the `ban-word` rule if it isn't yet. A line is
  reported under `ban-word` when it contains any banned word anywhere, as an exact,
  case-sensitive substring (so banning `TODO` reports `TODOS` but not `todo`). Banning a
  word twice changes nothing. An empty word fails.
- Words are printable ASCII (spaces included), case-sensitive, at most 100 characters.
- `ban-word` is listed by `enabled()` and ordered among the findings like any other rule.
  It is enabled only through `banWord`: `enable("ban-word", ...)` still fails.
