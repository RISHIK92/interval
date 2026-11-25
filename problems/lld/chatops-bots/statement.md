# Chat-ops bots

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a fleet of chat-ops bots. Each bot is made of abilities, in any combination, and
abilities are granted and revoked while the bot runs, so there's no class per
combination. There are four abilities, and each answers one command:

| Ability    | Command           | Answer              |
| ---------- | ----------------- | ------------------- |
| `"deploy"` | `"deploy <what>"` | `"deployed <what>"` |
| `"page"`   | `"page <who>"`    | `"paged <who>"`     |
| `"query"`  | `"query <what>"`  | `"queried <what>"`  |
| `"status"` | `"status"`        | `"<bot> ok"`        |

A command is its ability's name, then for the first three a single space and an argument:
everything after that first space, kept exactly as given (spaces included), and never
empty. `"status"` takes no argument and no space. `<bot>` is the bot's own name.

- `BotFleet()`: starts with no bots.
- `create(bot, abilities)`: adds a bot holding `abilities` (possibly none). An empty name, a
  name already in use, an unknown ability, or the same ability twice fails.
- `grant(bot, ability)`: gives the bot the ability and returns true; false when it already
  has it.
- `revoke(bot, ability)`: takes the ability away and returns true; false when the bot
  doesn't have it.
- `handle(bot, command)`: the answer from the table. A bot that lacks the command's ability
  answers `"refused"`. A command that isn't one of the four shapes above (an unknown or
  differently cased name, a missing or empty argument, an argument or trailing space after
  `"status"`, an empty command) fails, whether or not the bot has the ability.
- `abilities(bot)`: the bot's abilities, sorted in ascending order by character code.

An unknown bot fails in every call but `create`, and an unknown ability (case matters) fails
in `grant` and `revoke`. A call that fails changes nothing, and failing comes first: a call
that breaks one of these rules fails even when it would otherwise have returned false or
`"refused"`. Names and commands are printable ASCII and case-sensitive; there are at most 100
bots, commands are at most 200 characters, and there are at most 10^4 calls.
