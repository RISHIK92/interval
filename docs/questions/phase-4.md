# Phase 4 questions

Answered by the owner on 2026-11-07 (all the suggested defaults; every dependency named here approved with them). Questions for Phase 4 (docs/roadmap/phase-4.md): native apps and audio. Each has a suggested default; the owner's answers are recorded under each.

Priority: **P0** blocks the week's first slice; **P1** blocks a later slice; **P2** can wait.

## Week 19: the monorepo, the Expo shell, auth, push

### Q-P4-01 The native app's stack and new dependencies (P0 for W19)

- Cite: ARCH-3, §4.2 ("iOS and Android apps (Expo)"), C-07.
- Why it matters: Expo brings React Native and dozens of packages; every one is a new dependency (CLAUDE.md).
- Suggested default:
  - `apps/mobile`, Expo SDK (the newest at least two weeks old), Expo Router;
  - TypeScript strict, tests with jest-expo and React Native Testing Library;
  - local builds on the iOS simulator and the Android emulator (no EAS cloud builds).
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-02 Signing in on native (P0 for W19)

- Cite: ADR-0016 (invite-only accounts), ADR-0029 (guests for Play).
- Suggested default:
  - Better Auth's Expo plugin (cookies kept in SecureStore), the same email and password as the web;
  - no guests on native (Play on native needs an account).
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-03 How push reaches a phone (P0 for W19-S05)

- Cite: §4.2 ("push notifications"), Week 19, Week 24.
- Why it matters:
  - Push needs an Apple Developer account ($99 a year) and a Firebase project for Android; creating those is the owner's.
  - Expo's push service adds an Expo account and a third party in the path.
- Suggested default: the worker sends straight to APNs and FCM (no Expo push service), with keys in the secrets store in both modes, as web push does. Until the owner has the accounts, only the simulator path is tested.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-04 TestFlight, Play internal testing and the store launch vs ADR-0013 (P1)

- Cite: Week 22 ("submit builds"), Week 24 ("store launch"), ADR-0013 (nothing deployed until every phase is built).
- Suggested default: the slices make release builds and the store metadata locally. Submitting is the owner's, after Phase 7, as with every deploy.
- **Answer (owner, 2026-11-07):** the suggested default.

## Week 20–21: the native reader and games

### Q-P4-05 Live 1v1 on native (P1 for W21)

- Cite: Week 21 ("native quick games"), ARCH-3 ("game protocol client").
- Suggested default: solo games, the daily challenge and live matches (sprint and fastest finger) on native, sharing a game protocol client package with the web.
- **Answer (owner, 2026-11-07):** the suggested default.

## Week 22–23: explainers and audio

### Q-P4-06 The model that writes explainer scripts (P0 for W22)

- Cite: AI-2 (a stronger model for explainer scripts), §5G, AI-1, AI-3, AI-4; the owner's rule: no model above $0.80 per million output tokens; the AI budget cap of 30 cents.
- Why it matters: AI-2 asks for a stronger model; the owner's price rule and budget may rule the usual ones out.
- Suggested default: a model within the price rule (the one QUESTIONS_MODEL uses), scripts generated once per concept (AI-4) within the existing budget, labeled as AI with citations.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-07 TTS providers, the blind test and its keys (P0 for W22)

- Cite: TTS-1 (ElevenLabs versus Inworld, Polly as fallback), OPS-4.
- Why it matters: each provider needs an account and key (the owner's), and generated audio costs money.
- Suggested default:
  - a `TtsProvider` port with ElevenLabs, Inworld and Polly adapters;
  - the blind test runs on 5 scripts with the owner listening;
  - a per-day TTS budget (OPS-4);
  - nothing is generated until keys exist.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-08 Word timestamps and forced alignment (P1)

- Cite: TTS-3.
- Suggested default: use the provider's word timestamps (ElevenLabs and Polly give them). Forced alignment as the fallback is a later dependency, asked about when a chosen provider lacks timestamps.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-09 HLS packaging (P1)

- Cite: TTS-4, DB-6, CACHE-4.
- Suggested default: ffmpeg in the worker image (a system binary, not a Python dependency) cuts the audio into HLS segments in S3 (SeaweedFS in VM mode), streamed through CloudFront.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-10 The pronunciation dictionary (P1)

- Cite: TTS-2.
- Suggested default: a YAML seed in the repo (term, how to say it), curated by the owner, applied as SSML or the provider's lexicon, with an admin page to add terms.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-11 The explainer itself (P1)

- Cite: §5G ("each concept gets an original explainer, written by AI from several sources with citations"), C-12, ING-2.
- Suggested default:
  - 60–120 seconds a concept;
  - only from sources whose rights profile allows processing full text;
  - its citations shown under the player;
  - the owner approves a script before it is voiced.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-12 The player's dependencies (P1 for W23)

- Cite: Week 23 (react-native-track-player, the Media Session API on the PWA).
- Suggested default:
  - react-native-track-player on native;
  - on the PWA, the browser's audio element with the Media Session API, plus hls.js where HLS isn't native (Chrome on desktop).
- **Answer (owner, 2026-11-07):** the suggested default.

## Week 24: push and the metrics

### Q-P4-13 Which pushes, and how often (P1 for W24)

- Cite: Week 24 ("opt-in push notifications for digests, path reminders, and the daily challenge").
- Suggested default:
  - each off until the user turns it on;
  - at most one push a day in total;
  - nothing between 21:00 and 08:00 local time;
  - the daily challenge at the user's chosen hour.
- **Answer (owner, 2026-11-07):** the suggested default.

### Q-P4-14 Telling native users apart for the metrics (P1 for W24)

- Cite: Phase 4 "Done when", DB-5 (the event `source` field).
- Suggested default: events carry `source` = ios or android from the app; retention compares accounts by where they were active in their first week.
- **Answer (owner, 2026-11-07):** the suggested default.
