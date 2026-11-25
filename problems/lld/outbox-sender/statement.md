# Outbox sender

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Business code shouldn't care how its messages leave the building. It writes each message
to an outbox, and a transport chosen by name delivers them. Operations can swap the
transport while messages wait, and tests can make it fail.

- `OutboxSender(transport)`: an empty outbox delivering through `"http"`, `"queue"` or
  `"email"`. Any other transport fails.
- `enqueue(id, payload)`: adds the message to the end of the outbox and returns true.
  An id that was ever enqueued before, delivered or not, is refused: false, and nothing is
  added.
- `flush()`: makes one send attempt for each waiting message, in outbox order, and returns
  the receipts of the messages delivered, in that order. A delivered message leaves the
  outbox. A message whose send failed stays, in its place, for the next flush. An empty
  outbox makes no attempts, so planned failures carry over to later flushes.
- `failNext(n)`: the current transport's next `n` send attempts fail, replacing any count
  set before (`0` cancels it). A negative `n` fails.
- `swapTransport(transport)`: delivers through a new transport of that name from now on.
  It starts with no failures planned, even if a transport of that name was used before.
  Swapping to the transport already in use, or to an unknown one, fails.
- `pending()`: the number of messages waiting in the outbox.

Each transport writes its own receipt for a delivered message:

| Transport | Receipt                  |
| --------- | ------------------------ |
| `http`    | `POST <id> <payload>`    |
| `queue`   | `PUBLISH <id> <payload>` |
| `email`   | `MAIL <id> <payload>`    |

An empty id or payload fails. A call that fails changes nothing. Ids, payloads and
transport names are printable ASCII and case-sensitive, `n` is at most 10^9, and there
are at most 10^4 calls.
