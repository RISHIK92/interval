# Phase 4 slices

DRAFT (2026-11-07), with the owner's answers to docs/questions/phase-4.md the same day. Phase 4 (docs/roadmap/phase-4.md) as one-session slices, in the Phase 1–3 format. Run a slice with `/slice <ID>`.

Field key: **IDs** = decision IDs implemented. **Needs** = slices and ADRs that must be done or ACCEPTED first. **Q** = questions in docs/questions/phase-4.md.

Already in place, so not sliced again:

- **The monorepo** (ARCH-3): pnpm workspaces with Turborepo since Phase 1. Phase 4 adds `apps/mobile` and the shared packages it needs.
- **Web push** (P3-W17-S05b): the worker's sender, VAPID and subscriptions. Week 24 reuses them for the PWA.
- **The API:** the native app calls the same route handlers and server actions' APIs the PWA does; new endpoints are added only where a page did the work.

Store submissions (TestFlight, Play internal testing, the store launch) are builds and metadata only (Q-P4-04, ADR-0013). Submitting is the owner's, after Phase 7.

ADRs the answers need, each before its first slice (PROPOSED until the owner accepts):

- explainer scripts written by a model within the owner's price rule (Q-P4-06; amends AI-2's "stronger model") — before W22-S01.

## Week 19: the monorepo, shared packages, the Expo shell, auth, push

### P4-W19-S01 The Expo shell

- IDs: ARCH-3, §4.1, §4.2, C-07
- Needs: none
- Goal: `apps/mobile` (Expo, Expo Router, TypeScript strict) with the five areas as tabs (Home, Explore, Paths, Play, Library) and Profile from the avatar, each a placeholder. Design tokens come with S02 (`packages/tokens`).
- Acceptance: it runs on the iOS simulator and the Android emulator; jest-expo tests render each tab; `pnpm check` runs the app's typecheck, lint and tests; the web is unchanged.
- Q: Q-P4-01.

### P4-W19-S02 Shared packages: the API client and design tokens

- IDs: ARCH-3
- Needs: S01
- Goal: `packages/api-client` (typed calls and zod parsing of the endpoints the app uses, one implementation for both apps where the web calls them from the browser) and `packages/tokens` (colors, type scale, spacing) used by the web's Tailwind theme and the app.
- Acceptance: the web's colors come from `packages/tokens` with no visual change (tests on the generated theme); the client's parsing is tested against the routes' own responses.

### P4-W19-S03 Signing in on native

- IDs: ADR-0016, ADR-0029
- Needs: S02
- Goal: sign in and out with the same email and password accounts; the session kept in SecureStore through Better Auth's Expo plugin; signed-out users see the join screen; no guests on native.
- Acceptance: the server accepts the app's origin only as the plugin requires; a test signs in against the local server; an expired session returns to sign-in.
- Q: Q-P4-02.

### P4-W19-S04 Native push plumbing

- IDs: §4.2
- Needs: S03
- Goal: the app registers its APNs or FCM token (after asking, on a user action); the worker sends a push straight to APNs (token-based JWT) and FCM (HTTP v1), with keys from the secrets store in both modes; a dead token is dropped.
- Acceptance: device tokens kept per user and platform; the sender tested against fakes of APNs and FCM; a simulator receives a test push (iOS simulator push file); no push type exists yet beyond a test one.
- Q: Q-P4-03.

## Week 20: the native feed and the WebView reader

### P4-W20-S01 Native feed

- IDs: §5A, CACHE-1, PER-1
- Needs: W19-S02, W19-S03
- Goal: Home's feed in the app: the same precomputed cards, time chips, why-shown reasons, save and feedback.
- Acceptance: the same API as the PWA; pull to refresh; `feed_viewed` and `card_opened` with `source` ios or android (Q-P4-14).

### P4-W20-S02 The WebView reader and its bottom sheet

