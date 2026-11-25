# Environment templates

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Every pull request gets a preview environment. Rather than configuring each one from
scratch, the platform keeps a few named templates and forks a new environment from one of
them, then customises it. A fork is a full copy: changing it never changes the template
or any other environment, and changing the template never changes environments already
forked from it.

- `EnvTemplates()`: no templates and no environments.
- `define(name, vars)`: defines the template `name` with the variables `vars` (key to
  value), replacing any template of that name. Environments already forked from the old
  template keep what they had.
- `fork(base, env)`: makes the environment `env` as a copy of the template `base`'s
  variables and returns true. When an environment named `env` already exists it is
  refused: false, and nothing changes. An unknown template fails, and failing comes before
  refusing.
- `setVar(env, key, value)`: sets one variable of the environment and returns true. When
  the environment already has exactly that value for the key, it returns false and nothing
  changes.
- `vars(env)`: the environment's variables, key to value.

Templates and environments are named separately: an environment may share a template's
name, and `setVar` and `vars` only ever address environments. An environment the
platform doesn't have fails in `setVar` and `vars`. An empty name, key or value fails in
every call, including in `vars` passed to `define`. A call that fails changes nothing.
Names, keys and values are printable ASCII and case-sensitive, a template has at most 100
variables, and there are at most 10^4 calls.
