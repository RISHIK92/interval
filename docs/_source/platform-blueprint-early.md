### **How games connect to the rest of the product**

The most important design choice is to tie games to the learning side rather than run them as a separate trivia app. Every question attaches to a concept in the concept graph. When you miss a question about replication lag, the feed surfaces an article on it. When you read about consistent hashing, the questions you see afterward test it. This also covers the “did they actually learn” gap from my last message: game performance becomes the measurement of retention.

### **Quick games (Matiks-style)**

The formats you described work well:

- **Fastest finger first:** the first correct answer wins each round.
- **60-second sprint:** the most correct answers wins.
- **Solo:** solve as many as possible in x seconds.

For system design, I’d go beyond plain multiple choice with a few question types:

- **Back-of-envelope estimation:** “1B daily active users, 5 writes each, how much write QPS?” The answer is a number, scored within a tolerance range. This is the closest engineering equivalent to Matiks’s mental math.
- **Pick the component:** given a scenario, choose a cache, queue, CDN, or sharded database.
- **Spot the bottleneck:** a tiny diagram where you tap the weak point.
- **Latency ordering:** rank operations like an L1 cache hit, an SSD read, or a cross-region round trip.
- **Trade-off calls:** questions on CAP/PACELC choices and consistency models in context.

A few supporting systems:

- **Ratings and matchmaking:** keep a rating per mode (Elo or Glicko) and match players by rating. Bots fill matches when no live opponent is available, which is essential early on.
- **Fairness:** both players get the same questions, and the server controls all timing.
- **Leaderboards:** global, country, and university, plus friends. Students can verify their university through their college email domain. Seasonal resets keep things fresh.
- **Question bank:** AI-generated, human-reviewed, and tagged by concept. Real response data then calibrates each question’s difficulty automatically.

### **The main game: HLD**

I’d push back on “first completer wins” for HLD. A high-level design has no single correct answer, so racing rewards shallow designs. And pure AI evaluation is shaky for *ranked* play for three reasons:

- **Inconsistency:** the same design can get different scores on different runs, and players will contest losses.
- **Manipulation:** players can hide instructions in their answers to sway the AI judge.
- **Cost:** every submission needs a model call.

**My suggestion: a simulation-based design canvas.** Players build their design from a set of components (load balancers, app servers, caches, databases with replicas or shards, queues, CDNs) and configure them, for example with a sharding key, a cache policy, or a replication mode. The problem statement defines requirements: “50k read QPS, 2k writes, p99 under 200ms, survive one availability-zone failure.”

The engine then runs the design against those requirements:

- It sends traffic through the design and checks each component’s capacity against the load.
- It checks whether the design meets the latency budget.
- It injects failures, such as killing a primary database or a whole zone.

The result is deterministic, fair, and fun, almost like a puzzle game. It also makes “first completer wins” meaningful again: **the first design to pass every scenario wins.**

AI still has a role, but as a coach rather than a judge. After a match, it reviews your written trade-off notes against a fixed rubric and explains what a stronger design would do. Use it in practice mode, not for ranking.

### **The main game: LLD**

Test-case evaluation works well here, with two additions:

- **Fixed interfaces:** each problem must specify exact class and method signatures, or hidden tests can’t run against players’ code. Code runs in a multi-language sandbox.
- **Extension rounds:** tests only check behavior, not design quality. So halfway through, the requirements change (“now add EV charging spots to the parking lot”) and new tests unlock. Players with extensible designs adapt fast, and messy code breaks. This rewards good design without subjective grading.

Concurrency tests, such as thread-safe rate limiters and LRU caches under parallel access, can push difficulty further. Scoring is tests passed, with time as the tiebreaker.

### **Two tensions to resolve**

**Session length:** HLD and LLD battles take 20 to 45 minutes. That’s fine, but they’re a scheduled mode (evenings, weekend tournaments) rather than the quick-break experience. They’re also hard to play on a phone.

**AI cheating:** your users have AI coding tools open all day. Time pressure protects quick games. LLD in particular is easy to solve by pasting the problem into an AI tool, so you need a clear policy.

A few decisions would help me shape this further:

How should HLD designs be evaluated in ranked multiplayer?Hybrid scoring

What's the stance on AI assistants during competitive games?Separate AI-allowed league

Which platforms should the main system design battles target?Desktop-first

How central should games be in the final product?Secondary layer

Here’s how the game layer looks with your choices locked in.

### **Where games live**

Since games are a secondary layer, the feed stays the home screen, and games show up in three places:

- **Inside the feed:** a daily challenge card, and a “test yourself (60s)” prompt after you finish an article or book section.
- **Inside learning paths:** a short quiz at the end of a path section confirms it’s mastered, and moves the path forward.
- **A Play area:** for people who want multiplayer, leaderboards, and battles on purpose.

The loop runs in both directions. Questions come from concepts you’ve read, and concepts you miss send you back to reading.

**Navigation change:** adding Play as a seventh tab is too many. I’d turn Listen into a global mini-player that floats across the app (like Spotify’s), with the audio queue living in the Library. That frees a slot, giving: **Home, Explore, Paths, Play, Library, Profile.**

### **Platforms**

Desktop is where HLD and LLD battles, tournaments, and the design canvas live. Mobile gets the quick games (sprints, fastest finger, estimation), daily challenges, leaderboards, battle replays and results, and spectating. The desktop companion from the agent-waiting idea gets quick games too, so a 60-second round is one click away while your agent runs.

### **HLD scoring**

The simulation acts as the gate, and AI only adds points on top of a working design. A starting split, out of 100:


|                   |            |                                                   |
| ----------------- | ---------- | ------------------------------------------------- |
| **Component**     | **Weight** | **How it’s scored**                               |
| Simulation        | 60         | Load scenarios, latency budget, failure injection |
| Trade-off quality | 25         | AI against a fixed rubric                         |
| Speed             | 15         | Time to pass all scenarios                        |


A design that fails the baseline load scenario gets no AI points at all, so you can’t write your way past a broken design.

To keep AI scoring fair enough for ranked play:

- **Structured answers:** the AI scores short, specific justifications attached to each decision (“Why this sharding key?” “Why async here?”), not free-form essays. This makes scoring more consistent and harder to game.
- **Answers as data:** the judge treats submissions strictly as content to evaluate, with length limits and stripping of anything that looks like instructions.
- **Repeat judging:** each submission is scored several times and the median counts.
- **Transparency:** results show the score for each rubric item with a one-line reason, so players can see why they lost.

### **Two leagues**

**Human league:** ranked play without AI help. Detection uses signals like paste events, focus changes, typing patterns, and sudden rating jumps. Flags go to review rather than automatic bans, and penalties hit rating rather than accounts. Be honest with users that detection is imperfect, since someone can always use a second device. Extension rounds and time pressure do more to protect fairness than detection does.

**AI league:** using AI is the skill being tested, meaning judgment, verification, and orchestration rather than recall. To make that work:

- **Harder problems:** bigger scope, vague requirements that need clarifying, and more aggressive extension rounds and failure injection, because raw AI output tends to break there.
- **Equal access:** an in-app assistant with a fixed budget per match, so everyone has the same tool and nobody wins by paying for a better model.
- **Separate ratings and leaderboards.**

This league fits your audience unusually well. Developers who live inside coding agents could practice exactly the skill their job now demands, and no competitor offers that.

  
