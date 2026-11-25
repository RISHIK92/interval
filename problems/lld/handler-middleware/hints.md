> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What if every layer had exactly the handler's own method, and just held the thing it wraps?

## Approach

Give the handler and every layer the same small interface: serve a request, append to the trace, return a status. A layer holds the handler or layer it wraps, and its serve writes its entering line, asks the inner one, and writes its leaving line. Each kind of layer overrides only the piece it cares about: auth replaces the inner call when the token is bad, request-id keeps its own counter for the entering line, and compress looks at the status for its leaving line. Wrapping builds a new layer around the current top and makes it the new top; keep the layers in a list too, so naming them is easy.

## Code sketch

```text
interface Serves
  serve(path, token, trace) -> status

class Handler implements Serves     // TODO: write "<name> <path>", 200

class Layer implements Serves
  name, inner
  serve(path, token, trace)
    // TODO: trace entered(); status = inside(...); trace left(status)
  entered() / inside(...) / left(status)   // defaults: plain lines, ask inner

class Auth extends Layer        // TODO: override inside: "deny", 401 on a bad token
class RequestId extends Layer   // TODO: override entered: count, add the number
class Compress extends Layer    // TODO: override left: " gzip" after a 200

class HandlerStack
  top, layers: list
  wrap(layer)          // TODO: unknown fails; top = Kind(layer, top)
  handle(path, token)  // TODO: fail on ""; trace + str(status)
  layers()             // TODO: outermost first
```
