# 0018. In-app reader: the publisher's live page, framed, in the PWA and web

- Status: ACCEPTED
- Date: 2026-10-26
- Supersedes: none (amends ADR-0006 C-07)
- Superseded by: none

## Context

The owner wants the home experience complete before Phase 2. That means articles open inside Interval, in the PWA and on the web, with a custom overlay at the bottom, as in design screen 3 "In-app browser" (docs/wireframes/app-design.html).

The docs place this later and limit how it may be done:

- **ADR-0006 C-07 (ACCEPTED, confirmed as proposed):** "Phase 1 is the PWA only. … Screen 03 (native in-app browser) is Phase 4."
- **§3.2:** "For web articles, a moment is a deep link into the publisher's original page, never a copy". CLAUDE.md lists it as a domain invariant: "Moments are deep links into the publisher's page, never copies."
- **ING-2:** "A source's rights profile gates every processing step". No full text is displayed beyond what the profile allows. Every current source is `full_text_internal` (store and process, not display). `full_text_display` waits for its own ADR (ADR-0010).
- **§8:** links carry `utm_source=interval`, which P1-W5-S01 builds through `/out`.
- **DB-5 / Q-P1-21:** `card_opened`, `outbound_click`, and the finished-rate metric (P1-W6-S04).
- **C-22:** the return prompt and Mark section done.

A check of the 35 active sources on 2026-10-26 read one recent article's response headers per source:

- 20 allow framing (no `X-Frame-Options`, no restricting `frame-ancestors`);
- 10 refuse it (`DENY` or `SAMEORIGIN`): Martin Fowler, AWS, GitHub, InfoQ, The New Stack, Sam Who, Mitchell Hashimoto, Stripe, Slack, Dropbox;
- 5 block us outright (403) and already fail at ingest.

Owner choices, 2026-10-26:

- **Where:** in-app where the publisher allows framing, else the browser as today.
- **Overlay:**
  - "Why this matters" (the AI box when a model wrote it);
  - Save and Mark done;
  - "Next section" for moments;
  - Highlight, Listen and "Test me" shown disabled, "Coming later".
- **Finish prompt:** "Did you finish?" asks when the reader closes; Mark done in the overlay skips it.
- **Events:** `card_opened` gains `surface: in_app | browser`.

## Decision

Accepted by the owner on 2026-10-26: option A. Answers to the open questions:

- **Blank or broken frame:** after about 6 s without a load, a card offers "Open on <site>"; "Open in browser" also stays in the header.
- **Frameability:** recorded per item.
- **Desktop:** the same full-screen reader as on phones.

## Options

### A. Frame the live publisher page where allowed (the owner's choice)

`/read/<item>?moment=…` is an Interval page:

- a header with close, a domain pill and "Open in browser";
- an iframe of the publisher's page (the same attributed URL `/out` builds, section anchor included);
- the overlay below the frame, never over the publisher's content.

The worker records, per item, whether its page allows framing, read from the response headers it already fetches at ingest and at the weekly link check (ING-1, ING-6). The feed then knows which cards open in-app.

- **Pros:**
  - Nothing is copied: the reader sees the publisher's own page, ads and all. §3.2 and ING-2 hold as written.
  - The design's frame and overlay arrive now.
  - The browser fallback is what already exists.
- **Cons:**
  - About 40% of sources still open in the browser.
  - Inside a frame, cross-site cookies are blocked, so a publisher's sign-in, paywall or consent state doesn't carry over. Some pages bust out of frames with script.
  - Cross-origin rules hide the publisher's scroll, so there's no "1 min left" or reading progress (the design draws them).
  - Framing a publisher's page inside another site may sit badly with some publishers even when their headers allow it.
- **Cost to reverse:** low. Cards go back to opening in the browser, with one flag in the feed reader.

### B. Reader view of the extracted text

Show the text Interval already extracts, in Interval's typography.

- **Pros:**
  - The full design, including progress and "min left", for every source.
- **Cons:**
  - It displays a copy. That contradicts §3.2 and the CLAUDE.md invariant, and every source is `full_text_internal`.
  - It needs publishers' display permission and the `full_text_display` ADR.
- **Cost to reverse:** high once users rely on it, and the legal exposure is real.

### C. Wait for Phase 4 (C-07 as accepted)

- **Pros:**
  - No change to accepted decisions.
- **Cons:**
  - The owner wants the experience before Phase 2.

## Recommendation (not a decision)

**A**, if the owner wants it now. It is the only option the docs allow before a display-rights decision exists: it keeps "deep link, never a copy" literally true. B needs the partner ADR and real publisher agreements first. Accepting A amends C-07, bringing a web version of screen 03 into the PWA and web now. The native in-app browser stays in Phase 4.

## Consequences

- **Worker:**
  - `content_item.frameable` (null = unknown, true or false), set from the page's `X-Frame-Options` and `Content-Security-Policy: frame-ancestors` at fetch (when the profile allows the body fetch) and by the weekly link check (status only, any profile);
  - the feed views expose it.
- **Web:**
  - `/read/[item]` (moment optional) with the frame, header and overlay;
  - feed and continue cards link there when the item is frameable, else to `/out` as now;
  - the frame's `src` is the attributed publisher URL (§8);
  - the close and back gestures return to the feed and ask "Did you finish?" (C-22's prompt, new trigger);
  - "Next section" swaps the frame to the next moment's link.
- **Events:**
  - `card_opened` v3 adds `surface`;
  - an in-app open emits `card_opened` and not `outbound_click`, which stays for browser opens;
  - the finished-rate query (P1-W6-S04) needs no change, since it reads `card_opened` by ids.
- **Security:** the page that frames publishers sets `frame-src https:` only, and the iframe gets a sandbox that keeps the publisher's scripts working (`allow-scripts allow-same-origin allow-popups allow-forms`), with no access to Interval's origin.
- **Not in scope:** reading progress and "min left" (not possible across origins), quiz, highlight and listen (Phase 2+, shown disabled), and a reader view (option B).

## Open questions

- A frame that loads blank or busts out: does a timeout (for example 6 s) show "Open in browser", or does the reader just keep "Open in browser" in the header?
- Should frameability be per item (headers can differ by page) or per source? Per item is proposed, since it's measured per page anyway.
- Desktop web: the same full-screen reader, or a side panel next to the feed?
