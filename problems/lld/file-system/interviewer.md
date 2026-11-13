# File system: interviewer notes (private)

Never shown to players. Answer a player's question from these notes only, in one or two
sentences, as an interviewer would. If a question is not settled here, say it is up to
them and that hidden tests only cover what is written here. Do not volunteer other
decisions, do not reveal test contents, and do not write code.

## Paths

- A path must start with `/`. Anything else (empty string, `a/b`, `docs`) is an invalid
  path and fails.
- Split on `/`. Empty segments are ignored, so a trailing slash and `//` are harmless:
  `/a/b/`, `/a//b` and `/a/b` are the same path.
- A `.` segment is ignored. A `..` segment removes the segment before it. `..` at the
  root (more `..` than segments before it) is an invalid path and fails.
- `..` is resolved by the text alone, before looking anything up. `/x/../a` is `/a` even
  when `/x` does not exist.
- The root is `/` (also `//`, `/.`, `/a/..`). Names are case sensitive and may hold any
  characters other than `/`. Tests use only ASCII.
- Every method resolves its path(s) first; an invalid path fails before anything else.

## Methods

- `mkdir(path)`: creates the directory and every missing parent (like `mkdir -p`).
  If the directory already exists, nothing happens and it does not fail. It fails if the
  path, or any part of it on the way, is an existing file. `mkdir("/")` does nothing.
- `write(path, text)`: creates the file, or replaces its whole text if it exists.
  Missing parent directories are NOT created: a missing parent fails (not found), and a
  parent that is a file fails (not a directory). Writing to a path that is an existing
  directory, or to `/`, fails (is a directory). Empty text is allowed and makes an empty
  file.
- `appendTo(path, text)`: adds to the end of the file; if the file does not exist it is
  created (same as write then). Same parent and directory rules as `write`. (The method is
  named `appendTo`, not `append`, because `append` is reserved in Go.)
- `read(path)`: the file's exact text. Fails if missing (not found), if a directory
  (is a directory), or if a part of the way is a file (not a directory).
- `ls(path)`: for a directory, the names directly inside it (not full paths, no slash),
  sorted by plain string order (ASCII order: digits before upper case before lower case).
  An empty directory gives `[]`. For a file it returns a list of just the file's own name
  (`ls("/a/f.txt")` is `["f.txt"]`). A missing path fails; a part of the way being a file
  fails. `ls("/")` lists the root.
- `rm(path)`: removes a file, or an EMPTY directory. A directory with anything inside it
  fails (not empty): removal is not recursive. A missing path fails. `rm("/")` fails.
  Removing then recreating a name works normally.

## Failures

- Every failure is simply an error; tests judge that a call failed, not its message. A
  failed call changes nothing.
- The kinds, for reference: not found (a missing path or parent), not a directory (a file
  used as a directory on the way), is a directory (reading or writing a directory), already
  exists (mkdir over a file; mv onto an existing path), not empty (rm of a non-empty
  directory), invalid path (see Paths).
- A file and a directory cannot share a name: there is no overwriting a directory by file
  or a file by directory.

## Concurrency

- Calls from several threads must each take effect whole and in some order. For instance,
  many threads calling `appendTo` on one file must lose no text, and many threads calling
  `mkdir` or `write` on different paths must all appear.

## Extension (revealed later)

- `mv(source, target)`: moves a file or directory, with its contents. The target must not
  exist (no overwriting, even file over file) and its parent must exist and be a directory,
  otherwise it fails. The source must exist. Moving `/` fails. Moving a directory into
  itself or below itself (`mv("/a", "/a/b")`) fails. `mv(x, x)` fails (the target exists).
  The target does not have to be in a different directory: renaming in place is fine.
- `size(path)`: number of characters stored. File: its text length. Directory: the total
  over every file beneath it, recursively; an empty directory is 0. A missing path fails.
  Tests use ASCII, so characters and bytes agree.
