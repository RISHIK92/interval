# File system

> PROVISIONAL (P5-W33): written during the build; the owner reviews it before launch.

Build a small in-memory file system. Paths are strings like `/docs/notes.txt`, and the
root is `/`. A path names a directory or a file; a file holds text.

- `FileSystem()`: starts with only the root directory.
- `mkdir(path)`: makes a directory.
- `write(path, text)`: puts the text in a file.
- `appendTo(path, text)`: adds the text to the end of a file.
- `read(path)`: the text of a file.
- `ls(path)`: the names inside a directory, sorted.
- `rm(path)`: removes a file or a directory.

A call that can't be done fails with an error and changes nothing. Several threads may
call these at once; every completed call must count.

The requirements above are deliberately short. Where they leave a choice open, ask the
interviewer.
