# Notification preferences

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Users choose how they are notified: they opt out of channels and set quiet hours. Routing
decides only whether a message should be delivered now; sending it is someone else's job.

The channels are exactly `email`, `push` and `sms`. Hours are whole hours of the day,
from 0 to 23.

- `NotificationPrefs()`: no user has any preferences yet.
- `optOut(user, channel)`: the user never gets messages on that channel again. Opting out
  twice changes nothing, and there is no way to opt back in.
- `quietHours(user, startHour, endHour)`: the user's quiet hours are from `startHour` up
  to, but not including, `endHour`, replacing any earlier ones. A window may wrap past
  midnight: 22 to 7 is quiet at 22, 23 and 0 to 6, and not at 7. The same start and end
  means no quiet hours at all.
- `route(user, channel, hour, urgent)`: whether a message on `channel` at `hour` is
  delivered. A channel the user opted out of is never delivered, urgent or not. Otherwise
  an urgent message is always delivered, and any other message is delivered unless `hour`
  is within the user's quiet hours.
- `channels(user)`: the channels the user hasn't opted out of, sorted in ascending order
  by character code.

A user with no preferences gets everything. An empty user, an unknown channel or an hour
outside 0 to 23 fails in every call. A call that fails changes nothing. Users are printable
ASCII and case-sensitive, and hour arguments are integers from -10^9 to 10^9. There are at most 10^4 calls.
