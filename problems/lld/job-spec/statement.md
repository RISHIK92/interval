# CI job spec

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a CI job specification, put together from steps and environment variables, that
renders as a fixed listing.

- `JobSpec(name)`: a job with no steps and no variables; an empty name fails.
- `addStep(command)`: adds a step at the end and returns its number, counting from 1. An
  empty command fails and adds nothing. Two steps may run the same command.
- `setEnv(key, value)`: sets a variable, replacing its value if the key is already set.
  The key must be upper snake case: a capital letter `A`–`Z`, then any number of capital
  letters, digits `0`–`9` and underscores (`CI`, `NODE_ENV`, `A1__B`). Any other key fails
  and changes nothing. The value can be any string, the empty one included.
- `render()`: the job as a list of lines, in this order:
  1. `job <name>`;
  2. one `env <key>=<value>` per variable, sorted by key in ascending order by character
     code (so `A1` and `AB` come before `A_`);
  3. one `step <number>: <command>` per step, in order.

  Names, values and commands are written exactly as given, spaces included.

- `stepCount()`: how many steps the job has.
