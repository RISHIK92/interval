> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a dependency that closes a cycle is going to be refused, what's the cheapest moment to notice it?

## Approach

Keep each resource with its kind, its properties and two lists: what it depends on and what depends on it. Refuse a dependency at the moment it's added if the new prerequisite can already reach the dependent by following dependencies; then the graph is always acyclic and the plan can never get stuck. Each recipe is a small factory that, given a name, returns its family of resources and links, so the builder can check every name first and then add them all through the same paths as hand-made ones. `validate` is a sweep against a table of required properties per kind, and `plan` is a topological sort that, instead of a plain queue of ready resources, always takes the smallest ready name.

## Code sketch

```text
REQUIRED: map kind -> required properties
interface Recipe
  resources(name) -> list of (kind, name, props)
  links(name) -> list of (a, b)
class WebRecipe / WorkerRecipe implements Recipe

class StackBuilder
  stack, resources: map name -> (kind, props, needs, neededBy)

  resource(kind, name, props) -> bool   // TODO: check; false if taken
  dependsOn(a, b) -> bool
    // TODO: fail on unknown or a == b
    // TODO: false if already there, or a is reachable from b
  preset(recipe, name) -> int
    // TODO: 0 if any name is taken; else add parts and links
  validate() -> list           // TODO: missing properties, sorted
  plan() -> list
    // TODO: fail unless validate() is empty
    // TODO: count unmet needs; take the smallest ready name
    // TODO: "<kind> <stack>/<name>"
```
