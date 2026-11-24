# HLD problem catalog (PROPOSED, for the owner's review)

> **Every family here is PROVISIONAL.** Claude drafted this plan on 2026-11-23 from the owner's answers of that day. Nothing below is written as a family yet except the 8 that already exist in `packages/hld/src/families.ts`. The owner reviews titles, pools, difficulty, numbers, scenarios and rubrics before any family is written, and each written family stays PROVISIONAL until reviewed, as the first 8 are (Q-P6-04).

## How it was planned

- **Owner's answers (2026-11-23):**
  - grow HLD to about 30 problem families, grouped by theme;
  - a separate HLD practice pool, mirroring ADR-0048 for LLD: some families are practice-only, the rest battle-only; cups stay tournament-only;
  - extend the engine where the classics need it (geo index, persistent connections and fan-out, media pipelines, consensus and leader election, and others Claude finds);
  - Claude drafts all content; the owner reviews it.
- **The engine work** is proposed in [ADR-0050](adr/0050-hld-engine-extensions.md): 4 new components and 6 engine behaviours, released as spec sheet v2 at a season boundary (CANVAS-4).
- **HLDQ-2 says "6 to 8 problem families".** About 30 changes that decision, so ADR-0050 records it as an amendment for the owner (docs/decisions.md is never edited).
- **Original problems.** Every family is framed in its own words. None repeats a cup (`cup-concert-tickets`, `cup-live-scores`, `cup-ride-dispatch`): cups stay hand-written, tournament-only and retired after use (HLDQ-3). Where a classic is close to a cup, the family takes a different angle. For example, food-delivery tracking matches couriers and streams their position to one customer, while the ride-dispatch cup assigns one ride to one driver.
- **What fits the format.** Every family must fit `Family` in `packages/hld/src/family.ts`:
  - 1 to 8 request types;
  - a reference design the sizer can grow to pass every scenario;
  - a flawed-design catalog in which each flaw fails exactly its target scenario (HLDQ-3).

  Each request type's writes stay under a relational primary's 2,000 a second at three times baseline when the shape uses one. Where a family's lesson can't be shown by the simulator, its rubric carries the lesson, as news feed's does today.

## Notation

- **Components** (catalog v1, Q-P6-01): `cdn`, `lb` (load balancer), `app` (app service), `cache`, `sql` (relational database), `kv` (key-value store), `queue`, `worker`, `obj` (object storage), `search` (search index), `stream`.
- **New components** (ADR-0050), marked **NEW**: `geo` (geo index), `gateway` (connection gateway), `coord` (coordination service), `provider` (external provider).
- **New engine behaviours** (ADR-0050), marked in brackets:
  - **[lag]:** backlog and completion targets for asynchronous work;
  - **[work]:** work units per job;
  - **[fanout]:** one request becoming many deliveries;
  - **[hot]:** a hot partition;
  - **[batch]:** worker batching;
  - **[bytes]:** payload bandwidth and egress cost.
- **Traffic:** total requests a second at baseline in the human battle mode, then each request type's share: R or W (read or write), with "c" when a cache or CDN may answer it. The AI battle mode draws more traffic, a tighter p99 and less budget headroom, and adds the region scenario (Q-P6-04).
- **Budget band:** the human mode's monthly budget, which is 1.5 times the sized reference design's cost (`variant()`):
  - **S** under $8k;
  - **M** $8k to $20k;
  - **L** $20k to $40k.

  The AI mode runs about 1.5 to 2 times higher. Bands for new families are Claude's estimates; the sizer sets the real numbers.

- **Scenarios:** every variant runs the shared four:
  - `baseline`;
  - `peak` (3× traffic);
  - `zone` (a zone is lost);
  - `region` (AI mode only).

  The three listed per family are what that family adds or stresses. A family-specific scenario needs ADR-0050's per-family scenarios.

- **Coverage:** the Q-WD-15 rules in `problem.ts`. `request(t → kinds)` is covered once request type `t` is served through one of those kinds; `fast` holds it to the p99 target, or to the completion target for asynchronous work ([lag]). `scenario(id)` is covered once that scenario's targets are met. Every family also gets the generated baseline, storage and budget requirements.
- **Lesson:** what a naive design misses. **Flaw:** the lesson as a flawed design, and the scenario it must fail. "Rubric" means the simulator can't show it, so a rubric criterion carries it.

## Pools

ADR-0050 gives each family a required `pool`, either `practice` or `battle`.

- Practice never shows a battle family. A practice family never moves back to battles, because players have seen its shape and lesson with no clock.
- Cups are neither: they stay in `CUPS`, tournament-only.
- **Existing families that move to practice:** url-shortener, photo-sharing, news-feed and search-autocomplete. They are the gentlest introductions to caching, blobs and a CDN, fan-out, and search.
- **Existing families that stay in battles:** chat, checkout, metrics-ingestion and rate-limiter.
- Today `/hld/practice` lists all 8 families, each from a reserved practice seed. After the split it lists practice families only. When that switch happens is an open question (below).

### Counts

| Theme                                 | Practice (e/m/h) | Battle (e/m/h) | Families |
| ------------------------------------- | ---------------- | -------------- | -------- |
| Storage & files                       | 2 (1/1/0)        | 2 (0/1/1)      | 4        |
| Feeds & social                        | 1 (0/1/0)        | 2 (1/1/0)      | 3        |
| Messaging & notifications             | 2 (1/1/0)        | 2 (0/1/1)      | 4        |
| Search                                | 1 (0/1/0)        | 2 (0/1/1)      | 3        |
| Commerce & payments                   | 2 (0/1/1)        | 2 (0/1/1)      | 4        |
| Real-time & location                  | 2 (1/0/1)        | 2 (0/0/2)      | 4        |
| Data pipelines & analytics            | 1 (0/0/1)        | 2 (0/1/1)      | 3        |
| Infrastructure building blocks        | 3 (1/2/0)        | 3 (1/1/1)      | 6        |
| **Total**                             | **14 (4/7/3)**   | **17 (2/7/8)** | **31**   |
| of which existing (`families.ts`)     | 4                | 4              | 8        |
| of which needing a NEW component      | 5                | 7              | 12       |
| of which needing a new behaviour only | 3                | 4              | 7        |
| of which buildable on the v1 engine   | 6                | 6              | 12       |

