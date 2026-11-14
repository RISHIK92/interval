# URL shortener: expiry (extension round)

> PROVISIONAL (P5-W34): written during the build; the owner reviews it before launch.

Codes can now be withdrawn.

- `expire(code)`: removes the code, whether generated or custom. An unknown (or already
  expired) code fails and changes nothing.
- After that, `expand(code)` and `hits(code)` fail for it, and a custom alias may be
  taken again (with a fresh hit count).
- `shorten(url)` for a url whose generated code was expired gives it a new code from the
  counter. Counter values are never reused.
- A code freed by `expire` is free for everything: if the counter later reaches it, a new
  url gets it.
