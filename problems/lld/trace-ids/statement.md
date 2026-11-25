# Trace ID source

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Every request that enters the system gets a trace ID, and logs from many machines are later
sorted by it. A process has exactly one trace ID source: two sources on one machine could
hand out the same ID. Each test here creates the source once, standing in for the
process's single instance.

An ID is built from a timestamp in milliseconds, the machine's node number and a sequence
within that millisecond, written as fixed-width decimal numbers padded with zeros:
`<timestamp: 13 digits>-<node: 4 digits>-<sequence: 3 digits>`, for example
`"0000000001000-0007-001"`. Because every part has a fixed width, sorting IDs by character
code sorts them in the order they were issued.

- `TraceIds(nodeId)`: the source for node `nodeId`, from 0 to 1023. Any other node fails.
- `nextId(nowMs)`: issues the next ID, where `nowMs` is the clock's reading, from 0 to
  10^12. The timestamp it uses:
  - a reading later than the last timestamp used starts a new millisecond: that reading,
    with sequence 0;
  - a reading equal to the last timestamp, or earlier (the clock went backwards), stays on
    the last timestamp with the next sequence;
  - when the last timestamp's sequence is already 999, the ID borrows the next
    millisecond: the last timestamp plus one, with sequence 0. A later reading that isn't
    past the borrowed timestamp stays on it, as above.
- `issued()`: how many IDs have been issued.
- `lastMs()`: the timestamp of the last ID issued, or -1 before the first.

Calls come one at a time here, so no locking is needed (a real source would also guard
against two threads asking at once). A reading outside 0 to 10^12 fails. A call that fails changes nothing. There are at most
10^4 calls.

For example, node 7 issues `"0000000001000-0007-000"` and `"0000000001000-0007-001"` at
1000 ms, then `"0000000001001-0007-000"` at 1001 ms. If the clock then reads 999, the next
ID is `"0000000001001-0007-001"`.
