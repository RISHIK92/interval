# Chat-ops bots: auditing (extension round)

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Security wants a record of everything some bots do, without changing what they answer.

- `audit(bot)`: from now on, every command one of the bot's abilities answers is logged.
  This covers the abilities it holds now and any it is granted later, including one revoked
  and granted again. A bot stays audited; auditing it again changes nothing. An unknown bot
  fails.
- `auditLog(bot)`: the bot's log in the order the commands were answered, each entry
  `"<command> -> <answer>"`, for example `"deploy api -> deployed api"`. Commands from before
  the audit, refused commands and failed calls aren't logged. A bot that was never audited
  has an empty log. An unknown bot fails.
- Auditing changes no answer, and no other bot's log.
