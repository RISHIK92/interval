# Proposal: first 10 seed sources

- Status: ACCEPTED by the owner, 2026-10-25: all 10 sources, every one at `full_text_internal` with moments enabled (Q-P1-01, Q-P1-02).
- Becomes: `workers/jobs/seeds/sources.yaml` in P1-W2-S01. The first entry also feeds P1-W1-S04.
- Feed URLs: each returned HTTP 200 with an RSS or Atom content type on 2026-10-25.

Picked for the launch topics: system design, databases, distributed systems and backend. All are free to read, and every one has a feed.

The owner set every entry to `full_text_internal` with moments enabled. The body is fetched and stored privately for tagging, segmentation and embeddings, and is never displayed. Reading happens on the publisher's page through moment deep links (§3.2, ING-2).

```yaml
- name: The Cloudflare Blog
  homepage: https://blog.cloudflare.com/
  feed_url: https://blog.cloudflare.com/rss/
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [backend, distributed-systems]

- name: Netflix TechBlog
  homepage: https://netflixtechblog.com/
  feed_url: https://netflixtechblog.com/feed
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [system-design, distributed-systems]

- name: Martin Fowler
  homepage: https://martinfowler.com/
  feed_url: https://martinfowler.com/feed.atom
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [system-design, backend]

- name: Julia Evans
  homepage: https://jvns.ca/
  feed_url: https://jvns.ca/atom.xml
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [backend]

- name: Dan Luu
  homepage: https://danluu.com/
  feed_url: https://danluu.com/atom.xml
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [system-design]

- name: AWS Architecture Blog
  homepage: https://aws.amazon.com/blogs/architecture/
  feed_url: https://aws.amazon.com/blogs/architecture/feed/
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [system-design, distributed-systems]

- name: The GitHub Blog, Engineering
  homepage: https://github.blog/engineering/
  feed_url: https://github.blog/engineering/feed/
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [backend, databases]

- name: Brendan Gregg
  homepage: https://www.brendangregg.com/blog/
  feed_url: https://www.brendangregg.com/blog/rss.xml
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [backend]

- name: Marc Brooker
  homepage: https://brooker.co.za/blog/
  feed_url: https://brooker.co.za/blog/rss.xml
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [distributed-systems, databases]

- name: PlanetScale Blog
  homepage: https://planetscale.com/blog
  feed_url: https://planetscale.com/blog/feed.atom
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  topics: [databases]
```

Alternates. Their feeds also returned 200:
- All Things Distributed: https://www.allthingsdistributed.com/atom.xml
- Slack Engineering: https://slack.engineering/feed/
- Engineering at Meta: https://engineering.fb.com/feed/
- Discord Blog: https://discord.com/blog/rss.xml
- ByteByteGo: https://blog.bytebytego.com/feed. It is named in the HTML §5B. Some posts are paid-only, so `paywalled: true`.
- Fly.io Blog: https://fly.io/blog/feed.xml

Not checked yet:
- Topic slugs: they follow the four launch topics. The real slugs come from the concept list (Q-P1-03, Week 3).
- Heading ids: whether each site's article HTML has heading `id` attributes for moment anchors. P1-W2-S05's fixture test checks this.
