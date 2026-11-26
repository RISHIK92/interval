# On-call escalation: holiday cover (extension round)

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Someone on the rota is going on holiday, and a colleague covers their level while
they're away.

- `cover(person, substitute)`: from now on, whenever `person`'s level is paged (by `page`
  or by a `tick` moving an incident on), `substitute` is paged instead and becomes the
  holder, so only they can acknowledge. Covering the same person again replaces the
  substitute, and `cover(person, person)` ends the cover.
  - Pages already delivered stay with whoever got them.
  - Cover is one step: a substitute who is on the rota and covered themselves still gets
    the page.
  - It fails when `person` isn't on the rota or `substitute` is empty. The substitute
    needn't be on the rota.
