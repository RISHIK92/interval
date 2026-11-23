# LLD practice catalog (PROPOSED, for the owner's review)

> **Every problem here is PROVISIONAL.** Claude drafted this plan on 2026-11-23. Nothing below is written as a problem yet. The owner reviews titles, scope, difficulty and concepts before any problem files are generated, and each generated problem stays PROVISIONAL until the owner reviews it too (Q-P5-08).

## How it was seeded

- **Owner's decisions (Q-WD-28, ADR-0048 and later answers):**
  - practice problems are grouped by topic: `oop-basics | relationships | principles | solid | creational | structural | behavioural`, plus `systems` for the four existing practice problems (lru-cache, parking-lot, meeting-rooms, elevator-system);
  - each problem has `concepts: string[]` from the concept graph;
  - the extension round is optional per problem;
  - every problem ships reference solutions in the launch languages, as battle problems do.
- **The seed:** the owner asked to "use that page to seed questions": AlgoMaster's LLD practice list (algomaster.io/practice/low-level-design). It was used **only** for the idea space:
  - its 7 groups and their sizes (OOP Fundamentals 16, Class Relationships 9, Design Principles 13, SOLID 10, Creational 12, Structural 19, Behavioural 28; 107 in all);
  - the concepts each group covers;
  - its easy/medium/hard spread per group.
- **Nothing else was taken.** No statement, contract, test case, rubric or wording was read or copied. Every problem below has its own title, scenario and contract, mostly in domains software engineers work in (caches, queues, deploys, feature flags, logs, payments, CI). Where a seed title's domain was obvious (cars, pizzas, shapes, playlists, text editors, ATMs, home theatres, chat rooms), it was avoided on purpose.
- **Not near a battle problem.** A practice problem's tests can be probed freely, so none here is a variant of a battle-pool problem (rate-limiter, url-shortener, leaderboard, order-book, bank-ledger, task-scheduler, vending-machine, file-system). That rules out, for example, a rate limiter as a strategy exercise.

### Spread against the seed

| Group         | Seed (e/m/h) | Here (e/m/h) | Count |
| ------------- | ------------ | ------------ | ----- |
| oop-basics    | 9 / 7 / 0    | 9 / 7 / 0    | 16    |
| relationships | 4 / 3 / 2    | 4 / 3 / 2    | 9     |
| principles    | 7 / 6 / 0    | 7 / 6 / 0    | 13    |
| solid         | 4 / 5 / 1    | 4 / 5 / 1    | 10    |
| creational    | 5 / 5 / 2    | 5 / 5 / 2    | 12    |
| structural    | 2 / 13 / 4   | 4 / 11 / 4   | 19    |
| behavioural   | 8 / 14 / 6   | 8 / 14 / 6   | 28    |
| **Total**     | 39 / 53 / 15 | 41 / 51 / 15 | 107   |

Structural moved two problems from medium to easy (a pager adapter and a symbol interner are small), so the group has a gentler start. The four `systems` problems already exist and aren't counted.

## What every problem must fit

From `packages/lld/src/{problem,interface,types,scenario,check}.ts`:

- **One class.** A constructor and 1 to 20 methods. Names are lower camel case (classes upper camel case), at most 31 characters, and never a keyword or harness name in any language (`get`, `set`, `delete`, `type`, `record`, `register`, `clone`, `notify`, `append`, `make`, `dispatch`, `args`, `template`, `from` and others are refused). Each contract below was checked against that list.
- **Types:** only `int`, `float`, `bool`, `string`, `list<T>`, `map<string,T>` and `optional<T>`, at most four levels deep, plus `void` as a return. No objects, callbacks or enums cross the interface, so kinds are strings and structured results are strings in a stated format, lists or `map<string,int>`.
- **Scenarios** are method calls with JSON arguments: 1–20 visible and 1–100 hidden. The optional concurrency layer has threads. The extension layer's scenarios must call an extension method.
- **Results are judged exactly** unless a check says `unordered` (a list whose order the problem leaves open) or `approx` (floats). A call that fails is judged by kind (it failed), never by message, so statements say which calls fail and never what they say.
- **Time is a parameter** (`nowMs: int`), never a clock, so every run is deterministic.
- **An extension adds and never changes:** base behaviour may differ only after an extension method is called. Several extensions below are worded the way they are for this reason. For example, a new kind is added through a new method, because making a base method accept a kind it used to refuse would change base behaviour.
- **The current tests require a concurrency layer on every problem** (`problems.test.ts`). Every contract below has a mutating method whose combined effect a later call can judge, so each can have one. The exception is `price-display`, whose methods are pure: it needs an exemption or a counter added (see open question 2).

## Turning "refactor" and "principle" ideas into testable contracts

The judge runs method calls and compares results. It can't see whether a solution uses a strategy object or a switch, so a design principle can't be graded directly. Five techniques give each principle or pattern a behaviour that tests can pin down. The tests check that behaviour, and the extension round makes the principled design pay off.

1. **Build to the spec, then take the change request.** The seed's "refactor this legacy code" framing doesn't fit our format: the starter code is generated from the interface, and there's no field for legacy code (open question 1). So each principle or SOLID problem states a spec where the principle is the clean route, and its **extension is the change the principle anticipates**: a new rule, kind, format or backend. A design that followed the principle adds a method. A tangled one must be reworked mid-session. That's why nearly every principles and SOLID problem has an extension.
2. **Instrumentation methods make internals observable.** A singleton, lazy load, proxy, pool or flyweight is defined by work it doesn't do. A counter makes that judgeable: `loads()`, `upstreamFetches()`, `created()`, `builds()`, `templates()`. The concurrency layer then checks the "only once" properties under threads.
3. **Invariants under any call order.** Encapsulation and class invariants become rules that must hold after every call, such as "on-hand = available + reserved" or "a rollout is never in two states". Hidden and random scenarios (verify adds seeded random ones) probe for broken invariants.
4. **Agreement across entry points.** DRY becomes "three entry points must give the same answer for the same input", and random scenarios hunt for a place where one copy of a rule drifted.
5. **Substitutability across kinds.** LSP becomes "every kind honours the same contract". The same scenarios run against each kind, and a kind that throws, no-ops or returns early fails them.

What tests **can't** check is design quality itself: naming, cohesion, whether the pattern was used at all. A solution that passes with a big switch statement passes. That's a limit of judging by behaviour, and the owner may want it said in the practice UI. Each problem's references show the intended pattern idiomatically in every language, so they are worth reading after a session.

## The catalog

