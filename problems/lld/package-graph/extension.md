# Package dependencies: pins and unused packages (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A clean-up job removes packages nobody needs, except the ones someone has pinned.

- `pin(pkg)`: marks the package as wanted for its own sake. Pinning a pinned package
  changes nothing. An unknown or empty package fails.
- `unused()`: the packages that are not pinned and that no package depends on, sorted in
  ascending order by character code; an empty list when there are none.
- A pin doesn't stop `remove`: a pinned package that nothing depends on can still be
  removed, and its pin goes with it. Adding it again gives an unpinned package.
