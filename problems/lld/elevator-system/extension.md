# Elevator system: out of service (extension round)

> PROVISIONAL (P5-W34): written during the build; the owner reviews it before launch.

An elevator can now be taken out of service for maintenance.

- `outOfService(elevator)`: an unknown elevator fails. Returns false, changing nothing, if
  it is already out of service. Fails, changing nothing, if it is the only elevator still
  in service. Otherwise the elevator stops where it is and returns true, and each of its
  stops, in ascending floor order, is handed out again exactly as `request` would (the
  stop is dropped when another elevator already has that floor as a stop). The elevator's
  own stops are cleared first, so it is never chosen.
- An elevator out of service is skipped by `request` (including the check for a floor
  that already is a stop), does nothing in `step`, and its `status` is `"<floor> out -"`.
  `press` on it fails.
