# CI job template

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Every CI job runs the same skeleton of five steps, in this order, whatever the language:
checkout, setup, install, test and report. What differs between kinds of job is only the
command each step runs, and setup and install are optional: a kind may not have one, and
they can be skipped.

| Step         | `"node"`          | `"python"`                        | `"go"`            |
| ------------ | ----------------- | --------------------------------- | ----------------- |
| `"checkout"` | `git checkout`    | `git checkout`                    | `git checkout`    |
| `"setup"`    | `nvm use`         | `python -m venv .venv`            | (none)            |
| `"install"`  | `npm ci`          | `pip install -r requirements.txt` | `go mod download` |
| `"test"`     | `npm test`        | `pytest`                          | `go test ./...`   |
| `"report"`   | `publish results` | `publish results`                 | `publish results` |

A job runs the steps in the table's order and writes one line for each step it runs:
`"<step>: <command>"`. It doesn't run a step its kind has none for, or a skipped one.
When a step fails, its line ends with `" [failed]"`, and the job runs no more steps,
except report: report always runs, after a failure too.

- `JobRunner()`: nothing skipped.
- `steps(kind)`: the lines a job of that kind writes when nothing fails, in order.
- `skip(step)`: from now on, every kind's jobs skip that step. Only `"setup"` and
  `"install"` can be skipped: any other step, or a name that isn't a step, fails.
  Skipping a step that's already skipped changes nothing.
- `runJob(kind, failAt)`: runs a job of that kind in which the step `failAt` fails, and
  returns its lines. `failAt` is `""` when nothing fails. When `failAt` names a step the
  job doesn't run, nothing fails. A `failAt` that's neither `""` nor a step fails.

Kinds and steps are the table's (case matters); any other kind fails. A call that fails
changes nothing, and there are at most 10^4 calls.

For example, `runJob("python", "install")` returns `["checkout: git checkout", "setup:
python -m venv .venv", "install: pip install -r requirements.txt [failed]", "report:
publish results"]`, and `steps("go")` has four lines: go has no setup step.
