# Release train: hotfixes (extension round)

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A production fix can't wait for QA to finish the whole train. It leaves its train and
departs alone, and only security has to sign it off.

- `hotfix(change)`: takes the change off its train and puts it alone on a new train, the
  next number, which is returned. Its old train loses its sign-offs, as with any pull.
  The change must be aboard a train that isn't a hotfix train, or it fails.
  - A hotfix train is never the boarding train.
  - It is fully signed off with security's sign-off alone: `signOff("qa", ...)` on it
    returns `false`.
  - Otherwise it behaves like any train: its change can be pulled, which leaves it empty,
    and it departs with `depart`.