Notation: `Class(param: type)` is the constructor, and `name(param: type): returns` is a method. Concepts are concept-graph slugs: new ones are proposed in [New concepts](#new-concepts-for-the-concept-graph), and the rest already exist. "Ext" is the optional extension round.

### oop-basics (16)

| #   | Slug · title                                  | Concepts                                                                       | Diff   | Brief                                                                                                                                                                                                     | Contract sketch                                                                                                                                                                                                                              | Ext                                                                                                                                |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `feature-flag` · Feature flag                 | classes-and-objects, encapsulation, feature-flags                              | easy   | One flag with a rollout percentage and a kill switch. A user's bucket (0–99) decides whether they see the feature. The kill switch always wins, and the percentage can never leave 0–100.                 | `FeatureFlag(name: string, rolloutPercent: int)` · `enabledFor(userBucket: int): bool` · `setRollout(percent: int): void` · `kill(): void` · `revive(): void`                                                                                | yes: `allow(userBucket: int)` puts a bucket on an allowlist that is on whenever the flag isn't killed                              |
| 2   | `semver` · Semantic version                   | value-objects, immutability, api-versioning                                    | easy   | A parsed `major.minor.patch` version. Bumping returns a new version and never changes the original. Comparison and "compatible with" follow semver's rules (major 0 is compatible only within one minor). | `SemVer(text: string)` (malformed fails) · `bump(part: string): string` · `compareTo(other: string): int` · `isCompatible(other: string): bool` · `text(): string`                                                                           | yes: `satisfies(constraint: string): bool` for `^1.2.0` and `~1.2.0` ranges                                                        |
| 3   | `disk-quota` · Disk quota                     | encapsulation, class-invariants                                                | easy   | A shared volume with a byte limit. Owners reserve and release space. No owner ever holds a negative amount, and the total never passes the limit.                                                         | `DiskQuota(limitBytes: int)` · `reserve(owner: string, bytes: int): bool` · `release(owner: string, bytes: int): void` (more than held fails) · `used(owner: string): int` · `free(): int`                                                   | yes: `softLimit(bytes: int)` and `warnings(): list<string>`, the owners over it                                                    |
| 4   | `duration` · Duration value                   | value-objects, immutability                                                    | easy   | A duration parsed from text like `1h30m15s`. Two durations that are the same length are equal whatever their spelling, and the canonical form is fixed.                                                   | `Duration(text: string)` · `totalSeconds(): int` · `canonical(): string` · `plus(other: string): string` · `isLonger(other: string): bool`                                                                                                   | yes: `scaled(factor: float): string`, rounded down to whole seconds                                                                |
| 5   | `alert-channels` · Alert channels             | polymorphism, inheritance                                                      | easy   | Alerts go out through channels of three kinds: email, SMS and pager. Each kind formats a message its own way (SMS truncates, pager shouts) and costs a different amount per message.                      | `AlertDispatcher()` · `addChannel(name: string, kind: string): void` (unknown kind fails) · `send(channel: string, message: string): string` · `cost(channel: string): int`                                                                  | yes: `addWebhook(name: string, url: string)`, a fourth kind with its own format and cost                                           |
| 6   | `money` · Money                               | value-objects, immutability, class-invariants                                  | easy   | An amount in integer cents with an ISO currency code. Adding across currencies fails, and splitting gives the leftover cents to the first parts, so nothing is ever lost.                                 | `Money(cents: int, currency: string)` · `add(cents: int, currency: string): string` · `split(parts: int): list<string>` · `display(): string`                                                                                                | yes: `allocate(weights: list<int>): list<string>`, a split by ratio                                                                |
| 7   | `connection-lifecycle` · Connection lifecycle | enumerations, encapsulation, class-invariants                                  | easy   | A client connection that is `idle`, `open`, `closed` or `failed`. Only the legal moves between them happen. An illegal one returns false and changes nothing.                                             | `Connection(host: string)` · `connect(): bool` · `disconnect(): bool` · `fail(reason: string): void` · `state(): string`                                                                                                                     | yes: `reconnect(): bool` from `failed`, and `attempts(): int`                                                                      |
| 8   | `job-spec` · CI job spec                      | abstraction, encapsulation                                                     | easy   | A CI job built up from steps and environment variables. Variable names must be upper snake case. The job renders as a fixed, sorted listing.                                                              | `JobSpec(name: string)` · `addStep(command: string): int` · `setEnv(key: string, value: string): void` · `render(): list<string>` · `stepCount(): int`                                                                                       | yes: `secret(key: string, value: string)`, shown as `***` when rendered                                                            |
| 9   | `metric-registry` · Metric registry           | encapsulation, classes-and-objects, metrics                                    | easy   | Counters and gauges by name. A counter only goes up. A name can't be both a counter and a gauge.                                                                                                          | `MetricRegistry()` · `inc(name: string, by: int): int` · `gauge(name: string, value: int): void` · `read(name: string): optional<int>` · `names(): list<string>`                                                                             | yes: `snapshotAndReset(): map<string,int>`, which returns every counter and zeroes it                                              |
| 10  | `instance-billing` · Instance billing         | polymorphism, inheritance, interfaces-and-abstract-classes                     | medium | Cloud instances bill by kind: on-demand per hour, reserved with an upfront fee and a lower rate, and spot at a discount that stops billing once the instance is interrupted. One meter totals them all.   | `BillingMeter()` · `launch(id: string, kind: string, hourlyCents: int): void` · `run(id: string, hours: int): void` · `bill(id: string): int` · `total(): int`                                                                               | yes: `launchDedicated(id: string, hourlyCents: int, hostFeeCents: int)`, a fourth kind                                             |
| 11  | `warehouse-stock` · Warehouse stock           | encapsulation, class-invariants                                                | medium | Stock per SKU that orders reserve, ship or cancel. On-hand stock always equals available plus reserved. A reservation is all or nothing.                                                                  | `Warehouse()` · `receive(sku: string, qty: int): int` · `reserve(orderId: string, sku: string, qty: int): bool` · `ship(orderId: string): bool` · `cancel(orderId: string): bool` · `available(sku: string): int`                            | yes: `writeOff(sku: string, qty: int): bool` for damaged stock, taken only from what's available                                   |
| 12  | `config-schema` · Service config schema       | abstraction, polymorphism                                                      | medium | A schema for a service's environment variables: required, integer within a range, or one of a fixed set. Checking a config returns every violation in a fixed order.                                      | `ConfigSchema()` · `rule(field: string, spec: string): void` (unknown spec fails) · `check(env: map<string,string>): list<string>` · `fields(): list<string>`                                                                                | yes: `fallback(field: string, value: string)` fills a missing optional field before checking                                       |
| 13  | `api-key-store` · API keys with scopes        | encapsulation, immutability, class-invariants, authentication-vs-authorization | medium | Keys are issued with scopes (wildcards such as `repo:*`) and a time to live. A key can be narrowed but never widened, and a revoked or expired key can do nothing.                                        | `ApiKeyStore()` · `issue(owner: string, scopes: list<string>, nowMs: int, ttlMs: int): string` · `can(keyId: string, scope: string, nowMs: int): bool` · `narrow(keyId: string, scopes: list<string>): bool` · `revoke(keyId: string): bool` | yes: `rotate(keyId: string, nowMs: int): string`, where the old key keeps working for a 60-second grace period                     |
| 14  | `sprint-board` · Sprint board                 | enumerations, encapsulation, classes-and-objects                               | medium | Tickets move between todo, doing, review and done, one column at a time. "Doing" has a work-in-progress limit. Velocity counts the points that are done.                                                  | `SprintBoard(wipLimit: int)` · `add(title: string, points: int): string` · `move(ticket: string, column: string): bool` · `column(ticket: string): string` · `velocity(): int`                                                               | yes: `block(ticket: string, reason: string)`, `unblock(ticket: string)` and `blocked(): list<string>`; a blocked ticket can't move |
| 15  | `log-parser` · Log line parser                | polymorphism, abstraction, structured-logging                                  | medium | Named formats of three kinds: key=value, CSV with given headers, and common access-log lines. Each parses a line into fields, and a malformed line fails.                                                 | `LogParser()` · `addFormat(name: string, kind: string, headers: list<string>): void` · `parse(format: string, line: string): map<string,string>` · `parsed(format: string): int`                                                             | yes: `detect(line: string): optional<string>`, the first format that parses the line                                               |
| 16  | `usage-billing` · Usage-based billing         | polymorphism, encapsulation                                                    | medium | Metered usage is priced per metric, either graduated (each tier's units at that tier's rate) or by volume (all units at the rate of the tier reached). Invoices are per customer and metric.              | `UsageBilling()` · `price(metric: string, model: string, tiers: list<list<int>>): void` · `meter(customer: string, metric: string, units: int): void` · `invoice(customer: string): map<string,int>` · `total(customer: string): int`        | yes: `minimum(metric: string, cents: int)`, a monthly minimum charge                                                               |

### relationships (9)

| #   | Slug · title                                | Concepts                                                 | Diff   | Brief                                                                                                                                                                                                                          | Contract sketch                                                                                                                                                                                                                                                                                                           | Ext                                                                                                                               |
| --- | ------------------------------------------- | -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `oncall-roster` · On-call roster            | association, aggregation                                 | easy   | Engineers belong to any number of teams. Disbanding a team leaves its engineers in place: the team aggregates them but doesn't own them.                                                                                       | `OncallRoster()` · `addEngineer(name: string): void` · `addTeam(team: string): void` · `join(team: string, name: string): bool` · `disband(team: string): bool` · `teamsOf(name: string): list<string>`                                                                                                                   | yes: `rotate(team: string): string`, the next on-call in join order                                                               |
| 2   | `review-requests` · Pull request reviewers  | association                                              | easy   | Pull requests have an author and requested reviewers. An author never reviews their own PR, and an approval counts only from someone who was asked.                                                                            | `ReviewQueue()` · `open(pr: string, author: string): void` · `request(pr: string, reviewer: string): bool` · `approve(pr: string, reviewer: string): bool` · `pendingFor(reviewer: string): list<string>` · `approvals(pr: string): int`                                                                                  | yes: `codeowner(pathPrefix: string, reviewer: string)` and `touch(pr: string, path: string)`, which requests owners automatically |
| 3   | `pod-containers` · Pods and containers      | object-composition                                       | easy   | A pod owns its containers: they live and die with it, and a container never exists without one. Container names are unique across pods.                                                                                        | `PodRegistry()` · `createPod(pod: string): void` · `addContainer(pod: string, container: string, image: string): bool` · `removePod(pod: string): int` · `podOf(container: string): optional<string>` · `images(): list<string>`                                                                                          | yes: `sidecar(container: string, image: string)` is injected, as `<pod>-<container>`, into every pod created afterwards           |
| 4   | `package-graph` · Package dependencies      | dependency-relationship, association                     | easy   | Packages declare the packages they depend on. A package that others depend on can't be removed, and the install order puts dependencies first.                                                                                 | `PackageGraph()` · `add(pkg: string, deps: list<string>): bool` · `remove(pkg: string): bool` · `dependents(pkg: string): list<string>` · `installOrder(pkg: string): list<string>`                                                                                                                                       | yes: `pin(pkg: string)` and `unused(): list<string>`, the unpinned packages nothing depends on                                    |
| 5   | `org-chart` · Org chart                     | aggregation, association                                 | medium | People report to managers up to one root. Reassignment never makes a cycle. When someone leaves, their reports move to their manager.                                                                                          | `OrgChart(ceo: string)` · `hire(name: string, manager: string): bool` · `reassign(name: string, manager: string): bool` · `leave(name: string): bool` · `chain(name: string): list<string>` · `span(manager: string): int`                                                                                                | yes: `promote(name: string)`, which swaps a person with their manager                                                             |
| 6   | `incident-room` · Incident room             | association, object-composition                          | medium | An incident owns its timeline. Responders are associated with it, and the commander must be one of them. Only responders write notes, and every handoff is written to the timeline by the system.                              | `IncidentRoom()` · `declareIncident(id: string, commander: string, nowMs: int): void` · `joinIncident(id: string, responder: string, nowMs: int): bool` · `note(id: string, author: string, text: string, nowMs: int): bool` · `handOff(id: string, to: string, nowMs: int): bool` · `timeline(id: string): list<string>` | yes: `resolve(id: string, nowMs: int)`, after which notes are refused, and `durationMs(id: string): int`                          |
| 7   | `dashboards` · Dashboards and saved queries | object-composition, aggregation                          | medium | Dashboards own their panels, and panels point to shared saved queries. Dropping a dashboard keeps its queries. A query that a panel still uses can't be dropped.                                                               | `Dashboards()` · `saveQuery(name: string, expr: string): void` · `addPanel(dashboard: string, panel: string, query: string): bool` · `dropDashboard(dashboard: string): int` · `dropQuery(name: string): bool` · `usage(query: string): list<string>`                                                                     | yes: `duplicate(dashboard: string, newName: string)` copies the panels and shares the queries                                     |
| 8   | `pipeline-graph` · CI pipeline graph        | object-composition, association, dependency-relationship | hard   | A pipeline owns stages, and stages own jobs. A job may need jobs in earlier stages. A run reports each job as passed, failed, or skipped because something it needs failed. A stage can't be removed while later jobs need it. | `Pipeline()` · `stage(name: string): void` · `job(stage: string, name: string, needs: list<string>): bool` · `fail(job: string): void` · `run(): list<string>` · `removeStage(name: string): int`                                                                                                                         | yes: `allowFailure(job: string)`: its dependents run even if it fails                                                             |
| 9   | `resource-tree` · Cloud resource hierarchy  | object-composition, aggregation, association, rbac       | hard   | An organisation holds folders, folders hold projects, and projects hold resources. Kind rules decide what can go where. Role grants are inherited downward, and moving a subtree changes who can do what.                      | `ResourceTree(org: string)` · `addNode(parent: string, node: string, kind: string): bool` · `attach(node: string, role: string, member: string): void` · `can(member: string, role: string, node: string): bool` · `move(node: string, parent: string): bool` · `remove(node: string): int`                               | yes: `deny(node: string, role: string, member: string)`: a deny overrides any inherited grant below it                            |

### principles (13)

| #   | Slug · title                                    | Concepts                                                               | Diff   | Brief                                                                                                                                                                                                              | Contract sketch                                                                                                                                                                                                                                            | Ext (the change request)                                                                                   |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | `webhook-url-rules` · Webhook URL rules         | dry-principle, separation-of-concerns, webhooks                        | easy   | Creating, updating and testing a webhook each validate its URL: HTTPS only, no private or loopback hosts, and a length limit. All three must report the same violations for the same URL (technique 4).            | `WebhookRules()` · `createHook(url: string): list<string>` · `updateHook(hookId: string, url: string): list<string>` · `testUrl(url: string): list<string>` · `hooks(): list<string>`                                                                      | yes: `blockHost(host: string)`, which must apply at all three entry points at once                         |
| 2   | `layered-config` · Layered config               | separation-of-concerns, encapsulate-what-varies                        | easy   | Settings come from defaults, a file, the environment and flags, in rising precedence. Lookup reports the winning value and where it came from, and parsing is kept apart from lookup.                              | `LayeredConfig()` · `layer(source: string, entries: map<string,string>): void` · `lookup(key: string): optional<string>` · `origin(key: string): optional<string>` · `intValue(key: string): optional<int>`                                                | yes: `alias(oldKey: string, newKey: string)` for renamed settings                                          |
| 3   | `deploy-gate` · Deploy gate                     | law-of-demeter, encapsulation                                          | easy   | Callers ask the gate "may I deploy?" and never inspect individual checks themselves (tell, don't ask). Required checks must have passed, and blockers are listed.                                                  | `DeployGate()` · `require(check: string): void` · `report(check: string, passed: bool): void` · `mayDeploy(): bool` · `blockers(): list<string>`                                                                                                           | yes: `waive(check: string, reason: string)` and `waivers(): list<string>`                                  |
| 4   | `service-settings` · Startup settings           | fail-fast, design-by-contract                                          | easy   | A service's settings are checked when constructed, so a bad port or worker count fails at startup and never later. Derived values (a retry budget) state their preconditions.                                      | `ServiceSettings(port: int, workers: int, timeoutMs: int)` · `withWorkers(n: int): bool` · `budgetMs(retries: int): int` · `describe(): string`                                                                                                            | yes: `withTls(certPath: string, keyPath: string): bool`: both or neither                                   |
| 5   | `backoff-schedule` · Backoff schedule           | encapsulate-what-varies, program-to-an-interface, retries-with-backoff | easy   | Retry delays grow by a fixed, linear or exponential schedule, capped. The varying part, how the next delay grows, is the only thing that changes between schedules.                                                | `BackoffSchedule(kind: string, baseMs: int, capMs: int)` · `delay(attempt: int): int` · `schedule(attempts: int): list<int>` · `totalMs(attempts: int): int` · `switchTo(kind: string): void`                                                              | yes: `fibonacci(): void` switches to Fibonacci growth                                                      |
| 6   | `notification-prefs` · Notification preferences | separation-of-concerns, cohesion-and-coupling                          | easy   | Users opt out of channels and set quiet hours, which may wrap past midnight. Routing decides only whether to deliver. Urgent messages ignore quiet hours but never an opt-out.                                     | `NotificationPrefs()` · `optOut(user: string, channel: string): void` · `quietHours(user: string, startHour: int, endHour: int): void` · `route(user: string, channel: string, hour: int, urgent: bool): bool` · `channels(user: string): list<string>`    | yes: `digest(user: string, channel: string)` batches non-urgent messages; `flushDigest(user: string): int` |
| 7   | `work-queue` · Bounded work queue               | design-by-contract, class-invariants                                   | easy   | A queue with a fixed capacity and stated pre- and postconditions. Offering to a full queue returns false. Taking from an empty one fails. Peeking never changes anything.                                          | `WorkQueue(capacity: int)` · `offer(item: string): bool` · `take(): string` · `peekNext(): optional<string>` · `size(): int`                                                                                                                               | no                                                                                                         |
| 8   | `chatops-bots` · Chat-ops bots                  | composition-over-inheritance                                           | medium | Bots are made of abilities (deploy, page, query, status) in any combination, granted and revoked at runtime, with no class per combination. A bot answers a command it lacks the ability for with a fixed refusal. | `BotFleet()` · `create(bot: string, abilities: list<string>): void` · `grant(bot: string, ability: string): bool` · `revoke(bot: string, ability: string): bool` · `handle(bot: string, command: string): string` · `abilities(bot: string): list<string>` | yes: `audit(bot: string)` wraps every ability of a bot in logging; `auditLog(bot: string): list<string>`   |
| 9   | `invoice-run` · Invoice run                     | separation-of-concerns, cohesion-and-coupling                          | medium | An invoice is subtotal, then credits, then regional tax, then rounding, each step its own concern. Unused credit carries over to the next run.                                                                     | `InvoiceRun()` · `usage(customer: string, cents: int): void` · `credit(customer: string, cents: int): void` · `region(customer: string, region: string): void` · `invoice(customer: string): list<int>` · `carryOver(customer: string): int`               | yes: `coupon(customer: string, percent: int)`, applied before credits                                      |
| 10  | `blob-store` · Swappable blob store             | program-to-an-interface, object-storage                                | medium | A blob store has two backends behind one interface, plain and versioned. Callers never care which is in use, and migrating between them keeps every latest blob.                                                   | `BlobStore(backend: string)` · `putBlob(key: string, data: string): int` · `fetch(key: string): optional<string>` · `remove(key: string): bool` · `listKeys(prefix: string): list<string>` · `migrate(backend: string): int`                               | yes: `fetchVersion(key: string, version: int): optional<string>`                                           |
| 11  | `log-redactor` · Log redaction                  | encapsulate-what-varies, separation-of-concerns, structured-logging    | medium | Redaction rules for emails, card numbers (keeping the last four digits) and bearer tokens are enabled one by one and applied in the order they were enabled. Hits are counted per rule.                            | `Redactor()` · `enable(rule: string): void` · `disable(rule: string): void` · `redact(line: string): string` · `hits(rule: string): int`                                                                                                                   | yes: `maskAfter(name: string, prefix: string)`, a custom rule that masks the word after a prefix           |
| 12  | `price-display` · Prices everywhere             | dry-principle                                                          | medium | Checkout lines, receipt lines and email summaries show money in three locales (grouping, decimal mark, symbol position, yen without decimals). The same amount must read identically everywhere (technique 4).     | `PriceFormatter()` · `checkoutLine(cents: int, locale: string): string` · `receiptLine(item: string, cents: int, qty: int, locale: string): string` · `emailSummary(totalCents: int, locale: string): string`                                              | yes: `addLocale(locale: string, currencySign: string, signFirst: bool, grouping: string, decimal: string)` |
| 13  | `migration-plan` · Schema migration plan        | design-by-contract, fail-fast, schema-migrations                       | medium | Numbered migrations are applied up to a target and rolled back by steps. Each operation states its preconditions and either happens in full or fails and changes nothing.                                          | `MigrationPlan()` · `add(version: int, name: string): void` · `applyUpTo(version: int): list<string>` · `rollback(steps: int): list<string>` · `current(): int` · `pending(): list<int>`                                                                   | yes: `irreversible(version: int)`: a rollback across it fails with nothing undone                          |

### solid (10)

| #   | Slug · title                                   | Concepts                                                                                                                                | Diff   | Brief                                                                                                                                                                                                                                      | Contract sketch                                                                                                                                                                                                                                                                                          | Ext (the change request)                                                                                               |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | `changelog` · Changelog generator              | single-responsibility-principle, solid-principles                                                                                       | easy   | Conventional commit messages (`feat:`, `fix:` and so on) are parsed, grouped by type and rendered as release notes. Parsing, grouping and rendering are three separate responsibilities.                                                   | `Changelog()` · `commit(sha: string, message: string): bool` · `release(version: string): list<string>` · `unreleased(): int`                                                                                                                                                                            | yes: `breakingSection(on: bool)` lists `!` commits under BREAKING first                                                |
| 2   | `linter` · Lint rules                          | open-closed-principle, solid-principles                                                                                                 | easy   | A linter runs enabled rules (maximum line length, no tabs, no trailing spaces) over lines and reports `line:rule` findings. A new rule must not mean editing the old ones.                                                                 | `Linter()` · `enable(rule: string, param: int): void` · `lint(lines: list<string>): list<string>` · `enabled(): list<string>`                                                                                                                                                                            | yes: `banWord(word: string)`, a new rule                                                                               |
| 3   | `storage-classes` · Storage classes            | liskov-substitution-principle, object-storage                                                                                           | easy   | Standard, infrequent-access and archive objects honour one contract: what you store is what you read back. Archive may cost a restore, but it never throws or returns nothing. The same scenarios run against every class (technique 5).   | `StorageBucket()` · `store(key: string, data: string, storageClass: string): void` · `read(key: string): optional<string>` · `restores(): int` · `monthlyCost(): int`                                                                                                                                    | yes: `transition(key: string, storageClass: string): bool`, a lifecycle move                                           |
| 4   | `runner-pool` · Runner capabilities            | interface-segregation-principle                                                                                                         | easy   | CI runners advertise only the capabilities they have (build, test, deploy, gpu). A job goes to the first idle runner with all the capabilities it needs, and never to one that would fake a capability.                                    | `RunnerPool()` · `addRunner(name: string, capabilities: list<string>): void` · `assign(job: string, needs: list<string>): optional<string>` · `finish(job: string): bool` · `busy(): list<string>`                                                                                                       | yes: `drain(name: string)`: it takes no new jobs and leaves the pool when idle                                         |
| 5   | `outbox-sender` · Outbox sender                | dependency-inversion-principle, dependency-injection, transactional-outbox, idempotency-keys                                            | medium | Business code writes messages to an outbox, and a transport chosen at construction delivers them. The transport can be swapped at runtime and made to fail. Failed sends stay queued, and a duplicate id is refused.                       | `OutboxSender(transport: string)` · `enqueue(id: string, payload: string): bool` · `flush(): list<string>` · `failNext(n: int): void` · `swapTransport(transport: string): void` · `pending(): int`                                                                                                      | yes: `maxAttempts(n: int)` and `deadLetters(): list<string>`                                                           |
| 6   | `access-stats` · Access log stats              | single-responsibility-principle, separation-of-concerns                                                                                 | medium | Access-log lines are ingested, aggregated and reported: top paths, error rate and per-path median latency. Each of the three is its own unit.                                                                                              | `AccessStats()` · `ingest(line: string): bool` · `topPaths(n: int): list<string>` · `errorRate(): float` (approx) · `p50(path: string): int`                                                                                                                                                             | yes: `byStatusClass(): map<string,int>` (2xx, 4xx, 5xx)                                                                |
| 7   | `webhook-router` · Webhook event router        | open-closed-principle, webhooks                                                                                                         | medium | Events are routed to handlers by exact, prefix (`issue.*`) or catch-all patterns, in registration order and without duplicates. New matcher kinds slot in without touching the old ones.                                                   | `WebhookRouter()` · `route(pattern: string, handler: string): void` · `deliver(event: string): list<string>` · `unroute(handler: string): int`                                                                                                                                                           | yes: `exclude(handler: string, pattern: string)`, a negative matcher                                                   |
| 8   | `job-queue-kinds` · Interchangeable job queues | liskov-substitution-principle, message-queues                                                                                           | medium | FIFO, priority and delayed queues share one contract: `poll` returns only ready jobs, `size` counts every job, a polled job never returns, and `peekAt` predicts the next `poll`. The same scenarios run against every kind (technique 5). | `JobQueue(kind: string)` · `push(job: string, priority: int, notBeforeMs: int): void` · `poll(nowMs: int): optional<string>` · `peekAt(nowMs: int): optional<string>` · `size(): int`                                                                                                                    | yes: `cancel(job: string): bool`                                                                                       |
| 9   | `volume-drivers` · Volume drivers              | interface-segregation-principle, dependency-inversion-principle                                                                         | medium | Storage drivers support different operations (snapshot, resize, encrypt). An operation a volume's driver lacks fails cleanly and is never a silent no-op. Resizing never shrinks a volume.                                                 | `VolumeManager()` · `driver(name: string, ops: list<string>): void` · `create(volume: string, driver: string, sizeGb: int): bool` · `snapshot(volume: string): string` · `resize(volume: string, sizeGb: int): bool` · `snapshots(volume: string): list<string>`                                         | yes: `restore(volume: string, snapshot: string): bool`, only on drivers with snapshots                                 |
| 10  | `payment-orchestrator` · Payment orchestration | single-responsibility-principle, open-closed-principle, dependency-inversion-principle, liskov-substitution-principle, idempotency-keys | hard   | Charges try providers in a given order and fall back when one fails. Each provider kind (card, wallet, bank) has its own fee. An idempotency key returns the original outcome, and partial refunds never exceed what was captured.         | `PaymentOrchestrator()` · `provider(name: string, kind: string, feeBps: int): void` · `failProvider(name: string, times: int): void` · `charge(key: string, customer: string, cents: int, providers: list<string>): string` · `refund(key: string, cents: int): bool` · `settled(provider: string): int` | yes: `routeByAmount(thresholdCents: int, provider: string)`: charges at or above the threshold try that provider first |

### creational (12)

| #   | Slug · title                                    | Concepts                                                                             | Diff   | Brief                                                                                                                                                                                                                           | Contract sketch                                                                                                                                                                                                                                      | Ext                                                                                                  |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `settings-holder` · Process-wide settings       | singleton-pattern, lazy-initialization                                               | easy   | One settings object per process, loaded on first use and exactly once even when many threads read at once (technique 2; the concurrency layer checks `loads()` is 1). Overrides apply on top of what was loaded.                | `SettingsHolder(defaults: map<string,string>)` · `value(key: string): optional<string>` · `loads(): int` · `overrideKey(key: string, value: string): void` · `reload(): void`                                                                        | yes: `scoped(prefix: string): map<string,string>`, a read-only view of one prefix                    |
| 2   | `secret-loader` · Lazy secret loader            | lazy-initialization, secrets-management                                              | easy   | Secrets are fetched from a vault only the first time they're used, and fetched again only after a rotation. Fetches are counted, and an unknown name fails.                                                                     | `SecretLoader(names: list<string>)` · `reveal(name: string): string` · `fetches(): int` · `rotate(name: string): void`                                                                                                                               | yes: `prefetch(names: list<string>): int` warms several in one fetch                                 |
| 3   | `request-builder` · HTTP request builder        | builder-pattern, immutability, http-methods-and-status-codes                         | easy   | A request is built up step by step, then validated and frozen. A GET with a body fails at `build`. Headers are normalised, query parameters encoded and the content length set automatically.                                   | `RequestBuilder(method: string, url: string)` · `header(name: string, value: string): void` · `query(key: string, value: string): void` · `body(text: string): void` · `build(): list<string>`                                                       | yes: `bearer(token: string)`, which refuses a second Authorization header                            |
| 4   | `sink-factory` · Log sink factory               | factory-method-pattern                                                               | easy   | Sinks are created from spec strings (`stdout`, `file:/path`, `syslog:host:port`). Each kind writes a line in its own format, and a malformed spec fails.                                                                        | `SinkFactory()` · `create(spec: string): string` · `kindOf(sink: string): string` · `writeLine(sink: string, line: string): string` · `created(kind: string): int`                                                                                   | yes: `createBuffered(capacity: int): string` and `flush(sink: string): list<string>`                 |
| 5   | `env-templates` · Environment templates         | prototype-pattern                                                                    | easy   | Preview environments are forked from named templates and then customised. A fork is a deep copy: changing it never changes the template or other forks.                                                                         | `EnvTemplates()` · `define(name: string, vars: map<string,string>): void` · `fork(base: string, env: string): bool` · `setVar(env: string, key: string, value: string): bool` · `vars(env: string): map<string,string>`                              | yes: `diff(env: string): list<string>`, the changes from its template                                |
| 6   | `conn-pool` · Connection pool                   | object-pool-pattern, connection-pooling, race-conditions                             | medium | Connections are reused before new ones are made, up to a maximum. A double release is refused, and a broken connection is discarded. Under threads no connection goes to two clients.                                           | `ConnPool(maxSize: int)` · `acquire(client: string): optional<string>` · `release(conn: string): bool` · `invalidate(conn: string): bool` · `created(): int` · `idle(): int`                                                                         | yes: `shrink(maxIdle: int): int` closes idle connections over the limit                              |
| 7   | `trace-ids` · Trace ID source                   | singleton-pattern, unique-id-generation                                              | medium | Sortable IDs from a timestamp, a node number and a per-millisecond sequence. A clock that goes backwards reuses the last timestamp, and under threads no ID is ever issued twice.                                               | `TraceIds(nodeId: int)` · `nextId(nowMs: int): string` · `issued(): int` · `lastMs(): int`                                                                                                                                                           | yes: `decode(id: string): list<int>` (timestamp, node, sequence)                                     |
| 8   | `env-kit` · Test environment kit                | abstract-factory-pattern                                                             | medium | A kit makes matching families of queue, store and clock for local, CI and staging environments. Components from different families can't be wired together.                                                                     | `EnvKit()` · `use(family: string): void` · `component(kind: string): string` · `wire(a: string, b: string): bool` · `family(componentId: string): string`                                                                                            | yes: `defineFamily(name: string, prefix: string)`, a new family                                      |
| 9   | `query-builder` · SQL query builder             | builder-pattern, sql-injection                                                       | medium | A SELECT is built from columns, conditions, ordering and a limit. Values always become numbered placeholders and are never inlined. An identifier that isn't a plain name fails.                                                | `QueryBuilder(table: string)` · `columns(cols: list<string>): void` · `where(column: string, op: string, val: string): void` · `orderBy(column: string, desc: bool): void` · `limit(n: int): void` · `build(): string` · `params(): list<string>`    | yes: `innerJoin(table: string, leftColumn: string, rightColumn: string)`                             |
| 10  | `codec-registry` · Codec registry               | factory-method-pattern, open-closed-principle, serialization-formats                 | medium | Codecs are registered by content type. An Accept header (with q-values and wildcards) picks one, and the chosen codec encodes a flat record its own way.                                                                        | `CodecRegistry()` · `add(contentType: string, codec: string): void` · `negotiate(accept: string): optional<string>` · `encodeWith(contentType: string, fields: map<string,string>): string`                                                          | yes: `fallbackType(contentType: string)` is used when nothing matches                                |
| 11  | `stack-builder` · Infrastructure stack builder  | builder-pattern, abstract-factory-pattern                                            | hard   | Resources and their dependencies are added to a stack, by hand or from preset recipes (a web service, a queue worker). Validation lists missing required properties, and the plan orders creation by dependency without cycles. | `StackBuilder(name: string)` · `resource(kind: string, name: string, props: map<string,string>): bool` · `dependsOn(a: string, b: string): bool` · `preset(recipe: string, name: string): int` · `validate(): list<string>` · `plan(): list<string>` | yes: `destroyPlan(): list<string>`, the reverse order with dependents first                          |
| 12  | `di-container` · Dependency injection container | dependency-injection, singleton-pattern, factory-method-pattern, lazy-initialization | hard   | Services are registered with a lifetime (singleton, transient or scoped) and dependencies. Resolving builds the graph with instance IDs, detects cycles, and ending a scope disposes of its instances.                          | `DiContainer()` · `provide(service: string, lifetime: string, deps: list<string>): void` · `resolve(service: string, scope: string): string` · `constructed(service: string): int` · `endScope(scope: string): int`                                  | yes: `decorate(service: string, wrapper: string)`: resolving returns the wrapper around the original |

### structural (19)

| #   | Slug · title                               | Concepts                                                                            | Diff   | Brief                                                                                                                                                                                                                                                           | Contract sketch                                                                                                                                                                                                                                                            | Ext                                                                                                                                 |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `metrics-adapter` · Legacy metrics adapter | adapter-pattern, metrics                                                            | easy   | An old agent reports `name value unit` lines in mixed units (s, ms, us; B, KB, MB). The adapter feeds a new API that only knows milliseconds and bytes.                                                                                                         | `MetricsAdapter()` · `ingestLegacy(line: string): bool` · `gaugeMs(name: string): optional<float>` (approx) · `gaugeBytes(name: string): optional<int>` · `names(): list<string>`                                                                                          | yes: `ingestBatch(lines: list<string>): int`, which skips bad lines and counts the good ones                                        |
| 2   | `handler-middleware` · Handler middleware  | decorator-pattern                                                                   | easy   | A request handler is wrapped in layers (auth, request id, compression marker). A request returns the trace of layers entered and left around the response. Order matters, and auth short-circuits.                                                              | `HandlerStack(handler: string)` · `wrap(layer: string): void` · `handle(path: string, token: string): list<string>` · `layers(): list<string>`                                                                                                                             | yes: `unwrap(): bool` removes the outermost layer                                                                                   |
| 3   | `pager-adapter` · Pager adapter            | adapter-pattern                                                                     | easy   | A legacy pager speaks numeric team codes and severities 1–5. The incident API speaks team names and `sev1`–`sev3`. The adapter translates both ways.                                                                                                            | `PagerAdapter(teamCodes: map<string,int>)` · `page(team: string, severity: string, summary: string): string` · `ack(legacyLine: string): optional<string>` · `pages(): int`                                                                                                | no                                                                                                                                  |
| 4   | `symbol-interner` · Symbol interner        | flyweight-pattern, immutability                                                     | easy   | A tokenizer stores each distinct identifier once and hands out stable integer IDs. Bytes saved are counted against storing every occurrence.                                                                                                                    | `Interner()` · `intern(text: string): int` · `lookup(id: int): string` (unknown fails) · `size(): int` · `bytesSaved(): int`                                                                                                                                               | no                                                                                                                                  |
| 5   | `deploy-facade` · Deploy facade            | facade-pattern, rolling-deployments                                                 | medium | One `deploy` call drives build, push, migrate, roll out and announce, and returns the steps taken. A step made to fail stops the run and rolls back what already ran. History is kept per service.                                                              | `DeployFacade()` · `deploy(service: string, version: string): list<string>` · `breakStep(step: string): void` · `history(service: string): list<string>` · `rollback(service: string): optional<string>`                                                                   | yes: `dryRun(service: string, version: string): list<string>`, the steps with nothing changed                                       |
| 6   | `bucket-adapter` · Bucket-style adapter    | adapter-pattern, object-storage                                                     | medium | A flat legacy key-value store is adapted to a bucket and key API, with prefix listing and delimiter-grouped common prefixes. The legacy key encoding is fixed and visible.                                                                                      | `BucketAdapter()` · `putObject(bucket: string, key: string, body: string): void` · `objectBody(bucket: string, key: string): optional<string>` · `listObjects(bucket: string, prefix: string, delimiter: string): list<string>` · `legacyKeys(): list<string>`             | yes: `copyObject(bucket: string, key: string, toBucket: string, toKey: string): bool`                                               |
| 7   | `config-proxy` · Read-through config proxy | proxy-pattern, cache-aside, caching                                                 | medium | A proxy in front of a slow config service caches values for a TTL. Upstream fetches are counted (technique 2). While the upstream is down, stale values are served.                                                                                             | `ConfigProxy(ttlMs: int)` · `upstreamSet(key: string, val: string): void` · `read(key: string, nowMs: int): optional<string>` · `upstreamDown(down: bool): void` · `upstreamFetches(): int`                                                                                | yes: `invalidate(key: string)`                                                                                                      |
| 8   | `admin-proxy` · Protected admin API        | proxy-pattern, rbac, authentication-vs-authorization                                | medium | An access proxy checks roles before forwarding admin actions and audits every attempt. Real calls are counted, so a denied call provably never reached the API.                                                                                                 | `AdminProxy()` · `grant(user: string, role: string): void` · `invoke(user: string, action: string, target: string): string` · `audit(): list<string>` · `realCalls(): int`                                                                                                 | yes: `breakGlass(user: string)` grants admin until `endBreakGlass(user: string)`, and every break-glass call is marked in the audit |
| 9   | `lazy-index` · Lazy search index           | proxy-pattern, lazy-initialization, inverted-index                                  | medium | The index is built only on the first search. Documents added afterwards are indexed incrementally and never trigger a rebuild. Builds are counted.                                                                                                              | `LazyIndex()` · `addDoc(id: string, text: string): void` · `search(term: string): list<string>` · `builds(): int` · `indexed(): int`                                                                                                                                       | yes: `removeDoc(id: string): bool`                                                                                                  |
| 10  | `payload-pipeline` · Payload encoders      | decorator-pattern, serialization-formats                                            | medium | Encoders (base64, hex, length-prefix framing) stack in any order. Decode reverses the stack exactly, and malformed input fails.                                                                                                                                 | `PayloadPipeline()` · `push(layer: string): void` · `encode(text: string): string` · `decode(text: string): string` · `layers(): list<string>`                                                                                                                             | yes: `checksum()` adds a layer that appends a check digit and fails decode on a mismatch                                            |
| 11  | `alert-tree` · Alert rule groups           | composite-pattern                                                                   | medium | Alert rules sit in nested groups. Muting a group mutes everything under it. Evaluating a set of metrics returns the full paths of the rules that fire.                                                                                                          | `AlertTree()` · `group(parent: string, name: string): bool` · `rule(parent: string, name: string, metric: string, threshold: int): bool` · `mute(node: string, on: bool): bool` · `firing(metrics: map<string,int>): list<string>` · `count(node: string): int`            | yes: `moveNode(node: string, parent: string): bool`                                                                                 |
| 12  | `cost-tree` · Cost allocation tree         | composite-pattern                                                                   | medium | Org units contain teams, and teams contain services with monthly costs. Totals roll up through the tree. Moving a subtree moves its costs, and the top direct children can be listed.                                                                           | `CostTree(root: string)` · `unit(parent: string, name: string): bool` · `service(parent: string, name: string, cents: int): bool` · `total(node: string): int` · `move(node: string, parent: string): bool` · `top(node: string, n: int): list<string>`                    | yes: `sharedCost(node: string, cents: int)` split evenly among direct children                                                      |
| 13  | `notifier-bridge` · Notification bridge    | bridge-pattern                                                                      | medium | Message kinds (alert, digest, receipt) and channels (email, chat, SMS) vary independently. Each pair renders by combining the kind's layout with the channel's limits.                                                                                          | `Notifier()` · `send(kind: string, channel: string, subject: string, body: string): string` · `sent(channel: string): int` · `channelLimit(channel: string, maxChars: int): void`                                                                                          | yes: `addPush()` adds a fourth channel, which works with every kind                                                                 |
| 14  | `metrics-exporter` · Metrics exporters     | bridge-pattern, metrics                                                             | medium | Counters and histograms (fixed buckets) are kept once and exported in either of two text formats, Prometheus-style or StatsD-style. Switching format re-renders the same data.                                                                                  | `MetricsExporter(format: string)` · `counter(name: string, by: int, tags: map<string,string>): void` · `observe(name: string, val: int, tags: map<string,string>): void` · `scrape(): list<string>` · `switchFormat(format: string): void`                                 | yes: `gauge(name: string, val: int, tags: map<string,string>)`, a third metric kind                                                 |
| 15  | `log-templates` · Log template interning   | flyweight-pattern                                                                   | medium | Log events share message patterns such as `user {} logged in`. Each pattern is stored once (the shared state) and each event keeps only its parameters. Events render on demand.                                                                                | `LogStore()` · `log(pattern: string, params: list<string>): int` · `render(eventId: int): string` · `templates(): int` · `byPattern(pattern: string): list<int>`                                                                                                           | yes: `purge(pattern: string): int` drops a pattern and its events                                                                   |
| 16  | `client-stack` · HTTP client layers        | decorator-pattern, retries-with-backoff, circuit-breakers, caching                  | hard   | A fake transport returns scripted statuses. Retry, cache and circuit-breaker layers wrap it in a chosen order, and the order changes the result (cache outside retry versus inside). Upstream calls are counted.                                                | `ClientStack()` · `script(path: string, statuses: list<int>): void` · `wrap(layer: string, param: int): void` · `fetch(path: string, nowMs: int): int` · `upstreamCalls(): int`                                                                                            | yes: `hedge(afterMs: int)`, a layer that sends a second request when the first is slow                                              |
| 17  | `api-gateway` · API gateway                | facade-pattern, proxy-pattern, api-gateway, caching                                 | hard   | Routes by longest prefix to scripted upstream services, with per-route auth and response caching. A request reports status, the service that answered and whether it was a cache hit.                                                                           | `Gateway()` · `route(prefix: string, service: string): void` · `requireAuth(prefix: string): void` · `cache(prefix: string, ttlMs: int): void` · `upstream(service: string, statuses: list<int>): void` · `request(path: string, token: string, nowMs: int): list<string>` | yes: `rewrite(prefix: string, replacement: string)`, a path rewrite before routing                                                  |
| 18  | `doc-tree` · Document tree                 | composite-pattern                                                                   | hard   | A nested document of objects, arrays and scalars addressed by paths like `a.b[2].c`. Writes create intermediate nodes, and reads of a branch return a summary. Leaves can be listed under any prefix.                                                           | `DocTree()` · `put(path: string, val: string): bool` · `read(path: string): optional<string>` · `remove(path: string): bool` · `paths(prefix: string): list<string>` · `count(path: string): int`                                                                          | yes: `merge(path: string, entries: map<string,string>): int`, a shallow merge                                                       |
| 19  | `flag-client` · Feature flag SDK           | facade-pattern, adapter-pattern, proxy-pattern, feature-flags, graceful-degradation | hard   | A client SDK hides fetching, caching and evaluating targeting rules (attribute equals, bucket under a percentage, named user) behind one `evaluate`. It falls back to defaults when the server was never reached, and to its last copy when the server is down. | `FlagClient(defaults: map<string,bool>)` · `serverRules(flag: string, rules: list<string>, version: int): void` · `sync(nowMs: int, reachable: bool): bool` · `evaluate(flag: string, user: string, attrs: map<string,string>): bool` · `staleMs(nowMs: int): int`         | yes: `localOverride(flag: string, on: bool)`, which wins over every rule                                                            |

### behavioural (28)

| #   | Slug · title                                        | Concepts                                                                                        | Diff   | Brief                                                                                                                                                                                                                           | Contract sketch                                                                                                                                                                                                                                                                                                                             | Ext                                                                                                                                                           |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lb-strategies` · Load balancing strategies         | strategy-pattern, load-balancing                                                                | easy   | Backends are picked by round robin, least connections or smooth weighted round robin, and the strategy can be switched at runtime without losing connection counts.                                                             | `Balancer(strategy: string)` · `addBackend(name: string, weight: int): void` · `pick(): string` · `done(backend: string): void` · `useStrategy(strategy: string): void`                                                                                                                                                                     | yes: `drain(backend: string)`: it is never picked again                                                                                                       |
| 2   | `build-events` · Build status subscribers           | observer-pattern, publish-subscribe                                                             | easy   | Subscribers choose which build events they want. Publishing delivers to them in subscription order and returns the deliveries. Unsubscribing stops delivery at once.                                                            | `BuildEvents()` · `subscribe(subscriber: string, events: list<string>): void` · `unsubscribe(subscriber: string): bool` · `publish(event: string, build: string): list<string>` · `inbox(subscriber: string): list<string>`                                                                                                                 | yes: `pause(subscriber: string)` and `resume(subscriber: string): int`: paused events are kept and delivered on resume                                        |
| 3   | `config-editor` · Config edits with undo            | command-pattern                                                                                 | easy   | Edits to a key-value config (put, remove, append to a value) are commands that can be undone and redone. A new edit clears the redo stack.                                                                                      | `ConfigEditor()` · `apply(op: string, key: string, val: string): bool` · `undo(): bool` · `redo(): bool` · `view(): map<string,string>`                                                                                                                                                                                                     | yes: `batch(ops: list<string>): bool`, several edits undone as one                                                                                            |
| 4   | `circuit-breaker` · Circuit breaker                 | state-pattern, circuit-breakers, finite-state-machines                                          | easy   | Closed, open and half-open states, each with its own rules. A threshold of consecutive failures opens the breaker. After the cool-down one trial call is allowed, and its outcome closes or reopens it.                         | `CircuitBreaker(threshold: int, coolDownMs: int)` · `allow(nowMs: int): bool` · `success(nowMs: int): void` · `failure(nowMs: int): void` · `state(nowMs: int): string`                                                                                                                                                                     | yes: `forceOpen(on: bool)`, a manual override                                                                                                                 |
| 5   | `cursor-pager` · Cursor pagination                  | iterator-pattern, pagination                                                                    | easy   | A sorted result set is walked one item at a time or a page at a time. Cursors name the last item seen, not an offset.                                                                                                           | `ResultPager(items: list<string>, pageSize: int)` · `hasNext(): bool` · `next(): string` · `page(cursor: string): list<string>` · `nextCursor(cursor: string): optional<string>`                                                                                                                                                            | yes: `insertItem(item: string)` mid-walk; cursors stay stable and never skip or repeat an item                                                                |
| 6   | `ci-job-template` · CI job template                 | template-method-pattern                                                                         | easy   | Every job runs the same fixed skeleton (checkout, setup, install, test, report) with language-specific steps for node, python and go. Optional hooks can be skipped. Report always runs, even after a failure.                  | `JobRunner()` · `steps(kind: string): list<string>` · `skip(step: string): void` · `runJob(kind: string, failAt: string): list<string>`                                                                                                                                                                                                     | yes: `beforeEach(command: string)`, a hook before every step                                                                                                  |
| 7   | `optional-tracer` · Optional tracing                | null-object-pattern, distributed-tracing                                                        | easy   | Only every Nth trace is sampled. Unsampled traces get no-op spans with the same API, which never fail and record nothing. Callers never check whether tracing is on.                                                            | `Tracer(sampleEvery: int)` · `startTrace(name: string): string` · `span(trace: string, name: string): int` · `endSpan(trace: string, spanId: int): bool` · `recorded(trace: string): list<string>`                                                                                                                                          | yes: `forceSample(trace: string)` upgrades a trace from that point on                                                                                         |
| 8   | `oncall-escalation` · On-call escalation            | chain-of-responsibility-pattern                                                                 | easy   | A page goes to the primary on-call. If nobody acknowledges within the timeout, it passes to the next level. Ticking the clock returns the new escalations.                                                                      | `Escalation(levels: list<string>, ackTimeoutMs: int)` · `page(incident: string, nowMs: int): string` · `tick(nowMs: int): list<string>` · `ack(incident: string, person: string, nowMs: int): bool` · `holder(incident: string): optional<string>`                                                                                          | yes: `cover(person: string, substitute: string)` for holiday cover                                                                                            |
| 9   | `eviction-policies` · Pluggable eviction            | strategy-pattern, cache-eviction-policies                                                       | medium | A bounded cache whose eviction policy (LRU, LFU with LRU tie-break, or FIFO) can be switched at runtime. Usage history is kept across switches.                                                                                 | `EvictingCache(capacity: int, policy: string)` · `put(key: string, val: int): void` · `lookup(key: string): optional<int>` · `keys(): list<string>` · `switchPolicy(policy: string): void`                                                                                                                                                  | yes: `pinKey(key: string)`: a pinned key is never evicted                                                                                                     |
| 10  | `slo-alerts` · SLO burn alerts                      | observer-pattern, slos-and-error-budgets                                                        | medium | Subscribers watch services at a budget-burn threshold. Good and bad request counts update the error budget. Each watcher is notified once when the threshold is crossed and once when it recovers.                              | `SloMonitor(objectivePermille: int)` · `watch(subscriber: string, service: string, burnPercent: int): void` · `observe(service: string, good: int, bad: int): list<string>` · `budgetLeft(service: string): int`                                                                                                                            | yes: `unwatch(subscriber: string, service: string): bool`                                                                                                     |
| 11  | `command-bus` · Ops command bus                     | command-pattern, idempotency-keys                                                               | medium | Ops commands (scale, pause, resume a service) are queued with IDs, run in order, never run twice for one ID, and undone in reverse order where they're reversible.                                                              | `CommandBus()` · `submit(id: string, command: string, arg: string): bool` · `execute(): list<string>` · `undoLast(): optional<string>` · `replicas(service: string): int` · `log(): list<string>`                                                                                                                                           | yes: `schedule(id: string, command: string, arg: string, atMs: int)` and `executeDue(nowMs: int): list<string>`                                               |
| 12  | `rollout` · Deployment rollout                      | state-pattern, finite-state-machines, canary-releases                                           | medium | A rollout moves from pending to canary at 10%, then 50%, then 100% and done, can be paused and resumed, and can be aborted to rolled-back from canary or rolling. Each state allows only its own moves.                         | `Rollout(service: string)` · `begin(version: string): bool` · `advance(): bool` · `pause(): bool` · `resume(): bool` · `abort(): bool` · `status(): string`                                                                                                                                                                                 | yes: `autoAdvance(errorRate: float)`: advances when under 1%, aborts when over 5%                                                                             |
| 13  | `import-job` · Import jobs                          | template-method-pattern                                                                         | medium | Imports run a fixed extract, validate, transform and load skeleton. Two kinds (user rows, event rows) differ only in validation and transformation. Rejected lines say why.                                                     | `ImportJob(kind: string)` · `runImport(lines: list<string>): map<string,int>` · `loaded(): list<string>` · `rejects(): list<string>`                                                                                                                                                                                                        | yes: `dedupe(on: bool)` adds an optional skeleton step that drops duplicates                                                                                  |
| 14  | `log-merger` · Merged log tail                      | iterator-pattern                                                                                | medium | Several log streams, each in time order, are iterated as one merged stream (ties broken by stream name). Lines may be added while iterating, and the iterator can skip ahead to a time.                                         | `LogMerger()` · `addLine(stream: string, ts: int, line: string): bool` · `hasNext(): bool` · `next(): string` · `skipUntil(ts: int): int`                                                                                                                                                                                                   | yes: `filterStream(stream: string, on: bool)` hides or shows one stream mid-iteration                                                                         |
| 15  | `risk-chain` · Payment risk checks                  | chain-of-responsibility-pattern                                                                 | medium | Ordered checks (blocklist, velocity in a window, amount limit, country mismatch) each allow, review or block a payment, or pass it on. The first decisive check wins.                                                           | `RiskChain()` · `addCheck(check: string, param: int): void` · `block(customer: string): void` · `assess(customer: string, cents: int, country: string, nowMs: int): string` · `decisions(verdict: string): int`                                                                                                                             | yes: `skipFor(customer: string, check: string)` for trusted customers                                                                                         |
| 16  | `release-train` · Release train                     | mediator-pattern                                                                                | medium | Teams board changes onto trains, and QA and security sign off. The train coordinates everyone, so pulling a change resets the sign-offs. A train departs only when it's fully signed off. Late changes wait for the next train. | `ReleaseTrain()` · `board(team: string, change: string): string` · `signOff(role: string, train: string): bool` · `pull(change: string): bool` · `depart(train: string): list<string>`                                                                                                                                                      | yes: `hotfix(change: string): string` departs alone with only the security sign-off                                                                           |
| 17  | `infra-snapshots` · Infra state snapshots           | memento-pattern                                                                                 | medium | Infrastructure state (resources and attributes) is snapshotted under labels and restored exactly. A diff since any snapshot lists what was added, removed and changed.                                                          | `InfraState()` · `apply(resource: string, attrs: map<string,string>): void` · `destroy(resource: string): bool` · `snapshot(label: string): int` · `restore(snapshotId: int): bool` · `diffSince(snapshotId: int): list<string>`                                                                                                            | yes: `prune(keep: int): int` drops all but the newest snapshots                                                                                               |
| 18  | `manifest-visitors` · Manifest checks               | visitor-pattern                                                                                 | medium | A set of deployment, service and config-map manifests is walked by named visitors: inventory, lint (single replica, missing CPU limit) and cost. Adding an operation never touches the element kinds.                           | `ManifestSet()` · `addResource(kind: string, name: string, fields: map<string,int>): bool` · `runVisitor(visitor: string): list<string>` · `kinds(): list<string>`                                                                                                                                                                          | yes: `securityAudit(): list<string>`, a fourth visitor                                                                                                        |
| 19  | `alert-expr` · Alert expressions                    | interpreter-pattern                                                                             | medium | A small expression language (comparisons, and, or, not, parentheses) over metric names. It is parsed once in the constructor, where bad syntax fails, and evaluated against many metric snapshots. An absent metric is false.   | `AlertExpr(expression: string)` · `evaluate(metrics: map<string,int>): bool` · `variables(): list<string>` · `depth(): int` · `evaluations(): int`                                                                                                                                                                                          | yes: `rewrite(name: string, replacement: string): string`, renaming a metric in the parsed tree                                                               |
| 20  | `shard-router` · Shard routing                      | strategy-pattern, sharding                                                                      | medium | Keys route to shards by modulo of a hash fixed in the statement, by key ranges, or by an explicit directory. Rebalancing to a new shard count reports how many tracked keys move.                                               | `ShardRouter(shards: int, strategy: string)` · `route(key: string): int` · `track(key: string): void` · `assignDirectory(key: string, shard: int): void` · `rebalance(shards: int): int`                                                                                                                                                    | yes: `useStrategy(strategy: string): int`, the keys that would move                                                                                           |
| 21  | `invalidation-bus` · Cache invalidation bus         | observer-pattern, publish-subscribe, cache-invalidation                                         | medium | App nodes keep local caches and subscribe to invalidations. A node that was offline sees a version gap when it returns and flushes everything, so it never serves stale data.                                                   | `InvalidationBus()` · `join(node: string): void` · `cacheLocal(node: string, key: string, val: string): void` · `write(key: string): int` · `cached(node: string, key: string): optional<string>` · `offline(node: string, down: bool): void`                                                                                               | yes: `keyspace(node: string, prefix: string)`: a node hears only its prefixes                                                                                 |
| 22  | `payment-intent` · Payment intent                   | state-pattern, finite-state-machines, idempotency                                               | medium | A payment moves from awaiting payment to processing, then succeeded or failed, then refunded. Captures may be partial, and refunds never pass what was captured. Each state permits only its own operations.                    | `PaymentIntent(amountCents: int)` · `confirm(): bool` · `settle(succeeded: bool): bool` · `capture(cents: int): bool` · `refund(cents: int): bool` · `status(): string`                                                                                                                                                                     | yes: `dispute(cents: int): bool` from succeeded or refunded                                                                                                   |
| 23  | `provisioning-saga` · Account provisioning saga     | saga-pattern, command-pattern, state-pattern                                                    | hard   | Creating an account runs create-user, create-repo, grant-access and send-welcome. A failure runs compensations in reverse, and a retry resumes idempotently. The trail records every do and undo.                               | `ProvisioningSaga()` · `failStep(step: string, times: int): void` · `start(account: string): string` · `retry(account: string): string` · `trail(account: string): list<string>` · `status(account: string): string`                                                                                                                        | yes: `pivot(step: string)`: past this step the saga only moves forward and never compensates                                                                  |
| 24  | `shared-undo` · Collaborative undo                  | command-pattern, memento-pattern                                                                | hard   | Several users edit one key-value document. Each undoes only their own last edit, even after others edited. An undo conflicts and fails when someone else has since changed the same key.                                        | `SharedDoc()` · `edit(user: string, key: string, val: string): void` · `undo(user: string): bool` · `redo(user: string): bool` · `value(key: string): optional<string>` · `history(key: string): list<string>`                                                                                                                              | yes: `undoForce(user: string): bool` undoes despite a conflict and records it                                                                                 |
| 25  | `log-query` · Log query language                    | interpreter-pattern, visitor-pattern, structured-logging                                        | hard   | A small piped query language (filter by field comparison, count by field, sort, top N) runs over ingested structured records. Parsing builds a stage tree, and an explain call lists the stages.                                | `LogQuery()` · `ingest(fields: map<string,string>): void` · `run(query: string): list<string>` · `explainQuery(query: string): list<string>`                                                                                                                                                                                                | yes: `saveView(name: string, query: string)`: a saved view can be used as a source in later queries                                                           |
| 26  | `subscription-ledger` · Event-sourced subscriptions | event-sourcing, command-pattern, memento-pattern                                                | hard   | Commands (create, upgrade, pause, cancel) are checked against the current state and stored as events. State at any time is rebuilt by replay, and snapshots cut down how much is replayed (counted).                            | `SubscriptionLedger()` · `handle(command: string, sub: string, arg: int, nowMs: int): bool` · `events(sub: string): list<string>` · `stateAt(sub: string, nowMs: int): string` · `snapshotEvery(n: int): void` · `replays(): int`                                                                                                           | yes: `upcast(eventName: string, newName: string)`: old events are read under a new schema name                                                                |
| 27  | `topic-broker` · Topic broker                       | observer-pattern, mediator-pattern, consumer-groups, at-least-once-delivery, dead-letter-queues | hard   | Messages on a topic are delivered to each consumer group at least once. Within a group, consumers share the messages. A nack redelivers, and too many nacks send a message to the group's dead-letter list.                     | `Broker()` · `publishMsg(topic: string, payload: string): int` · `subscribeGroup(group: string, topic: string, consumer: string): void` · `poll(group: string, consumer: string, max: int): list<string>` · `ack(group: string, offset: int): bool` · `nack(group: string, offset: int): bool` · `deadLetters(group: string): list<string>` | yes: `replayFrom(group: string, offset: int): int`, which rewinds a group                                                                                     |
| 28  | `policy-engine` · Access policy engine              | interpreter-pattern, chain-of-responsibility-pattern, rbac                                      | hard   | Policies are text rules: effect, role, action, resource glob and an optional hour condition. An explicit deny always wins. A decision names the policy that decided it, or says no policy matched.                              | `PolicyEngine()` · `addPolicy(id: string, text: string): bool` · `removePolicy(id: string): bool` · `decide(user: string, roles: list<string>, action: string, resource: string, hour: int): string`                                                                                                                                        | yes: `simulate(text: string, user: string, roles: list<string>, action: string, resource: string, hour: int): string`, deciding as if one more policy existed |

### systems (4, existing)

lru-cache, parking-lot, meeting-rooms and elevator-system are already practice problems (ADR-0048). They get `topic: systems` and concepts:

| Slug            | Concepts (proposed)                                                |
| --------------- | ------------------------------------------------------------------ |
| lru-cache       | cache-eviction-policies, caching, encapsulation, locks-and-mutexes |
| parking-lot     | object-composition, class-invariants, race-conditions              |
| meeting-rooms   | class-invariants, encapsulation, locks-and-mutexes                 |
| elevator-system | state-pattern, finite-state-machines, strategy-pattern             |

## Ideas merged or dropped

The seed's idea space covers some things the format can't judge. Each was handled as follows.

| Idea                                                                 | Decision    | Why, and where it went                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KISS as a stand-alone problem                                        | **dropped** | Simplicity has no observable behaviour, so a judge can't tell a simple solution from a convoluted one with the same results. Not in the catalog, and no concept proposed.                                             |
| YAGNI as a stand-alone problem                                       | **dropped** | The absence of speculative code isn't observable. Same as KISS.                                                                                                                                                       |
| Access modifiers, multiple inheritance and the diamond problem       | **dropped** | These are language-specific (Go has no inheritance, and Python has no private members), so they can't be the same task in five languages. Encapsulation is tested through invariants instead (technique 3).           |
| Reading or drawing UML class diagrams                                | **dropped** | Not code. The relationship kinds are tested through lifetimes and ownership instead (relationships 1–9).                                                                                                              |
| "Refactor this legacy code" exercises (most of principles and SOLID) | **merged**  | The format has no field for legacy starter code, so every one became "build to the spec, then take the change request" (technique 1). A `starter` field would make true refactoring katas possible (open question 1). |
| Method overloading                                                   | **merged**  | An interface can't declare two methods with one name (`method names repeat` is refused), and not every language overloads. It went into polymorphism-by-kind (oop 5, 10, 15, 16).                                     |
| Law of Demeter, tell-don't-ask                                       | **merged**  | Both became one problem whose behaviour is a single question asked of the owner (principles 3, `deploy-gate`).                                                                                                        |
| A fat interface split into narrow ones (ISP)                         | **merged**  | Interface shape isn't observable. ISP became "an unsupported operation fails cleanly and never silently no-ops, and work only goes to a component that has the capability" (solid 4 and 9).                           |
| Injecting a dependency object (DIP, DI)                              | **merged**  | No objects cross the interface, so the dependency is named by a string at construction and swappable at runtime (solid 5, principles 10). A real container is creational 12.                                          |
| Simple factory as a pattern of its own                               | **merged**  | Folded into factory method (creational 4 and 10) with one concept.                                                                                                                                                    |
| "Only one instance" of a singleton                                   | **merged**  | The harness constructs the class, so "one" can't be checked by identity. It became "loaded or initialised exactly once", judged by a counter and by the concurrency layer (creational 1, 2, 7).                       |
| Observers registered as callbacks                                    | **merged**  | No functions cross the interface, so subscribers are named, and deliveries are returned or kept in an inbox (behavioural 2, 10, 21, 27).                                                                              |
| Visitor double dispatch over element objects                         | **merged**  | No element objects cross the interface, so visitors are named, and the extension adds a visitor without changing element kinds (behavioural 18).                                                                      |
| A rate limiter as a strategy exercise                                | **dropped** | Too close to the battle problem `rate-limiter`, whose tests a practice problem must never help probe. The strategy idea went to load balancing, eviction and sharding (behavioural 1, 9, 20).                         |

## Concurrency layers

`problems.test.ts` currently requires at least one concurrency scenario per problem. Each contract above except `price-display` has a mutator whose combined effect a later call can judge (`alert-expr` judges its `evaluations()` counter). The natural threaded scenario is:

- **"only once" problems:** threads call the lazy or shared operation at once, and the counter is judged (`settings-holder`, `secret-loader`, `lazy-index`, `config-proxy`, `di-container`);
- **"never two" problems:** threads take from a shared resource, and the leftovers are judged (`conn-pool`, `trace-ids`, `warehouse-stock`, `disk-quota`, `runner-pool`, `work-queue`);
- **everything else:** threads hit the main mutator (`inc`, `publish`, `apply`, `addDoc`, …), and totals are judged afterwards.

For many pattern exercises the threads add locking work in six languages without teaching the pattern. See open question 2.

## New concepts for the concept graph

The concept graph has no object-oriented design or design-pattern concepts yet: all 250 are about backend, databases, distributed systems or system design. The catalog needs **58 new concepts**. The rest of its concepts already exist (feature-flags, caching, cache-aside, rbac, idempotency-keys, saga-pattern, event-sourcing, circuit-breakers, publish-subscribe, consumer-groups, object-storage, and so on).

**Topic.** `concept.topic` is checked against the four launch topics (C-32: `system-design | databases | distributed-systems | backend`) in both the migration and `concepts/graph.py`. None of them is "software design". The YAML below uses `backend`, the closest one, so it loads today. A fifth topic would be a product decision (C-32, onboarding and feed topics), so it's open question 3, not proposed here.

**Aliases** shortlist moments for tagging (whole words, any case). They are deliberately multi-word where a single word would over-match in ordinary prose: `decorator pattern` and never `decorator` (Python decorators), `adapter pattern` and never `adapter`, and never a bare `SOLID`, `factory`, `state` or `proxy`.

Paste under `concepts:` in `workers/jobs/seeds/concepts.yaml`, indented two spaces (Prettier strips the indentation inside this block), and bump `version` to 4 (owner approval needed, per the file's header). Every prerequisite edge below is acyclic. The edges were checked with a script against this list and the 250 existing slugs.

```yaml
# --- software design (LLD practice catalog, PROVISIONAL 2026-11-23) --------------
# Drafted by Claude for docs/lld-practice-catalog.md; NOT owner-approved. Topic is
# `backend` until the owner decides whether software design is its own topic.
- slug: classes-and-objects
  name: Classes and objects
  topic: backend
  description: Bundling state with the operations on it, and creating instances from a class.
  aliases: [object-oriented programming, OOP, class and object]
- slug: encapsulation
  name: Encapsulation
  topic: backend
  description: Hiding an object's state behind operations so no caller can break its rules.
  aliases: [information hiding, data hiding]
  prerequisites: [classes-and-objects]
- slug: abstraction
  name: Abstraction
  topic: backend
  description: Exposing what something does while hiding how it does it.
  aliases: [leaky abstraction, abstraction layer]
  prerequisites: [classes-and-objects]
- slug: inheritance
  name: Inheritance
  topic: backend
  description: Defining a class as a specialisation of another, reusing and overriding its behaviour.
  aliases: [subclassing, class inheritance, base class, subclass]
  prerequisites: [classes-and-objects]
- slug: polymorphism
  name: Polymorphism
  topic: backend
  description: One call working on many kinds of object, each answering in its own way.
  aliases: [dynamic dispatch, method overriding, subtype polymorphism]
  prerequisites: [inheritance]
- slug: interfaces-and-abstract-classes
  name: Interfaces and abstract classes
  topic: backend
  description: Declaring a contract that several implementations fulfil.
  aliases: [abstract class, abstract classes, interface type, protocol class]
  prerequisites: [abstraction, polymorphism]
- slug: class-invariants
  name: Class invariants
  topic: backend
  description: Rules about an object's state that hold before and after every public operation.
  aliases: [class invariant, object invariant, invariants]
  prerequisites: [encapsulation]
- slug: immutability
  name: Immutability
  topic: backend
  description: Objects whose state never changes after creation, so they can be shared safely.
  aliases: [immutable objects, immutable object, immutable data]
  prerequisites: [encapsulation]
- slug: value-objects
  name: Value objects
  topic: backend
  description: Small immutable objects compared by value, such as money or a duration.
  aliases: [value object, value type]
  prerequisites: [immutability]
- slug: enumerations
  name: Enumerations
  topic: backend
  description: A type with a fixed set of named values, used for kinds and states.
  aliases: [enum, enums, enumerated type]
  prerequisites: [classes-and-objects]
- slug: association
  name: Association
  topic: backend
  description: A relationship in which objects know about each other but neither owns the other.
  aliases: [object association, class association]
  prerequisites: [classes-and-objects]
- slug: aggregation
  name: Aggregation
  topic: backend
  description: A whole that groups parts which can outlive it.
  aliases: [has-a relationship, object aggregation]
  prerequisites: [association]
- slug: object-composition
  name: Composition
  topic: backend
  description: A whole that owns its parts, which are created and destroyed with it.
  aliases: [object composition, composite object, part-of relationship]
  prerequisites: [aggregation]
- slug: dependency-relationship
  name: Dependencies between classes
  topic: backend
  description: One class using another to do its work, and the coupling that creates.
  aliases: [uses-a relationship, class dependency, class dependencies]
  prerequisites: [association]
- slug: separation-of-concerns
  name: Separation of concerns
  topic: backend
  description: Splitting a program so each part deals with one concern.
  aliases: [separation of concerns, SoC]
  prerequisites: [abstraction]
- slug: cohesion-and-coupling
  name: Cohesion and coupling
  topic: backend
  description: Keeping related behaviour together and dependencies between parts few and narrow.
  aliases: [high cohesion, loose coupling, tight coupling, low coupling]
  prerequisites: [separation-of-concerns, dependency-relationship]
- slug: dry-principle
  name: Don't repeat yourself
  topic: backend
  description: Giving every rule one authoritative place so copies can't drift apart.
  aliases: [DRY, don't repeat yourself, DRY principle]
  prerequisites: [abstraction]
- slug: law-of-demeter
  name: Law of Demeter
  topic: backend
  description: Talking only to an object's immediate collaborators; tell, don't ask.
  aliases: [law of demeter, principle of least knowledge, tell don't ask]
  prerequisites: [encapsulation, association]
- slug: composition-over-inheritance
  name: Composition over inheritance
  topic: backend
  description: Combining small behaviours at runtime instead of growing a class hierarchy.
  aliases: [composition over inheritance, favor composition over inheritance]
  prerequisites: [object-composition, inheritance]
- slug: encapsulate-what-varies
  name: Encapsulate what varies
  topic: backend
  description: Isolating the parts likely to change behind a stable boundary.
  aliases: [encapsulate what varies]
  prerequisites: [encapsulation, polymorphism]
- slug: program-to-an-interface
  name: Program to an interface
  topic: backend
  description: Depending on a contract rather than on a concrete implementation.
  aliases:
    [program to an interface, code to an interface, program to interfaces]
  prerequisites: [interfaces-and-abstract-classes]
- slug: design-by-contract
  name: Design by contract
  topic: backend
  description: Stating each operation's preconditions, postconditions and invariants.
  aliases:
    [
      design by contract,
      preconditions and postconditions,
      precondition,
      postcondition,
    ]
  prerequisites: [class-invariants]
- slug: fail-fast
  name: Fail fast
  topic: backend
  description: Rejecting bad input or configuration at once instead of failing later.
  aliases: [fail fast, fail-fast validation]
  prerequisites: [design-by-contract]
- slug: solid-principles
  name: SOLID principles
  topic: backend
  description: Five object-oriented design principles for code that is easy to change.
  aliases: [SOLID principles, SOLID design principles]
  prerequisites: [cohesion-and-coupling, program-to-an-interface]
- slug: single-responsibility-principle
  name: Single responsibility principle
  topic: backend
  description: A class should have one reason to change.
  aliases: [single responsibility principle, SRP]
  prerequisites: [cohesion-and-coupling]
  related: [solid-principles]
- slug: open-closed-principle
  name: Open-closed principle
  topic: backend
  description: Adding behaviour by extending code rather than editing what already works.
  aliases: [open-closed principle, open closed principle, OCP]
  prerequisites: [polymorphism, encapsulate-what-varies]
  related: [solid-principles]
- slug: liskov-substitution-principle
  name: Liskov substitution principle
  topic: backend
  description: Any subtype must work wherever its base type is expected, honouring its contract.
  aliases: [Liskov substitution principle, Liskov substitution, LSP]
  prerequisites: [inheritance, design-by-contract]
  related: [solid-principles]
- slug: interface-segregation-principle
  name: Interface segregation principle
  topic: backend
  description: Clients should not depend on operations they do not use.
  aliases: [interface segregation principle, interface segregation, ISP]
  prerequisites: [interfaces-and-abstract-classes]
  related: [solid-principles]
- slug: dependency-inversion-principle
  name: Dependency inversion principle
  topic: backend
  description: High-level policy and low-level detail both depend on abstractions.
  aliases: [dependency inversion principle, dependency inversion, DIP]
  prerequisites: [program-to-an-interface, dependency-relationship]
  related: [solid-principles]
- slug: dependency-injection
  name: Dependency injection
  topic: backend
  description: Handing an object its collaborators from outside instead of it creating them.
  aliases:
    [dependency injection, DI container, IoC container, inversion of control]
  prerequisites: [dependency-inversion-principle]
- slug: design-patterns
  name: Design patterns
  topic: backend
  description: Named, reusable solutions to recurring object-oriented design problems.
  aliases: [design patterns, design pattern, gang of four, GoF patterns]
  prerequisites: [interfaces-and-abstract-classes, object-composition]
- slug: singleton-pattern
  name: Singleton pattern
  topic: backend
  description: One shared instance of a class, created once and reached from anywhere.
  aliases: [singleton pattern, singleton]
  prerequisites: [design-patterns]
- slug: lazy-initialization
  name: Lazy initialization
  topic: backend
  description: Creating or loading something only when it is first needed.
  aliases: [lazy initialization, lazy loading, lazy init]
  prerequisites: [encapsulation]
  related: [singleton-pattern]
- slug: factory-method-pattern
  name: Factory method pattern
  topic: backend
  description: Creating objects through a method that decides which concrete class to build.
  aliases: [factory method, factory pattern, simple factory]
  prerequisites: [design-patterns, polymorphism]
- slug: abstract-factory-pattern
  name: Abstract factory pattern
  topic: backend
  description: Creating families of related objects that are meant to be used together.
  aliases: [abstract factory]
  prerequisites: [factory-method-pattern]
- slug: builder-pattern
  name: Builder pattern
  topic: backend
  description: Assembling a complex object step by step, validating it once at the end.
  aliases: [builder pattern, fluent builder]
  prerequisites: [design-patterns, immutability]
- slug: prototype-pattern
  name: Prototype pattern
  topic: backend
  description: Creating objects by copying a configured instance instead of building from scratch.
  aliases: [prototype pattern, deep copy, shallow copy]
  prerequisites: [design-patterns]
- slug: object-pool-pattern
  name: Object pool pattern
  topic: backend
  description: Reusing expensive objects from a pool instead of creating and destroying them.
  aliases: [object pool, object pooling]
  prerequisites: [design-patterns]
  related: [connection-pooling, thread-pools]
- slug: adapter-pattern
  name: Adapter pattern
  topic: backend
  description: Wrapping an interface so it fits the one callers expect.
  aliases: [adapter pattern, wrapper pattern]
  prerequisites: [design-patterns]
- slug: decorator-pattern
  name: Decorator pattern
  topic: backend
  description: Adding behaviour by wrapping an object in layers that share its interface.
  aliases: [decorator pattern]
  prerequisites: [design-patterns, composition-over-inheritance]
- slug: facade-pattern
  name: Facade pattern
  topic: backend
  description: One simple entry point in front of a complicated subsystem.
  aliases: [facade pattern, façade pattern]
  prerequisites: [design-patterns]
- slug: proxy-pattern
  name: Proxy pattern
  topic: backend
  description: A stand-in that controls access to an object, for laziness, caching or protection.
  aliases: [proxy pattern, protection proxy, virtual proxy, caching proxy]
  prerequisites: [design-patterns]
  related: [reverse-proxy]
- slug: composite-pattern
  name: Composite pattern
  topic: backend
  description: Treating a tree of objects and a single object through the same interface.
  aliases: [composite pattern]
  prerequisites: [design-patterns, object-composition]
- slug: bridge-pattern
  name: Bridge pattern
  topic: backend
  description: Separating an abstraction from its implementation so both vary independently.
  aliases: [bridge pattern]
  prerequisites: [design-patterns, composition-over-inheritance]
- slug: flyweight-pattern
  name: Flyweight pattern
  topic: backend
  description: Sharing immutable common state across many small objects to save memory.
  aliases: [flyweight pattern, flyweight, string interning]
  prerequisites: [design-patterns, immutability]
- slug: strategy-pattern
  name: Strategy pattern
  topic: backend
  description: Choosing an algorithm at runtime from interchangeable implementations.
  aliases: [strategy pattern, policy pattern]
  prerequisites: [design-patterns, encapsulate-what-varies]
- slug: observer-pattern
  name: Observer pattern
  topic: backend
  description: Subscribers are told when a subject changes, without the subject knowing who they are.
  aliases: [observer pattern, listener pattern, event listener]
  prerequisites: [design-patterns]
  related: [publish-subscribe]
- slug: command-pattern
  name: Command pattern
  topic: backend
  description: Turning a request into an object that can be queued, logged or undone.
  aliases: [command pattern, undo stack, undo and redo]
  prerequisites: [design-patterns]
  related: [event-sourcing]
- slug: finite-state-machines
  name: Finite state machines
  topic: backend
  description: A fixed set of states and the events that move between them.
  aliases: [finite state machine, state machine, FSM, state transition]
  prerequisites: [enumerations]
- slug: state-pattern
  name: State pattern
  topic: backend
  description: An object changes its behaviour when its state changes, one class per state.
  aliases: [state pattern]
  prerequisites: [design-patterns, finite-state-machines]
  related: [circuit-breakers]
- slug: template-method-pattern
  name: Template method pattern
  topic: backend
  description: A fixed algorithm skeleton whose individual steps subclasses fill in.
  aliases: [template method, template method pattern]
  prerequisites: [design-patterns, inheritance]
- slug: iterator-pattern
  name: Iterator pattern
  topic: backend
  description: Walking a collection's elements without exposing how it stores them.
  aliases: [iterator pattern, iterator, cursor iteration]
  prerequisites: [design-patterns]
  related: [pagination]
- slug: chain-of-responsibility-pattern
  name: Chain of responsibility pattern
  topic: backend
  description: Passing a request along a chain of handlers until one deals with it.
  aliases: [chain of responsibility, handler chain, middleware chain]
  prerequisites: [design-patterns]
- slug: mediator-pattern
  name: Mediator pattern
  topic: backend
  description: Objects coordinate through one mediator instead of referring to each other.
  aliases: [mediator pattern]
  prerequisites: [design-patterns]
  related: [observer-pattern]
- slug: memento-pattern
  name: Memento pattern
  topic: backend
  description: Capturing an object's state so it can be restored later without exposing internals.
  aliases: [memento pattern, snapshot and restore]
  prerequisites: [design-patterns, encapsulation]
- slug: visitor-pattern
  name: Visitor pattern
  topic: backend
  description: Adding operations over a fixed set of element kinds without changing those kinds.
  aliases: [visitor pattern, double dispatch]
  prerequisites: [design-patterns, polymorphism]
  related: [composite-pattern]
- slug: interpreter-pattern
  name: Interpreter pattern
  topic: backend
  description: Representing a small language's grammar as objects that evaluate themselves.
  aliases: [interpreter pattern, expression tree, abstract syntax tree]
  prerequisites: [composite-pattern]
- slug: null-object-pattern
  name: Null object pattern
  topic: backend
  description: A do-nothing implementation that replaces null checks.
  aliases: [null object, null object pattern, no-op implementation]
  prerequisites: [polymorphism]
```

## Generation plan

### Before any problem is generated

1. **The owner reviews this catalog:** titles, difficulty, concepts and which extensions to keep. Then the open questions below.
2. **The practice fields are in place**: `pool`, `topic` and `concepts` in `problem.json` and the `lld_problem` migration, from the practice feature being built now.
3. **The concepts are loaded**: the YAML above is pasted, the seed is bumped to version 4 and `load-concepts` is run, so every problem's `concepts` resolve.
4. **The engine binary is available**: verify and mutation scoring need Velox's CLI in `EXEC_BIN` (`run` and `check`).

### Batches for parallel agents

Problems live in their own directories, so batches don't conflict. No batch touches shared code: if a problem needs a format change, it stops and reports. Verify is CPU-heavy (six languages, three runs of every concurrency scenario, hundreds of mutant runs), so run **at most 4 batches at once**, for the same reason `pnpm check` runs with `--concurrency=4`.

| Batch | Group         | Problems                    | Size |
| ----- | ------------- | --------------------------- | ---- |
| A1    | oop-basics    | 1–8 (all easy)              | 8    |
| A2    | oop-basics    | 9–16 (1 easy, 7 medium)     | 8    |
| B     | relationships | 1–9                         | 9    |
| C1    | principles    | 1–7 (easy)                  | 7    |
| C2    | principles    | 8–13 (medium)               | 6    |
| D     | solid         | 1–10                        | 10   |
| E     | creational    | 1–12                        | 12   |
| F1    | structural    | 1–10                        | 10   |
| F2    | structural    | 11–19 (includes the 4 hard) | 9    |
| G1    | behavioural   | 1–8 (easy) and 9–10         | 10   |
| G2    | behavioural   | 11–19                       | 9    |
| G3    | behavioural   | 20–28 (includes the 6 hard) | 9    |

Start with one problem done end to end in each group's style (for example `feature-flag`, `deploy-gate`, `conn-pool`, `alert-tree` and `circuit-breaker`), reviewed before the rest of its batch, so a misunderstanding of the format isn't repeated across hundreds of files.

### What each problem needs to be accepted

- **Files**, in `problems/lld/<slug>/`:
  - `problem.json`: `pool: "practice"`, `topic`, `concepts` (slugs that exist), `difficulty` and `limits` (5 s, 128 MB, as the existing ones);
  - visible (2), hidden (8–15) and concurrency (1+) scenarios, and extension scenarios (3–6) when there's an extension;
  - `statement.md` with the PROVISIONAL line;
  - `extension.md` exactly when there's an extension;
  - `references/`: `solution.py`, `solution.js`, `solution.ts`, `<Class>.java`, `solution.hpp`, `solution.go`.
- **Six references, not five.** Verify runs every generator in `GENERATORS`, and TypeScript is one of them, so a problem with five references fails. Every existing problem ships six.
- **Verify passes:** `pnpm --filter @interval/lld verify problems/lld/<slug> --random 10 --mutation` with `EXEC_BIN` set.
  - every reference agrees with the Python one on every scenario and on 10 seeded random scenarios;
  - each concurrency scenario gives the same results on 3 runs per language;
  - the mutation score from `packages/lld/tools/mutants.py` (on the Python reference) is at least 90%. A survivor means a missing test, not a reason to lower the gate.
- **`expected.json` is written by verify** (Python's results) and never by hand. `verify --check` then reports it current.
- **`pnpm --filter @interval/lld test` passes** (`problems.test.ts`: parses, slug matches, references exist, statement says PROVISIONAL, `expected.json` current, the practice pool stays apart).
- **A reviewer pass** in a fresh context reads `statement.md` against the Python reference and lists every behaviour the tests judge that the statement doesn't state. W30's reviewer found four such gaps in three problems.
- **No reserved names, no battle look-alikes,** and the result formats (strings, orderings, rounding) are stated exactly in the statement.

### Honest size estimate

Measured from the 12 existing problems:

| Per problem                     | Existing: range (mean)      | Estimate for practice             |
| ------------------------------- | --------------------------- | --------------------------------- |
| Files                           | 9–10 (10 with an extension) | 9–10                              |
| `statement.md` + `extension.md` | 28–50 lines (38)            | 25–45 lines                       |
| References, all six             | 344–909 lines (560)         | easy ~350, medium ~500, hard ~750 |
| `problem.json`                  | 36–489 KB (122; median ~90) | 30–120 KB                         |
| `expected.json`                 | 9.5–270 KB (43; median ~20) | 10–40 KB                          |

For 107 problems (41 easy, 51 medium, 15 hard):

- **~1,050 files.**
- **~50,000 lines of hand-written reference code**: 41×350 + 51×500 + 15×750 ≈ 51,600 lines. Go and Java are the longest, about 1.5–2× the Python one.
- **~4,000 lines of statements.**
- **~7–10 MB of scenario JSON and ~2–4 MB of expected results.** The repository grows by roughly 10–14 MB.
- **Time.** W30 built three problems per session with every gate. At that pace, the catalog is about 35 sessions of work, or about 9 rounds of 4 parallel batches, plus review. Mutation scoring is the slow step: hundreds of mutant runs per problem.
- **CI.** `problems.integration.test.ts` verifies every problem (10-minute timeout each, in the non-required redteam job, currently 45 minutes for 12 problems). At 119 problems that job won't fit. It needs sharding or to verify only changed problems (open question 4).

## Open questions for the owner

1. **Refactoring katas.** Should the problem format gain a `starter` field (per-language starting code), so principles and SOLID problems can start from tangled code as their seed ideas do? Without it, they are "build to spec, then take the change request" (technique 1). Adding it is a format change with its own ADR.
2. **Concurrency layer for practice.** Keep the rule that every problem has one, or let practice problems leave it out where threads teach nothing about the pattern (most of creational, structural and behavioural)? Keeping it adds locking to six references per problem, and maybe 15–20% to the size above.
3. **A software-design topic.** Should these 58 concepts get their own topic (for example `software-design`) instead of `backend`? That touches C-32's four launch topics, onboarding topic choice and the feeds, so it's the owner's call. As drafted, they load under `backend`.
4. **CI for 119 problems.** Shard the redteam job, or verify only changed problems in CI and all of them nightly?
5. **Design quality.** Tests judge behaviour, not whether the pattern was used. Should the practice page say so, and point to the references after a session? (An AI code coach is out of scope until it has a budget and an eval, per Q-WD-28.)
6. **Five or six languages.** Owner decisions say five reference languages, but verify requires TypeScript too, and every existing problem has six. This plan assumes six.
