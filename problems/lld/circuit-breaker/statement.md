# Circuit breaker

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A circuit breaker stands between a service and a dependency that may be failing. While
the dependency is healthy every call goes through. After too many failures in a row the
breaker opens and refuses calls, giving the dependency time to recover, and then lets a
single trial call through to find out whether it has.

| State         | `allow`                                         | `success`                                     | `failure`                                                                          |
| ------------- | ----------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `"closed"`    | true                                            | the count of failures in a row goes back to 0 | the count goes up by 1; reaching `threshold` opens the breaker                     |
| `"open"`      | false                                           | nothing                                       | nothing                                                                            |
| `"half-open"` | true for the first call (the trial), then false | after the trial was allowed: closes it        | after the trial was allowed: opens it again; before the trial was allowed: nothing |

An open breaker becomes half-open once `coolDownMs` has passed since it opened: at any
call with `nowMs` at least the time it opened plus `coolDownMs`. A breaker that closes
starts with no failures counted. A half-open breaker whose trial has been allowed stays
half-open until a `success` or `failure` arrives, however long that takes, and before the
trial is allowed, `success` and `failure` change nothing.

- `CircuitBreaker(threshold, coolDownMs)`: a closed breaker with no failures counted. A
  threshold outside 1 to 1000, or a cool-down outside 1 to 10^9, fails.
- `allow(nowMs)`: whether a call may go through now, by the table.
- `success(nowMs)` and `failure(nowMs)`: the outcome of a call, by the table. A failure
  that opens the breaker opens it at its `nowMs`.
- `state(nowMs)`: the state's name from the table, as of `nowMs`.

`nowMs` is a time in milliseconds. Each call's `nowMs` must be at least 0 and at least
the `nowMs` of every call before it that didn't fail; one that's earlier fails. A call
that fails changes nothing. Times are at most 10^12, and there are at most 10^4 calls.

For example, with a threshold of 3 and a cool-down of 1000, failures at 10, 20 and 70
open the breaker at 70 (a success at 30 in between would have reset the count). `allow`
returns false until 1070, when the breaker is half-open: `allow(1070)` lets the trial
through and `allow(1071)` refuses another. A failure at 1100 opens it again until 2100.
