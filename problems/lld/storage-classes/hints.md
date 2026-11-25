> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `read` checked whether an object is in archive and returned null until someone restored it, which callers would now need to know about storage classes?

## Approach

Give every class the same shape: its monthly rate per character, and a read that takes the stored object and a meter of fees and restores and returns the data. Standard just returns it, infrequent access charges its fee first, and archive restores the object first if it hasn't been restored (counting the restore and charging its fee). The bucket keeps each key's data, class and restored flag, plus the one meter, and only ever calls the class through that shape. The monthly cost is the sum of rate times length over current objects, plus the fees on the meter.

## Code sketch

```text
interface StorageClass
  rate -> int
  read(stored, meter) -> string

class Standard / InfrequentAccess / Archive implements StorageClass

class StorageBucket
  objects  // key -> (data, class, restored)
  meter    // fees, restores

  store(key, data, className)
    // TODO: fail on an empty key or unknown class; replace the object
  read(key) -> optional<string>
    // TODO: fail on an empty key; null if missing
    // TODO: otherwise ask the object's class to read it
  restores() -> int
    // TODO: from the meter
  monthlyCost() -> int
    // TODO: sum of rate * length, plus the fees so far
```
