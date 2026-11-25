> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which rules must hold whatever order the steps and variables were added in, and which single method is the only way out of the object?

## Approach

Expose what a job does, not how it's stored: callers add steps and set variables, and the only view out is `render()`. Inside, keep the steps in a list (a step's number is its position plus one) and the variables in a map from key to value. Validate each key with one pattern at the door, so a bad key never gets in. `render` builds the lines in its fixed order: the job line, the variables sorted by key, then the numbered steps.

## Code sketch

```text
class JobSpec
  name
  steps: list of commands
  env: map key -> value

  constructor(name)
    // TODO: fail on an empty name
  addStep(command) -> int
    // TODO: fail on an empty command; append; return the new length
  setEnv(key, value)
    // TODO: fail unless key matches [A-Z][A-Z0-9_]*
    // TODO: store or replace the value
  render() -> list<string>
    // TODO: "job <name>"
    // TODO: "env <key>=<value>" for each key, sorted by character code
    // TODO: "step <n>: <command>" for each step, from 1
  stepCount() -> int
    // TODO: how many steps
```
