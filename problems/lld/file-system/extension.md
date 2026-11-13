# File system: moving and sizing (extension round)

> PROVISIONAL (P5-W33): written during the build; the owner reviews it before launch.

Two methods are added. Nothing that already works changes.

- `mv(source, target)`: moves a file or a directory (with everything inside it) to a new
  path.
- `size(path)`: the number of characters stored: a file's text length, or for a
  directory the total of every file beneath it.
