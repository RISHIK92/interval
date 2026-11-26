> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

A node that was offline missed some announcements. What is the least the bus has to remember so that the node can tell, when it comes back, whether it missed any?

## Approach

Treat the bus as the publisher and each node as a subscriber with its own cache. A write gets the next version and is announced to every node that is online, which drops that key from its cache; offline nodes hear nothing. The bus keeps the version count, and a node going offline remembers the version at that moment. When it comes back, comparing that remembered version with the current one tells it whether anything was written in between; if so, its cache can't be trusted and it empties it, and either way it is online again. Looking a node up, and refusing calls on one that is offline, belong in one helper each so every method checks the same way.

## Code sketch

```text
class AppNode                     // a subscriber
  cache: map key -> val
  downAt: version, or none while online
  invalidate(key)                 // TODO: drop the key

class InvalidationBus             // the publisher
  nodes: map name -> AppNode
  version = 0

  join(node)                      // TODO: validate, new node
  cacheLocal(node, key, val)      // TODO: online node only
  write(key) -> int
    // TODO: next version; every online node invalidates key
  cached(node, key) -> val or null
  offline(node, down)
    // TODO: going down: remember the version
    // TODO: coming back: a gap empties the cache
  serving(node) -> AppNode        // TODO: joined and online, or fail
```