The battle pool leans harder: it has 8 hard families, while practice has 4 easy ones and 3 hard ones, so practice still reaches every new component and behaviour before a player meets it in a battle. Every theme has at least one family in each pool. Each new component appears in both pools:

| New component or behaviour | Practice                                                  | Battle                                                                                                      |
| -------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `geo` NEW                  | nearby-places                                             | food-delivery-tracking                                                                                      |
| `gateway` NEW              | presence                                                  | collaborative-editor, food-delivery-tracking, feature-flags                                                 |
| `coord` NEW                | id-generator                                              | job-scheduler                                                                                               |
| `provider` NEW             | otp-login, webhook-delivery                               | notification-service, payment-processing, web-crawler                                                       |
| [lag]                      | otp-login, image-resizer, webhook-delivery, feature-store | video-on-demand, notification-service, payment-processing, web-crawler, ad-click-aggregation, job-scheduler |
| [work]                     | image-resizer, feature-store                              | video-on-demand, web-crawler, job-scheduler                                                                 |
| [fanout]                   | presence                                                  | notification-service, collaborative-editor, feature-flags                                                   |
| [hot]                      | wallet-ledger                                             | like-counters, collaborative-editor, ad-click-aggregation                                                   |
| [batch]                    | feature-store                                             | like-counters, ad-click-aggregation                                                                         |
| [bytes]                    | image-resizer                                             | video-on-demand, file-sync                                                                                  |

The four battle families that exist today could adopt v2 behaviours at a later balance patch (for example, [batch] in metrics-ingestion, whose rubric already asks about batching). They are not changed by this plan.

## The catalog

### Storage & files

#### `photo-sharing`: Photo sharing (existing)

- **Pool:** practice (moves from battle). **Difficulty:** easy-medium, listed as medium.
- **Traffic:** 5k–18k rps: view 90% Rc, details 8% R, upload 2% W. Working set 50–200 GB; 200–1,500 GB stored, +5–25 GB/day, 180 days.
- **Storage:** blobs in `obj`, metadata in `sql`. **Budget:** S (today $3.1k–4.6k).
- **Scenarios:** baseline; peak (3× views, which the CDN must absorb); zone.
- **Lesson:** bytes don't belong in the database, and a CDN carries views. Flaw: none today; rubric.
- **Coverage:** `request(upload → obj)`, `request(view → cdn, obj)`, `request(details → cache, sql, kv)`.
- **Rubric:** blobs apart from metadata, and why; what the CDN caches and for how long.
- **Components:** cdn, lb, app, cache, sql, kv, obj, queue, worker. No new ones.

#### `image-resizer`: Image resizing service

- **Pool:** practice. **Difficulty:** easy.
- **Traffic:** 3k–8k rps: image 95% Rc (a size of an image, such as `?w=320`), original 5% W (an upload). Working set 20–80 GB; 500–2,000 GB stored, +10–30 GB/day, 180 days. Each resize is 20 work units [work], and uploads are 2 MB [bytes].
- **Storage:** originals and renditions in `obj`. **Budget:** S.
- **Scenarios:**
  - baseline;
  - "a new app release asks for a size nobody has cached": peak with cold renditions (a 3× miss spike);
  - "uploads arrive in a burst" (15 min at 4× uploads; renditions done within 5 min [lag]).
- **Lesson:** resize once and cache the result (a CDN in front of rendition storage). A naive design resizes on every request. Flaw: no CDN, so peak fails on worker overload.
- **Coverage:** `request(image → cdn, obj, fast)`, `request(original → obj)`, `scenario(peak)`.
- **Rubric:**
  - on-the-fly against precomputed renditions, and which sizes are allowed;
  - how a re-uploaded original invalidates its renditions.
- **Components:** cdn, lb, app, worker, queue, obj, cache. Behaviours: [work], [bytes], [lag].

#### `file-sync`: File sync across devices