- IDs: §5D, Part I §3.2, ADR-0018
- Needs: S01
- Goal: the publisher's page in a WebView with Interval's bottom sheet on top: why this matters, save, note, Test 60s.
- Acceptance: the page is the publisher's, never a copy (§3.2); the sheet's actions use the existing APIs; a non-frameable page loads too (a WebView isn't an iframe).

### P4-W20-S03 Section scrolling and automatic progress

- IDs: §5D ("a small script scrolls to the section and measures reading progress … It never changes page content")
- Needs: S02
- Goal: an injected script scrolls to the moment's section and reports how far the reader got; a moment counts as finished when its section has been read through.
- Acceptance: the script only scrolls and measures (a test checks that it never writes to the DOM); `section_finished` with method `auto`; the threshold is a named constant.

## Week 21: native games, boards, paths, PDFs

### P4-W21-S01 Native solo games and the daily challenge

- IDs: §6.3, ARCH-3 (quiz and scoring logic)
- Needs: W19-S02
- Goal: sprint, estimation and the daily challenge in the app, with haptics on right and wrong and the share sheet for share cards.
- Acceptance: scoring from a shared package used by both apps; server timing as on the web; events with ids only.

### P4-W21-S02 The game protocol client and native live matches

- IDs: ARCH-3 (game protocol client), ADR-0033
- Needs: S01
- Goal: `packages/game-client` (the queue, tickets, the socket, reconnects, the sprint and fastest-finger states) taken out of the web's live client and used by both apps; live 1v1 in the app.
- Acceptance: the web's live tests pass unchanged against the package; the app plays a match against the local game server.
- Q: Q-P4-05.

### P4-W21-S03 Native boards and paths

- IDs: §6.7, §5F
- Needs: W19-S02
- Goal: boards (scopes, seasons) and topic paths (the active path, its sections and checkpoints) in the app.

### P4-W21-S04 The native PDF reader

- IDs: §5F, DB-6
- Needs: W19-S03
- Goal: a book session's pages in the app, with Mark done and the chapter checkpoint.
- Acceptance: the private file is fetched as on the web (signed, the owner only); nothing cached beyond the session.

## Week 22: explainers, TTS, builds

### P4-W22-S01 Concept explainer scripts

- IDs: §5G, AI-1, AI-3, AI-4, ING-2, OPS-4
- Needs: the explainer-model ADR
- Goal: a worker job writes a 60–120 s script per concept from several allowed sources, with citations; the owner approves or rejects each at `/admin/explainers` before it is voiced.
- Acceptance: only sources whose rights profile allows full text (ING-2); generated once per concept (AI-4) within the budget; stored apart from source text and labeled AI (AI-3).
- Q: Q-P4-06, Q-P4-11.

### P4-W22-S02 The pronunciation dictionary

- IDs: TTS-2
- Needs: none
- Goal: a YAML seed of technical terms and how to say them, loaded into a table, applied to scripts before TTS; an admin page adds terms.
- Q: Q-P4-10.

### P4-W22-S03 The TTS port, its adapters and the blind test

- IDs: TTS-1, OPS-4
- Needs: S02
- Goal: a `TtsProvider` port with ElevenLabs, Inworld and Polly adapters (each off until its key exists); a blind-test page that plays the same 5 scripts by provider, unnamed, and records the owner's picks.
- Acceptance: adapters tested against fakes; a per-day TTS budget; the chosen provider set by env.
- Q: Q-P4-07.

### P4-W22-S04 Voicing explainers: timestamps and HLS

- IDs: TTS-3, TTS-4, DB-6, CACHE-4
- Needs: S01, S03
- Goal: an approved script is voiced once with word timestamps, cut into HLS by ffmpeg in the worker image, and stored in S3 (SeaweedFS in VM mode) for CloudFront.
- Acceptance: timestamps stored beside the audio; a provider without them stops the job with a clear error (forced alignment asked later, Q-P4-08); the worker image builds with ffmpeg in both modes.
- Q: Q-P4-08, Q-P4-09.

### P4-W22-S05 Release builds

- IDs: ADR-0013
- Needs: W19-S01
- Goal: release builds for iOS and Android made locally, with icons, the splash screen and the store metadata in the repo.
- Acceptance: both builds succeed locally; nothing is submitted (Q-P4-04).

## Week 23: the player

### P4-W23-S01 The PWA mini-player and the audio queue

- IDs: §5G, §4.1 (a global mini-player), §5I (the audio queue in Library)
- Needs: W22-S04
- Goal: a global mini-player that expands into a full player, with the Media Session API (lock-screen controls), speed, saved positions, and a queue in Library; hls.js where HLS isn't native.
- Q: Q-P4-12.

### P4-W23-S02 The native player

- IDs: §4.2 (background audio), §5G
- Needs: S01, W19-S01
- Goal: react-native-track-player with background playback and lock-screen controls, sharing the queue and saved positions with the PWA.

### P4-W23-S03 Synced captions

- IDs: TTS-3, §5G
- Needs: S01
- Goal: captions highlighted word by word from the stored timestamps, on both players.

## Week 24: opt-in push, metrics, wrap-up

### P4-W24-S01 Opt-in push: digests, path reminders, the daily challenge

- IDs: Week 24
- Needs: W19-S04, P3-W17-S05b
- Goal: each push off until the user turns it on, on native and the PWA; at most one a day; quiet from 21:00 to 08:00 local; the daily challenge at the user's chosen hour.
- Q: Q-P4-13.

### P4-W24-S02 Phase 4 metrics

- IDs: DB-5, Phase 4 "Done when"
- Needs: W20-S01, W23-S01
- Goal: queries for native vs PWA retention, the share of weekly actives who listen to an explainer, explainer completion, and push opt-in.
- Acceptance: Athena SQL in `packages/events/queries/`, tested with DuckDB on fixture events.
- Q: Q-P4-14.

### P4-W24-S03 Phase 4 wrap-up

- IDs: ADR-0013
- Needs: all of the above
- Goal: Phase 4 checked end to end locally; the store launch is the checklist, not a submission.
- Acceptance: `docs/runbooks/phase-4-checklist.md` walked; both CDK stacks synth; the VM smoke run; a drift audit.
