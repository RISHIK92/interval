# Parking lot: blocked spots (extension round)

> PROVISIONAL (P5-W31-S02c): written during the build; the owner reviews it before launch.

Spots can now be taken out of use (for cleaning, say) and put back.

- `block(spot)`: takes a free spot out of use and returns true; returns false if a car is
  in it or it is already blocked. `park` never assigns a blocked spot, and `free` doesn't
  count it.
- `unblock(spot)`: puts a blocked spot back in use and returns true; false if it wasn't
  blocked.
- A spot is named as `park` returns it: `S` or `L` and its number, with no leading zero
  (`S3`, `L12`). Any other name fails: `S0`, `S01`, `s1`, ` S1`, or a number beyond the
  lot's spots of that size.