- **Pool:** battle. **Difficulty:** medium.
- **Traffic:** 4k–10k rps:
  - changes 70% R (a device asks what changed since its cursor);
  - download 15% Rc;
  - upload_chunk 10% W (4 MB [bytes]);
  - commit 5% W (a file's new version, metadata).

  Working set 20–60 GB of metadata; 2,000–8,000 GB stored, +40–100 GB/day, 365 days.

- **Storage:** chunks in `obj` (content-addressed), versions and cursors in `sql`. **Budget:** M.
- **Scenarios:** baseline; "Monday morning: every laptop wakes up" (peak on changes); zone.
- **Lesson:**
  - Upload chunks straight to object storage (a direct client→`obj` edge, standing for signed URLs), not through the app service, whose bandwidth then saturates.
  - Deduplicate by content hash.

  Flaw: uploads routed through `app`, so peak fails on app bandwidth.

- **Coverage:** `request(upload_chunk → obj)`, `request(commit → sql)`, `request(changes → cache, sql, fast)`.
- **Rubric:**
  - chunking and content-hash deduplication, and what a one-byte edit uploads;
  - how two devices editing the same file are reconciled (conflict copies or versions).
- **Components:** lb, app, cache, sql, obj, cdn, queue, worker. Behaviours: [bytes].

#### `video-on-demand`: Video streaming service

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:** 5k–12k rps:
  - segment 96% Rc (a few seconds of video, 1.5 MB [bytes]);
  - manifest 3% Rc;
  - upload 1% W.

  Each upload is transcoded into 5 renditions at 600 work units each [work], ready within 30 min [lag]. 5,000–20,000 GB stored, +200–500 GB/day, 365 days.

- **Storage:** `obj` for sources and renditions, `sql` for catalog metadata. **Budget:** L (egress dominates).
- **Scenarios:**
  - baseline;
  - "a premiere": peak at 3× on a few titles (high skew);
  - "the transcoding queue backs up" (2 h of 3× uploads, still ready within the target).
- **Lesson:**
  - Segments must come from a CDN: origin egress costs about 4 times CDN egress, so serving from `obj` breaks the budget.
  - Transcoding is asynchronous and parallel per rendition.

  Flaw: no CDN, so the budget is missed (cost is scored in every scenario, so the flaw is checked against baseline). The lag flaw: workers sized for the average, so the backup scenario misses its completion target.

- **Coverage:** `request(segment → cdn, fast)`, `request(upload → obj)`, `request(upload → worker, fast)` (ready within the target), `scenario(backlog)`.
- **Rubric:**
  - adaptive bitrate: why several renditions, and how a player picks one;
  - what a long transcode does when a worker dies halfway (chunked jobs, retries);
  - why a CDN, and what it costs against the origin.
- **Components:** cdn, lb, app, obj, sql, cache, queue, worker. Behaviours: [work], [lag], [bytes].

### Feeds & social

#### `news-feed`: News feed (existing)

- **Pool:** practice (moves from battle). **Difficulty:** medium.
- **Traffic:** 3k–12k rps: feed 90% R, post 10% W. Working set 20–100 GB; 50–300 GB stored, +1–5 GB/day, 365 days.
- **Storage:** precomputed timelines in `kv`. **Budget:** S–M (today $6k–12.8k).
- **Scenarios:** baseline; peak; zone.
- **Lesson:** fan-out on write through a queue, so posting stays fast. Today: rubric only. With [fanout] it can become a flaw (a synchronous fan-out fails peak on p99) at a later balance patch.
- **Coverage:** `request(post → sql, kv)`, `request(feed → cache, sql, kv)`.
- **Rubric:** fan-out on write against fan-out on read, and accounts with millions of followers; why posting is asynchronous.
- **Components:** lb, app, cache, sql, kv, queue, worker. No new ones.

#### `qa-forum`: Questions and answers forum

- **Pool:** battle. **Difficulty:** easy.
- **Traffic:** 4k–10k rps:
  - question_page 85% Rc (mostly anonymous readers from search engines);
  - vote 8% W;
  - answer 5% W;
  - ask 2% W.

  Working set 10–50 GB; 100–500 GB stored, +1–3 GB/day, 365 days.

- **Storage:** `sql` (questions, answers and votes in one place). **Budget:** S.
- **Scenarios:** baseline; "a question goes viral on a news site" (peak with high skew); zone.
- **Lesson:** anonymous pages are cacheable at the edge for a short TTL; signed-in writes go to the primary. Flaw: no CDN or cache, so peak fails on replica overload.
- **Coverage:** `request(question_page → cdn, cache, sql, fast)`, `request(answer → sql)`, `request(vote → sql)`.
- **Rubric:** how a new answer shows up despite caching (TTL against purge); how vote counts avoid a row-lock hotspot.
- **Components:** cdn, lb, app, cache, sql, search. No new ones.

#### `like-counters`: Likes and view counts

- **Pool:** battle. **Difficulty:** medium.
- **Traffic:** 8k–20k rps: like 30% W, view 50% W (each one counted), count 20% Rc. A viral post takes 5–20% of all writes [hot]. 10–50 GB stored, +1–4 GB/day, 365 days.
- **Storage:** `kv` counters, with events in a `stream`. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "one post goes viral" (peak with the hot share at its top);
  - zone.
- **Lesson:** a counter per post is a hot partition. Aggregate in a stream and batch the increments [batch], and accept counts a few seconds behind. Flaw: views written straight to `kv`, so the viral scenario fails on the hot node.
- **Coverage:** `request(view → stream, kv)`, `request(like → kv)`, `request(count → cache, kv, fast)`, `scenario(peak)`.
- **Rubric:**
  - exact likes (one per user, undoable) against approximate views, and why they differ;
  - how far behind a count may be, and how batching sets it.
- **Components:** lb, app, cache, kv, stream, worker, queue. Behaviours: [hot], [batch].

### Messaging & notifications

#### `chat`: Chat (existing)

- **Pool:** battle (stays). **Difficulty:** medium.
- **Traffic:** 3k–10k rps: history 70% R, send 30% W. Working set 20–80 GB; 100–500 GB stored, +2–8 GB/day, 365 days.
- **Storage:** `kv` history through a `stream`. **Budget:** M (today $10.8k–19k).
- **Scenarios:** baseline; peak; zone.
- **Lesson:** per-conversation ordering through a partitioned stream. Flaw: none beyond the shared ones; rubric.
- **Coverage:** `request(send → stream, queue, sql, kv)`, `request(send → sql, kv)`, `request(history → cache, sql, kv)`.
- **Rubric:** ordering within a conversation; offline delivery.
- **Components:** lb, app, cache, kv, stream, queue, worker. No new ones. (A later balance patch could add `gateway` for live delivery. Not in this plan.)

#### `otp-login`: One-time code sign-in

- **Pool:** practice. **Difficulty:** easy.
- **Traffic:** 500–2,000 rps: request_code 40% W, verify 60% W. The SMS provider allows 300–800 sends a second (problem-set [provider]). 1–5 GB stored, 30 days.
- **Storage:** `kv` codes with an expiry. **Budget:** S.
- **Scenarios:**
  - baseline;
  - "the SMS provider is down for 10 minutes" (codes still delivered within 15 min [lag]);
  - "a bot floods sign-ups" (peak, mostly request_code).
- **Lesson:**
  - Never call the provider inside the request. Queue the send, so a slow or down provider doesn't fail sign-in.
  - Cap sends per number.

  Flaw: the app calls `provider` directly, so the outage scenario fails.

- **Coverage:** `request(request_code → queue, kv)`, `request(verify → kv, fast)`, `scenario(provider_down)`.
- **Rubric:** expiry, attempts and rate limits per phone number and why; what the user sees while delivery is delayed.
- **Components:** lb, app, kv, cache, queue, worker, provider **NEW**. Behaviours: [lag].

#### `webhook-delivery`: Webhook delivery

- **Pool:** practice. **Difficulty:** medium.
- **Traffic:** 2k–6k rps:
  - event 80% W (our system emits an event to send to customers' URLs);
  - status 20% R (customers read delivery logs).

  Customers' endpoints are a `provider` at 300 ms and 99% available, with a 5% slow tail. Delivered within 5 min [lag]. 200–800 GB stored, +5–15 GB/day, 30 days.

- **Storage:** delivery log in `kv`, retries in a `queue`. **Budget:** S–M.
- **Scenarios:**
  - baseline;
  - "a big customer's endpoint is down for 30 minutes" (a provider outage; the backlog must fit retention and drain);
  - peak.
- **Lesson:**
  - Retries with backoff from a durable queue.
  - One slow customer must not delay everyone: per-customer partitions in the rubric, retention in the simulator.

  Flaw: a queue with 1-hour retention, so the 30-minute outage plus the drain overflows it and events are lost.

- **Coverage:** `request(event → queue, stream)`, `request(event → worker, fast)` (delivered within the target), `request(status → kv, sql)`, `scenario(provider_down)`.
- **Rubric:** retries, backoff and when to give up (a dead-letter queue); signing payloads and the at-least-once delivery customers must handle.
- **Components:** lb, app, kv, sql, queue, stream, worker, provider **NEW**. Behaviours: [lag].

#### `notification-service`: Notification service

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:** 2k–6k rps:
  - notify 60% W (one event to one user's devices);
  - campaign 0.1% W (one campaign to a segment, 10k mean and 1M p99 recipients [fanout]);
  - preferences 40% R/W mixed, as two types.

  Push, email and SMS are `provider`s rate-limited per problem. Delivered within 1 min, campaigns within 30 min [lag]. 100–500 GB stored, 90 days.

- **Storage:** `kv` preferences and device tokens, delivery log in `kv`. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "a campaign to every user lands at peak" (fan-out plus peak);
  - "the push provider throttles to half" (a provider at half capacity for 20 min).
- **Lesson:**
  - Campaigns fan out asynchronously in batches, at the provider's rate.
  - Transactional notifications get their own queue, so a campaign never delays a password reset.

  Flaw: one shared queue, so transactional notifications miss their target behind the campaign.

- **Coverage:** `request(notify → worker, fast)`, `request(campaign → queue, stream)`, `request(preferences_read → cache, kv)`, `scenario(campaign_peak)`.
- **Rubric:**
  - priority isolation between transactional and bulk notifications;
  - deduplication and user preferences (quiet hours, opt-outs) checked before sending.
- **Components:** lb, app, cache, kv, queue, stream, worker, provider **NEW**. Behaviours: [fanout], [lag].
- **Open (engine):** the isolation flaw needs two queues with priorities. ADR-0050 models them as separate queues and consumers, which the engine already does. The shared-queue flaw needs [lag] to apply a queue's backlog to every type that crosses it.

### Search

#### `search-autocomplete`: Search and autocomplete (existing)

- **Pool:** practice (moves from battle). **Difficulty:** medium.
- **Traffic:** 1k–3k rps: suggest 60% Rc, search 35% R, index 5% W. 50–300 GB stored, +0.5–3 GB/day, 365 days.
- **Storage:** `sql` documents, `search` index. **Budget:** S–M (today $6.5k–11k).
- **Scenarios:** baseline; peak; zone.
- **Lesson:** cache popular prefixes in front of the index. Flaw: no cache, so peak fails.
- **Coverage:** `request(suggest → cache, search)`, `request(search → search)`, `request(index → search)`.
- **Rubric:** sharding, replication and query cost; index freshness.
- **Components:** lb, app, cache, sql, search, queue, worker. No new ones.

#### `product-search`: Marketplace product search

- **Pool:** battle. **Difficulty:** medium.
- **Traffic:** 3k–8k rps:
  - search 70% R (text plus filters and facets);
  - product_page 25% Rc;
  - stock_change 5% W (price and stock from sellers, visible in search within 1 min).

  200–1,000 GB stored, +2–6 GB/day, 365 days.

- **Storage:** `sql` catalog of record, `search` index fed by a `stream`. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "a sale starts: everyone searches at once" (peak);
  - "a search node fails" (a node failure on `search`).
- **Lesson:** index replicas carry query load and survive a node, while shards size the data. A naive design adds shards for load, and every query pays for every shard. Flaw: replicas at 0, so the node scenario fails.
- **Coverage:** `request(search → search, fast)`, `request(product_page → cdn, cache, sql)`, `request(stock_change → stream, queue)`, `scenario(node)`.
- **Rubric:** shards against replicas and what each buys; how stock changes reach the index and why search may be briefly stale.
- **Components:** cdn, lb, app, cache, sql, search, stream, queue, worker. No new ones. (It needs per-family scenarios for the node scenario.)

#### `web-crawler`: Web crawler

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:** a crawl rather than users:
  - fetch 70% W (one page: the open web is a `provider` at 500 ms and 97% available);
  - parse 20% W at 10 work units [work];
  - seen_check 10% R (deduplicating URLs).

  1–3k pages a second; 2,000–10,000 GB stored, +300–800 GB/day, 90 days.

- **Storage:** pages in `obj`, URL frontier in a `queue`, seen-set in `kv`. **Budget:** M–L.
- **Scenarios:**
  - baseline;
  - "a big site slows to 2 seconds a page" (provider latency ×4: fetch concurrency, not threads, must absorb it);
  - zone.
- **Lesson:**
  - Fetching is I/O-bound: many fetches in flight per worker.
  - Politeness per host belongs in the frontier.
  - Dedup before fetching.

  Flaw: no `kv` seen-set, so the problem's 30% duplicate URLs double the fetch load and fail baseline cost. Whether this shows in the simulator depends on ADR-0050's open question on duplicate shares; otherwise it is rubric only.

- **Coverage:** `request(fetch → obj)`, `request(seen_check → kv, cache)`, `request(parse → worker, fast)`.
- **Rubric:**
  - politeness: per-host rate limits and robots rules;
  - how the frontier prioritises and avoids crawler traps.
- **Components:** queue, worker, kv, cache, obj, stream, provider **NEW**. Behaviours: [work], [lag].

### Commerce & payments

#### `checkout`: Checkout (existing)

- **Pool:** battle (stays). **Difficulty:** medium.
- **Traffic:** 5k–9k rps: browse 91% Rc, status 7% R, order 2% W. 50–300 GB stored, +0.5–3 GB/day, 365 days.
- **Storage:** `sql` orders. **Budget:** M (today $7.8k–9.7k).
- **Scenarios:** baseline; peak; zone.
- **Lesson:** a catalog cache; orders exactly once. Flaw: no catalog cache, so peak fails.
- **Coverage:** `request(browse → cdn, cache, sql, kv)`, `request(order → sql)`, `request(status → cache, sql, kv)`.
- **Rubric:** exactly-once charging; fulfilment and what the buyer sees.
- **Components:** cdn, lb, app, cache, sql, queue, worker. No new ones.

#### `hotel-booking`: Hotel room booking

- **Pool:** practice. **Difficulty:** medium.
- **Traffic:** 3k–8k rps:
  - availability 90% Rc (rooms for a city and dates; seconds-stale is fine);
  - book 3% W (never double-books a room-night);
  - partner_update 7% W (hotels change prices and stock).

  50–300 GB stored, +0.5–2 GB/day, 365 days.

- **Storage:** `sql` inventory and bookings, `search` for city and date search. **Budget:** S–M.
- **Scenarios:** baseline; "a holiday weekend opens" (peak); zone.
- **Lesson:** search runs against a cached, slightly stale copy; booking re-checks against the primary in a transaction. A naive design searches the primary. Flaw: no cache, so peak fails on the primary's replicas.
- **Coverage:** `request(availability → cache, search, fast)`, `request(book → sql)`, `request(partner_update → sql, queue)`.
- **Rubric:**
  - how a room-night is never sold twice (a conditional update or a row lock);
  - what the guest sees when the cached availability was wrong.
- **Components:** lb, app, cache, sql, search, queue, worker, cdn. No new ones.

#### `wallet-ledger`: Digital wallet and ledger

- **Pool:** practice. **Difficulty:** hard.
- **Traffic:** 2k–5k rps:
  - transfer 30% W (two entries, both or neither);
  - balance 60% R;
  - statement 10% R.

  A large merchant receives 5–15% of all transfers [hot]. 200–800 GB stored, +2–6 GB/day, 365 days (never deleted).

- **Storage:** `sql` double-entry ledger. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "payday: a merchant's sale" (peak with the hot account at its top);
  - zone, whose failover must lose no write.
- **Lesson:**
  - A hot account's balance row serialises every transfer into it. Split the merchant's account into sub-accounts, or batch its credits through a queue, while debits stay synchronous.
  - Never a cache in front of balances that are being spent.

  Flaw: all transfers synchronous on one primary, so the payday peak fails on the primary's write capacity.

- **Coverage:** `request(transfer → sql)`, `request(balance → sql, fast)`, `request(statement → sql, kv)`, `scenario(peak)`.
- **Rubric:**
  - double-entry and why balances are derived, never edited;
  - idempotency keys on transfers, and what a retry after a timeout does.
- **Components:** lb, app, sql, kv, queue, worker, cache. Behaviours: [hot].

#### `payment-processing`: Payment processing

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:** 1k–4k rps:
  - authorize 40% W (the card network is a `provider` at 400 ms and 99.5% available);
  - capture 20% W (may be asynchronous, within 1 h [lag]);
  - payment_status 40% R.

  100–500 GB stored, 365 days.

- **Storage:** `sql` payments and an idempotency table. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "the card network is down for 5 minutes" (authorisations fail fast and honestly, captures wait and complete);
  - zone.
- **Lesson:**
  - Authorisation is synchronous and must time out cleanly.
  - Capture and settlement are queued.
  - Every call carries an idempotency key.

  Flaw: capture called synchronously, so the outage scenario fails on captures.

- **Coverage:** `request(authorize → sql)`, `request(capture → queue, worker)`, `request(payment_status → cache, sql)`, `scenario(provider_down)`.
- **Rubric:**
  - what happens when the network times out after charging (idempotency and reconciliation);
  - why authorisation and capture are separate.
- **Components:** lb, app, cache, sql, queue, worker, provider **NEW**. Behaviours: [lag].

### Real-time & location

#### `nearby-places`: Nearby places

- **Pool:** practice. **Difficulty:** easy.
- **Traffic:** 3k–10k rps: nearby 80% R (places within a radius), place 18% Rc, review 2% W. Places change rarely. 20–100 GB stored, +0.2–1 GB/day, 365 days.
- **Storage:** `sql` places and reviews, `geo` index of place locations. **Budget:** S.
- **Scenarios:** baseline; "Friday night in one city" (peak with high skew); zone.
- **Lesson:** a spatial index answers "near me", and a nearby query touches a few cells, not every shard. A naive design uses a search index's every-shard query or a full scan. Flaw: `search` in place of `geo`, so peak fails because every shard sees every query.
- **Coverage:** `request(nearby → geo, fast)`, `request(place → cdn, cache, sql)`, `request(review → sql)`.
- **Rubric:** the spatial scheme (geohash, quadtree or S2 cells) and how a radius maps to cells; why places' slow change allows heavy caching.
- **Components:** cdn, lb, app, cache, sql, geo **NEW**.

#### `presence`: Online presence and typing indicators

- **Pool:** practice. **Difficulty:** hard.
- **Traffic:**
  - 1–4 million connected users [gateway connections];
  - heartbeat 80% W (every 30 s per user);
  - status_change 15% W (online, offline or typing, pushed to the 50 mean and 2,000 p99 contacts [fanout] who are online);
  - connect 5% R (a session check on connect).

  Working set 5–20 GB; storage small (1–5 GB).

- **Storage:** `kv` last-seen with an expiry. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "a gateway node dies" (a node failure on `gateway`: its users reconnect within 30 s, a reconnect storm on `connect`);
  - peak.
- **Lesson:**
  - Presence lives on persistent connections, and a node's loss becomes a reconnect storm that the session check must survive.
  - Status changes fan out only to online contacts.

  Flaw: the `connect` path sized for baseline only, so the gateway-node scenario fails on the session store.

- **Coverage:** `request(status_change → gateway, fast)`, `request(heartbeat → kv, cache)`, `scenario(gateway_node)`.
- **Rubric:** how "offline" is decided (heartbeat timeout) and why it's approximate; how reconnects are spread (jittered backoff).
- **Components:** lb, gateway **NEW**, app, cache, kv, stream, worker. Behaviours: [fanout].

#### `collaborative-editor`: Collaborative document editor

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:**
  - 200k–1M connected editors [gateway];
  - edit 70% W (an operation on one document, broadcast to its 3 mean and 200 p99 open editors [fanout], in order);
  - open 20% R;
  - snapshot 10% W (to `obj`).

  A company all-hands doc takes 2–10% of edits [hot]. 500–2,000 GB stored, +5–20 GB/day, 365 days.

- **Storage:** an operation log in a `stream` partitioned by document, snapshots in `obj`, metadata in `sql`. **Budget:** M–L.
- **Scenarios:**
  - baseline;
  - "the all-hands doc" (peak with the hot document at its top);
  - zone.
- **Lesson:**
  - One ordered log per document, so all editors see the same order.
  - Snapshots, so opening a document doesn't replay its whole history.

  Flaw: no snapshot store, so `open` reads the full log and fails baseline p99. This needs [work] on `open` scaled by log length; ADR-0050 lists it as an open question, and the fallback is rubric only.

- **Coverage:** `request(edit → stream, gateway)`, `request(open → obj, kv, fast)`, `scenario(peak)`.
- **Rubric:**
  - how concurrent edits converge (OT or CRDT) and why the ordering point matters;
  - what an editor sees when its connection drops and returns.
- **Components:** lb, gateway **NEW**, app, stream, worker, obj, sql, kv, cache. Behaviours: [fanout], [hot].

#### `food-delivery-tracking`: Food delivery tracking

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:**
  - courier_location 75% W (every 4 s per active courier);
  - match 5% R (the nearest free couriers to a restaurant);
  - track 20% (a customer watching one courier live: pushed through the `gateway`, 1 recipient).

  100k–500k connected customers. 50–300 GB of location history, 30 days.

- **Storage:** `geo` index of current positions, history in a `stream` to `obj`, orders in `sql`. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "Friday dinner rush" (peak, high skew on dense cities);
  - zone.
- **Lesson:**
  - Current positions live in memory in a geo index. Location history goes to cheap storage, not through the index's write path.
  - Customers are pushed updates rather than polling.

  Flaw: customers poll `track` through `app` to `sql` instead of being pushed, so peak fails on the primary.

- **Coverage:** `request(courier_location → geo)`, `request(match → geo, fast)`, `request(track → gateway, fast)`.
- **Rubric:** how a match avoids two orders taking one courier (a short hold); what the customer sees when the courier's phone loses signal.
- **Components:** lb, app, gateway **NEW**, geo **NEW**, stream, worker, obj, sql, cache.
- **Distance from the cup:** `cup-ride-dispatch` asks for one ride per driver through `search` and `sql`. This family's lesson is push tracking and the geo index's write path. The cup keeps `search`, unchanged.

### Data pipelines & analytics

#### `metrics-ingestion`: Metrics ingestion (existing)

- **Pool:** battle (stays). **Difficulty:** medium.
- **Traffic:** 3k–7k rps: ingest 95% W, query 5% R. 100–500 GB stored, +2–8 GB/day, 90 days.
- **Storage:** `kv` series through a `stream`. **Budget:** M–L (today $14.2k–29.7k).
- **Scenarios:** baseline; peak; zone.
- **Lesson:** a stream absorbs bursts. Rubric covers backpressure and retention.
- **Coverage:** `request(ingest → sql, kv)`, `request(query → cache, sql, kv)`.
- **Rubric:** backpressure; retention and resolution.
- **Components:** lb, app, cache, kv, stream, queue, worker, obj. No new ones.

#### `ad-click-aggregation`: Ad click counting

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:**
  - click 90% W (a click event; advertisers are billed on these, so none may be lost or double-counted);
  - report 10% R (per-ad counts by minute, within 2 min [lag]).

  The top campaign takes 5–15% of clicks [hot]. 500–2,000 GB stored, +20–60 GB/day, 90 days.

- **Storage:** raw clicks in a `stream` and then `obj`; aggregates in `kv`. **Budget:** M–L.
- **Scenarios:**
  - baseline;
  - "a sports final's half-time ad" (peak with the hot campaign);
  - "the aggregators restart and replay an hour" (a backlog drained within the target).
- **Lesson:**
  - Aggregate in windows with batched writes [batch], keyed so a replay overwrites rather than adds.
  - Keep raw events to reconcile.

  Flaw: per-click increments into `kv`, so the half-time scenario fails on the hot partition.

- **Coverage:** `request(click → stream)`, `request(click → obj)`, `request(report → kv, cache, fast)`, `scenario(peak)`.
- **Rubric:**
  - exactly-once counting under retries and replays (idempotent window writes);
  - late events and when a window is final.
- **Components:** lb, app, stream, worker, kv, cache, obj, queue. Behaviours: [hot], [batch], [lag].

#### `feature-store`: Feature store for recommendations

- **Pool:** practice. **Difficulty:** hard.
- **Traffic:**
  - features 85% R (online: a user's features for a model, very tight p99);
  - event 14% W (behaviour events into a stream, near-real-time features within 1 min [lag]);
  - backfill 1% W (nightly batch recomputation at 100 work units [work]).

  Working set 20–100 GB; 1,000–5,000 GB stored, +20–50 GB/day, 180 days.

- **Storage:** online `kv` and cache, offline `obj`. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "the nightly backfill overlaps the evening peak" (peak plus a backfill burst);
  - zone.
- **Lesson:** two paths. Online reads come from a precomputed key-value store. Offline batch writes into it in batches [batch], at a rate that leaves room for reads. Flaw: the backfill writes unbatched to `kv`, so the overlap scenario fails on `features` p99.
- **Coverage:** `request(features → cache, kv, fast)`, `request(event → stream)`, `request(backfill → obj, worker)`.
- **Rubric:** training and serving skew, and how one definition feeds both paths; feature freshness per kind (batch against streaming).
- **Components:** lb, app, cache, kv, stream, worker, obj, queue. Behaviours: [work], [batch], [lag].

### Infrastructure building blocks

#### `url-shortener`: URL shortener (existing)

- **Pool:** practice (moves from battle). **Difficulty:** easy.
- **Traffic:** 6k–12k rps: redirect 98% Rc, create 2% W. 100–400 GB stored, +1–5 GB/day, 365 days.
- **Storage:** `sql`. **Budget:** M (today $7.3k–9.2k).
- **Scenarios:** baseline; peak; zone.
- **Lesson:** cache redirects. Flaw: no cache, so peak fails.
- **Coverage:** `request(create → sql, kv)`, `request(redirect → cdn, cache, sql, kv, fast)`.
- **Rubric:** cache invalidation of changed links; collision-free codes.
- **Components:** lb, app, cache, sql, kv, cdn. No new ones.

#### `rate-limiter`: Rate limiter (existing)

- **Pool:** battle (stays). **Difficulty:** medium.
- **Traffic:** 5k–18k rps: check 97% W, rules 3% Rc. 1–10 GB stored, 365 days.
- **Storage:** `kv` counters, `sql` rules. **Budget:** M (today $8k–18.8k).
- **Scenarios:** baseline; peak; zone.
- **Lesson:** latency-tight counters in a key-value store. Rubric covers the algorithm and failing open or closed.
- **Coverage:** `request(check → cache, kv, fast)`, `request(rules → sql, kv)`.
- **Rubric:** algorithm choice; behaviour when the counters can't be reached.
- **Components:** lb, app, cache, sql, kv. No new ones. ([hot] could later model one abusive client.)

#### `distributed-cache`: A caching tier for a slow database

- **Pool:** practice. **Difficulty:** medium.
- **Traffic:** 10k–30k rps: get 95% Rc, put 5% W. The database behind it is a `sql` primary with few replicas allowed. Working set 50–300 GB, skew 0.3–0.7.
- **Storage:** `sql` of record. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "a cache node dies" (a node failure on `cache`: the hit rate drops and misses stampede the database);
  - peak.
- **Lesson:** size memory against the working set and skew, and spread nodes, so one node's loss doesn't send a stampede to the database (consistent hashing in the rubric, the stampede in the simulator). Flaw: 2 large cache nodes instead of many small ones, so the node scenario fails on the database.
- **Coverage:** `request(get → cache, fast)`, `request(put → sql)`, `scenario(cache_node)`.
- **Rubric:**
  - how keys are spread so that adding or losing a node moves few of them (consistent hashing);
  - invalidation on writes, and protecting the database from a stampede (request coalescing).
- **Components:** lb, app, cache, sql. No new ones. (It needs per-family scenarios for the node scenario; the v1 engine already lowers the hit rate when a cache node is lost.)

#### `id-generator`: Unique ID generator

- **Pool:** practice. **Difficulty:** medium.
- **Traffic:** 20k–60k rps: next_id 100% W (unique and roughly time-ordered, from many services). Storage tiny.
- **Storage:** `coord` (block leases). **Budget:** S.
- **Scenarios:**
  - baseline (a relational sequence can't keep up: 2,000 writes a second);
  - "a coordination member is lost" (a node failure on `coord`: the quorum must hold);
  - zone.
- **Lesson:** hand out ID blocks to app nodes through a consensus service, or encode node and time in the ID, so the hot path needs no shared write. Flaw: `next_id` to the `sql` primary, so baseline fails on the write ceiling. Second flaw: a `coord` of 3 members in 2 zones, so the zone scenario fails on quorum.
- **Coverage:** `request(next_id → app, fast)`, `request(next_id → coord, sql)` (blocks are leased somewhere durable), `scenario(zone)`.
- **Rubric:** what happens to a leased block when its node dies (gaps are fine; duplicates are not); clock skew in time-based IDs.
- **Components:** lb, app, sql, kv, coord **NEW**.
- **Open (engine):** block leasing means `coord` sees next_id ÷ block size. ADR-0050 proposes reusing [batch] on `app` for this (a block of N is a batch of N).

#### `job-scheduler`: Scheduled jobs service

- **Pool:** battle. **Difficulty:** hard.
- **Traffic:**
  - schedule 10% W (register a job with a cron rule);
  - fire 60% W (jobs that come due, each exactly one run, started within 30 s [lag], at 50 work units [work]);
  - history 30% R.

  50–200 GB stored, 365 days.

- **Storage:** `sql` jobs and runs, `coord` leader lease, `queue` for due runs. **Budget:** M.
- **Scenarios:**
  - baseline;
  - "midnight: a third of all jobs come due at once" (a 10-minute burst at 6× on fire);
  - "the scheduler's leader dies" (a node failure on `coord` and the leader's worker).
- **Lesson:**
  - One leader (elected through `coord`) scans for due jobs and enqueues them.
  - Many workers run them.
  - The midnight burst is absorbed by the queue, not by provisioning for it.

  Flaw: no queue between scanner and workers, so the midnight scenario fails. Second flaw: no `coord`, so the "exactly one run" requirement is uncovered.

- **Coverage:** `request(fire → coord, sql)` (exactly once), `request(fire → worker, fast)`, `request(history → cache, sql)`, `scenario(midnight)`.
- **Rubric:**
  - leader election and fencing: what stops an old leader that comes back;
  - at-least-once runs and how jobs are made idempotent.
- **Components:** lb, app, sql, cache, queue, worker, coord **NEW**. Behaviours: [lag], [work].

#### `feature-flags`: Feature flags and remote config

- **Pool:** battle. **Difficulty:** easy.
- **Traffic:**
  - evaluate 0% server-side: SDKs evaluate locally;
  - fetch_rules 90% Rc (SDK start and polls);
  - change 1% W (an admin flips a flag; every SDK sees it within 10 s [lag], pushed through a `gateway` with 100k–500k connected SDKs [fanout]);
  - audit 9% R.

  1–10 GB stored, 365 days.

- **Storage:** `sql` flags and audit. **Budget:** S.
- **Scenarios:**
  - baseline;
  - "a deploy restarts every service at once" (peak on fetch_rules);
  - "the flag service is down" (a region in AI mode, a zone in human mode: SDKs keep their last rules).
- **Lesson:**
  - Rules are fetched rarely and cached at the edge.
  - Evaluation is local in the SDK.
  - Changes are pushed. A naive design evaluates every flag with a server call.

  Flaw: no CDN on fetch_rules, so the deploy peak fails.

- **Coverage:** `request(fetch_rules → cdn, cache, fast)`, `request(change → gateway, fast)`, `request(audit → sql)`.
- **Rubric:** why evaluation is local, and what an SDK does when it can't reach the service; streaming against polling, and the cost of each.
- **Components:** cdn, lb, app, cache, sql, gateway **NEW**. Behaviours: [fanout], [lag].

## Stage 1 as built (spec 2.0, PROVISIONAL)

Spec 2.0 takes effect on 2026-12-01, the first monthly season boundary after ADR-0050 (`SPEC_V2_FROM` in `packages/hld/src/spec.ts`, Q-WD-31). Before it, no match, tournament round or practice problem uses a 2.0 family. The 1.0 families stay on 1.0: their pool, calibration designs and results are unchanged, and their matches keep playing on 1.0 after the boundary.

Seven families are written on 2.0: otp-login, webhook-delivery and image-resizer (practice), and file-sync, video-on-demand, payment-processing and web-crawler (battle). Each validates (HLDQ-3) in both battle modes. Where the numbers differ from the plan above, it's so the simulator shows the lesson:

- **Every family with a provider:** its latency (250 ms) and availability (99.5%) are the spec sheet's (ADR-0050 §2), not per family; each family sets only its price and its rate limit (Q-WD-31). The rate limit is drawn per battle mode as a multiple of all traffic.
- **otp-login:** a `session` check is added (88%), so request_code is 4% and verify 8% (plan: 40% and 60%). Calling the provider inline then fails only the outage, not the normal day's 99.9% through a 99.5% provider. Traffic is 2k–4k rps (plan: 500–2k), so the spike flaw has app servers to cut. SMS costs $0.0005 a send, and the provider takes about 4–6 times the sends. The spike is the shared 3×, not mostly request_code. The budget is dominated by SMS.
- **webhook-delivery:** delivered within 2 hours (plan: 5 minutes). Endpoints take 1.6–1.75 times the events, so a 30-minute outage and its drain outlive a 1-hour retention but not a day's. No 5% slow tail, and $0 a delivery.
- **image-resizer:** 600–1,500 rps (plan: 3k–8k), so the resizers fit 200 nodes. A resize on a miss is 10 work units (plan: 20), and an upload makes its two common sizes at 20. The CDN keeps sizes 20 minutes (a 67% hit rate), so without it the spike, not the normal day, overloads the resizers. Image bytes aren't counted, since their egress would turn the no-CDN flaw into a budget flaw. "Uploads arrive in a burst" is left out: it pressed the app's bandwidth harder than the spike, so the spike flaw failed both (owner, 2026-11-24: ships now without it, revisit in v2.1). The "cold renditions" spike is the shared spike.
- **file-sync:** changes 75%, download 14%, upload_chunk 6% (4 MB), commit 5% (plan: 70/15/10/5). 500–2,000 GB stored, growing 5–15 GB a day (plan: 2,000–8,000 and 40–100), because the metadata database is where commits are kept and must hold the horizon's data (the storage rule). Download bytes aren't counted.
- **video-on-demand:** 600–1,500 rps (plan: 5k–12k) with 500 KB segments (plan: 1.5 MB), so CDN egress is about $15k–40k a month. Uploads are 0.1% (plan: 1%) at 600 work units each (plan: 5 renditions at 600). No relational database in the reference (the storage rule). Its two lessons: without a CDN it fails on cost alone (ADR-0050's budget target); transcoders sized for the average fail the two-hour backlog.
- **payment-processing:** payment_status 84%, authorize 8%, capture 8% (plan: 40/40/20), so inline capture stays within the normal day's target through a 99.5% network. The network-down scenario's availability target is 90%: authorizations can't succeed while it's down. 1k–2k rps (human) and 2k–2.4k (AI), for the primary's writes. $0.0002 a call (ADR-0050's figure), which dominates the budget.
- **web-crawler:** no family scenario, and its own lessons aren't simulated. A slow site needs a per-scenario provider latency, which 2.0 doesn't have, and deduplication is still open (Q-WD-31), so the rubric carries both (owner, 2026-11-24: ships now, revisit in v2.1). Its one simulated flaw is the `requires` flaw below. Politeness is the provider's rate limit (2–2.5 times the fetches), and the frontier absorbs the spike within the hour. 500–2,000 GB stored, growing 50–150 GB a day (the seen-set must hold it).

What the engine does beyond ADR-0050's text, each only under 2.0, is recorded in ADR-0051 (ACCEPTED, owner, 2026-11-24):

- **Requires:** a request type names what must do its work (`requires`: `external_api`, `worker`). A type whose routes never reach one isn't served, so dropping the provider, or the queue that feeds the workers, never pays. request_code, event, authorize, capture and fetch require the provider; original (image-resizer) and upload (video-on-demand) require a worker. Each of those six families has a flaw that leaves it out (`no-provider`, `no-renditions`, `no-transcoding`) and fails the baseline, §6.4's gate.

- **Per-type load:** a scenario can set a request type's own load (`loads`, "three times the uploads for two hours").
- **Late work counts on its own:** work done too late misses the availability target however small its share of the traffic.
- **Fail fast:** a request type the provider's outage cuts off counts against what's served, not as an unbounded p99.
- **Retries:** behind a queue or stream, a provider's ordinary failures are retried; only a backlog past its limits is lost.
- **The worst wait** is the spike's minutes plus the drain, and the share past a limit is 1 − limit ÷ worst wait.
- **The provider** fails only in a scenario that names it, never with our zone or region.
- **Egress** is billed on reads' payloads by the client's first hop: a CDN for what it serves, the origin's price for the rest.
- **Flaws:** `utilization` (a node sized for the average) and `route` (one request type re-routed) join `without` (now one node or several), `configure` and `bypass`; a flaw may target `budget`, or `baseline` when it leaves out what does the work. The shared spike flaw never cuts a worker whose every request type waits in a queue, and is left out where it would cut nothing.

## Order of work (proposed)

Following ADR-0050's staging:

1. **Stage 0 (no engine change):** the pool split and the 12 families buildable on v1. That is the 8 existing ones plus qa-forum, hotel-booking, product-search and distributed-cache. product-search and distributed-cache need per-family scenarios, a family-format change and not an engine change.
2. **Stage 1 (spec v2.0):** `provider`, [lag], [work], [bytes]:
   - otp-login, webhook-delivery, payment-processing, web-crawler;
   - image-resizer, video-on-demand, file-sync.
3. **Stage 2 (spec v2.1, the next season boundary):** `geo`, `gateway`, `coord`, [fanout], [hot], [batch]:
   - nearby-places, food-delivery-tracking, presence, collaborative-editor, notification-service;
   - id-generator, job-scheduler, feature-flags;
   - like-counters, wallet-ledger, ad-click-aggregation, feature-store.

Batches of about 4 families, each validated (`buildPool`), calibrated and reviewed, then committed as PROVISIONAL, as the LLD practice catalog is (Q-WD-30).

## Open questions

1. **When the pool split takes effect.** Moving 4 families to practice now leaves 4 battle families until stage 0's new battle families land. Claude suggests switching once qa-forum and product-search are in the battle pool, so it never has fewer than 6.
2. **Existing practice designs** for chat, checkout, metrics-ingestion and rate-limiter (`hld_practice_design`) once those leave practice: keep them hidden, show them read-only, or delete them?
3. **Difficulty** is new on HLD families (shown in practice lists; it doesn't change numbers). Is easy/medium/hard enough, or should the human and AI ranges differ by difficulty too?
4. **Distance from cups.** food-delivery-tracking against `cup-ride-dispatch`, and like-counters against `cup-live-scores`: are they far enough apart in the owner's view?
5. **Rubric-only lessons.** web-crawler's dedup flaw and collaborative-editor's snapshot flaw depend on ADR-0050's open questions. If those stay out of the engine, both lessons are rubric-only.
