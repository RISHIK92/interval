# Pull request reviewers: code owners (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some paths have owners, who should be asked to review every change to them.

- `codeowner(pathPrefix, reviewer)`: makes `reviewer` an owner of every path that starts
  with `pathPrefix` (a plain string prefix: `"src/"` owns `"src/a.ts"`, and `"src"` also
  owns `"srcmap.json"`). A path prefix can have several owners, and a person can own
  several prefixes. Registering the same owner for the same prefix again changes nothing.
- `touch(pr, path)`: the pull request changes `path`, so every owner of `path` is
  requested as a reviewer, as by `request`: the author and anyone already asked are
  skipped. Returns how many reviewers it newly requested.
- Owners count at the time of the touch: an owner registered later isn't requested for
  paths touched before.
- An empty prefix, path, name or id fails, and so does touching a pull request that was
  never opened. A call that fails changes nothing.
