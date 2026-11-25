# Alert channels: webhooks (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Alerts now go to chat tools too, through a fourth kind of channel.

- `addWebhook(name, url)`: adds a webhook channel that posts to `url`. The url starts with
  `https://` and has at least one character after it, or the call fails; the name follows
  `addChannel`'s rules (not empty, not already in use by any channel). A failed call
  changes nothing.
- `send` through a webhook returns `POST `, the url, a space and the message, whatever
  its length: `POST https://hooks.example.com/alerts db-1 is down`.
- A webhook message costs 2 cents.
- `addChannel` still fails for the kind `"webhook"`: webhooks are added only through
  `addWebhook`.
