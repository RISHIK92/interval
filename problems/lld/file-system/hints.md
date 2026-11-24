> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Before writing any code, which questions about paths and about each method's edge cases would you need the interviewer to settle?

## Approach

Model the tree as nested maps: a directory is a map from name to child, and a file holds its text. Resolve every path into a list of names before looking anything up, then walk from the root, so every method shares one way of finding a node. The invariant is that a failed call changes nothing: do every check before mutating, and guard the whole tree with one lock so concurrent calls each take effect whole. Ask the interviewer which paths are valid and how each method behaves at its edges before coding them.

## Code sketch

```text
class FileSystem
  root: directory (map name -> directory or file text)
  lock: one lock for the whole tree, held by every method

  parts(path) -> list of names
    // TODO: resolve the path; which paths are valid: per the interviewer
  walk(names) -> node
    // TODO: follow the names from the root; fail when the way is missing
  mkdir(path)
    // TODO: create the directory; behaviour per the interviewer
  write(path, text)
    // TODO: put the text in the file; behaviour per the interviewer
  appendTo(path, text)
    // TODO: add the text to the end; behaviour per the interviewer
  read(path) -> string
    // TODO: the file's text; failure cases per the interviewer
  ls(path) -> list<string>
    // TODO: a directory's names, sorted; other cases per the interviewer
  rm(path)
    // TODO: remove the entry; behaviour per the interviewer
```
