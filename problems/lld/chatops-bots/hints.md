> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every bot were a subclass, how many classes would four abilities need, and what would granting one at runtime do to an object's class?

## Approach

Make each ability a small object behind one interface: whether its command takes an argument, and how it answers. A bot is just a map from ability name to the ability object it holds, so granting and revoking are map edits. `handle` splits the command at the first space, checks the shape against the ability the name refers to (before checking whether the bot holds it, so a bad command fails even for a bot that lacks it), then asks the bot's own ability to answer or refuses.

## Code sketch

```text
interface Ability
  takesArgument() -> bool
  answer(bot, argument) -> string

KNOWN: map name -> Ability      // deploy, page, query, status

class BotFleet
  bots: map name -> (map ability name -> Ability)

  create(bot, abilities)
    // TODO: fail on an empty or taken name, unknown or repeated abilities
  grant(bot, ability) -> bool
    // TODO: false if held; else hold KNOWN[ability]
  revoke(bot, ability) -> bool
    // TODO: false if not held; else drop it
  handle(bot, command) -> string
    // TODO: verb, argument = split at the first space
    // TODO: fail unless the shape fits KNOWN[verb]
    // TODO: "refused" unless the bot holds verb; else answer
  abilities(bot) -> list
    // TODO: the held names, sorted
```
