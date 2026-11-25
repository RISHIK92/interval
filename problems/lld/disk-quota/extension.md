# Disk quota: soft limit (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Before the volume fills up, the operators want to know who is using a lot of it.

- `softLimit(bytes)`: sets a soft limit per owner, 0 or more; a negative one fails and
  changes nothing. Setting it again replaces it. It only warns: `reserve` still allows
  anything that fits under the volume's limit.
- `warnings()`: the owners holding more than the soft limit (exactly at it is fine),
  sorted in ascending order by character code (`"Bob"` before `"Zed"` before `"amy"`).
  Empty until a soft limit is set.
