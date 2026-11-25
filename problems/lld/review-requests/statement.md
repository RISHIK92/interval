# Pull request reviewers

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the review queue of a code host. Each pull request has one author and any number of
requested reviewers. People aren't registered anywhere: a person is known by name, and is
linked to a pull request only as its author or as a reviewer it requested.

- `ReviewQueue()`: starts with no pull requests.
- `open(pr, author)`: opens a pull request with no reviewers and no approvals. A pull
  request id already opened fails.
- `request(pr, reviewer)`: asks `reviewer` to review the pull request and returns true. It
  returns false and changes nothing when `reviewer` is the author (an author never reviews
  their own pull request) or was already asked, whether or not they have approved.
- `approve(pr, reviewer)`: records `reviewer`'s approval and returns true. It returns false
  and changes nothing when `reviewer` was never asked to review this pull request (the
  author included) or has already approved it: only an approval from someone who was asked
  counts, and it counts once.
- `pendingFor(reviewer)`: the pull requests `reviewer` was asked to review and hasn't yet
  approved, in the order they were asked; an empty list for anyone else.
- `approvals(pr)`: how many approvals the pull request has.

`request`, `approve` and `approvals` fail for a pull request that was never opened. An
empty id or name fails in every call, and a call that fails changes nothing. Names and ids
are printable ASCII and case-sensitive. There are at most 10^4 calls.
