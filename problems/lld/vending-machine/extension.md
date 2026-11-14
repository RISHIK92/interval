# Vending machine: coin stock (extension round)

> PROVISIONAL (P5-W34-S01): written during the build; the owner reviews it before launch.

The operator can now load coins into the machine and look at what it holds.

- `restockCoins(coin, count)`: adds `count` coins of that denomination to the machine's
  coins, which `buy` then uses for change. Fails for a value that isn't a coin or a count
  of 0 or less.
- `coinStock(coin)`: how many coins of that denomination the machine holds. Coins inserted
  but not yet bought with don't count; coins paid out as change no longer do. Fails for a
  value that isn't a coin.

A call that fails changes nothing.
