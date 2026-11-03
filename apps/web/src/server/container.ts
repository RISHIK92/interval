import { FirehoseClient } from "@aws-sdk/client-firehose";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { DB } from "@interval/db";
import { Redis } from "ioredis";
import type { Kysely } from "kysely";
import { env, filesEnv, githubEnv } from "../env";
import {
  type Auth,
  accounts as betterAuthAccounts,
  createAuth,
  guestSessions as betterAuthGuests,
  sessionReader as betterAuthSessions,
} from "./adapters/better-auth";
import {
  createDb,
  kyselyEntitlements,
  kyselyFeedReader,
  kyselyInviteCodes,
  kyselyPing,
} from "./adapters/kysely";
import { bullmqQueue } from "./adapters/bullmq-queue";
import { kyselyAdminReview } from "./adapters/kysely-admin-review";
import { kyselyAdminSources } from "./adapters/kysely-admin-sources";
import { kyselyRanking } from "./adapters/kysely-ranking";
import { kyselyFeedback } from "./adapters/kysely-feedback";
import { kyselyLibrary } from "./adapters/kysely-library";
import { kyselyOutboundLinks } from "./adapters/kysely-outbound";
import { kyselyAdminPaths } from "./adapters/kysely-admin-paths";
import { kyselyAdminQuestions } from "./adapters/kysely-admin-questions";
import { kyselyAdminDaily } from "./adapters/kysely-admin-daily";
import { kyselyGuestLimits } from "./adapters/kysely-guest-limits";
import { kyselyAdminTechnologies } from "./adapters/kysely-admin-technologies";
import { kyselyAdminUniversities } from "./adapters/kysely-admin-universities";
import { kyselyBooks } from "./adapters/kysely-books";
import { fetchGitHub } from "./adapters/fetch-github";
import { kyselyGitHub } from "./adapters/kysely-github";
import { kyselyNotes } from "./adapters/kysely-notes";
import { kyselyPaths } from "./adapters/kysely-paths";
import { kyselyPlayerCountries } from "./adapters/kysely-player-countries";
import { kyselyPlayerUniversities } from "./adapters/kysely-player-universities";
import { kyselyMatches } from "./adapters/kysely-matches";
import { kyselyRatings } from "./adapters/kysely-ratings";
import { valkeyMatchHandoff } from "./adapters/valkey-match-handoff";
import { queuePrefix, valkeyMatchmaking } from "./adapters/valkey-matchmaking";
import { startLiveMatch, startReplayMatch } from "./live";
import { kyselyFollows, kyselyUsernames } from "./adapters/kysely-people";
import { kyselyQuizzes } from "./adapters/kysely-quizzes";
import { kyselyProgress } from "./adapters/kysely-progress";
import { kyselyPreferences } from "./adapters/kysely-preferences";
import { fileSink } from "./adapters/file-sink";
import { firehoseSink } from "./adapters/firehose-sink";
import { logMailer } from "./adapters/log-mailer";
import { s3Files } from "./adapters/s3-files";
import { sqsQueue } from "./adapters/sqs-queue";
import { valkeyLeaderboards } from "./adapters/valkey-leaderboards";
import { createEmitter, type Emitter } from "./events";
import { log } from "./log";
import type {
  GameMode,
  LiveMatch,
  AdminDaily,
  AdminTechnologies,
  AdminUniversities,
  Books,
  FileStore,
  GitHub,
  GitHubAccounts,
  Accounts,
  AdminPaths,
  AdminReview,
  AdminQuestions,
  AdminSources,
  RankingInspection,
  DatabasePing,
  Entitlements,
  Feedback,
  FeedReader,
  GuestLimits,
  GuestSessions,
  InviteCodes,
  JobQueue,
  Leaderboards,
  Library,
  OutboundLinks,
  PreferencesStore,
  Notes,
  Paths,
  PlayerCountries,
  PlayerUniversities,
  Follows,
  Matches,
  Matchmaking,
  PlayerRatings,
  Usernames,
  Progress,
  Quizzes,
  SessionReader,
} from "./ports";

// Composition root (ADR-0012): the only place that picks adapters. Lazy, because
// `next build` imports route modules without a runtime environment.
let database: Kysely<DB> | undefined;
let authInstance: Auth | undefined;

function db(): Kysely<DB> {
  database ??= createDb(env().DATABASE_URL);
  return database;
}

export function auth(): Auth {
  authInstance ??= createAuth({
    db: db(),
    secret: env().BETTER_AUTH_SECRET,
    baseURL: env().BETTER_AUTH_URL,
    // MAIL_TRANSPORT has one value until the SES adapter exists (pre-deploy list).
    mailer: logMailer(),
  });
  return authInstance;
}

export function preferences(): PreferencesStore {
  return kyselyPreferences(db());
}

export function feedback(): Feedback {
  return kyselyFeedback(db());
}

export function library(): Library {
  return kyselyLibrary(db());
}

export function outboundLinks(): OutboundLinks {
  return kyselyOutboundLinks(db());
}

export function progress(): Progress {
  return kyselyProgress(db());
}

export function notes(): Notes {
  return kyselyNotes(db());
}

export function adminPaths(): AdminPaths {
  return kyselyAdminPaths(db());
}

export function paths(): Paths {
  return kyselyPaths(db());
}

export function quizzes(): Quizzes {
  return kyselyQuizzes(db());
}

export function adminQuestions(): AdminQuestions {
  return kyselyAdminQuestions(db());
}

// P3-W13-S05 (ADR-0031): the daily challenge's sets, reviewed by the owner.
export function adminDaily(): AdminDaily {
  return kyselyAdminDaily(db());
}

// P2-W12-S03 (PER-4): suggested technologies, reviewed by the owner.
export function adminTechnologies(): AdminTechnologies {
  return kyselyAdminTechnologies(db());
}

// P3-W14-S03 (ADR-0032): typed universities, tidied by the owner.
export function adminUniversities(): AdminUniversities {
  return kyselyAdminUniversities(db());
}

export function adminSources(): AdminSources {
  return kyselyAdminSources(db());
}

export function rankingInspection(): RankingInspection {
  return kyselyRanking(db());
}

export function adminReview(): AdminReview {
  return kyselyAdminReview(db());
}

export function feedReader(): FeedReader {
  return kyselyFeedReader(db());
}

export function databasePing(): DatabasePing {
  return kyselyPing(db());
}

export function entitlements(): Entitlements {
  return kyselyEntitlements(db());
}

export function inviteCodes(): InviteCodes {
  return kyselyInviteCodes(db());
}

export function guestLimits(): GuestLimits {
  return kyselyGuestLimits(db(), env().BETTER_AUTH_SECRET);
}

export function guestSessions(): GuestSessions {
  return betterAuthGuests(auth());
}

export function sessionReader(): SessionReader {
  return betterAuthSessions(auth());
}

export function accounts(): Accounts {
  return betterAuthAccounts(auth(), db());
}

// One emitter per process, so its buffer batches events across requests (DB-5) and the
// SIGTERM flush sees them all. Kept on globalThis because Next may load this module more
// than once (proxy, instrumentation and app bundles).
const EMITTER = Symbol.for("interval.events");
const processGlobals = globalThis as { [EMITTER]?: Emitter };

export function events(): Emitter {
  let emitter = processGlobals[EMITTER];
  if (emitter === undefined) {
    const config = env();
    emitter = createEmitter(
      config.EVENTS_TRANSPORT === "firehose"
        ? firehoseSink(
            new FirehoseClient({ region: config.AWS_REGION }),
            config.EVENTS_STREAM,
          )
        : fileSink(config.EVENTS_DIR),
    );
    processGlobals[EMITTER] = emitter;
  }
  return emitter;
}

let queue: JobQueue | undefined;

// ADR-0014: one connection per process, reused by every enqueue.
export function jobQueue(): JobQueue {
  if (queue === undefined) {
    const config = env();
    queue =
      config.QUEUE_TRANSPORT === "bullmq"
        ? bullmqQueue(config.VALKEY_URL)
        : sqsQueue(
            new SQSClient({ region: config.AWS_REGION }),
            config.SQS_QUEUE_URL_PREFIX,
          );
  }
  return queue;
}

let valkey: Redis | undefined;

// P3-W14-S01 (CACHE-3): boards on Valkey in every mode (ADR-0014). A Valkey that's
// down fails a command in about a second rather than holding a game's finish.
function valkeyClient(): Redis {
  if (valkey === undefined) {
    valkey = new Redis(env().VALKEY_URL, {
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
    });
    // Each failed command is logged where it fails; this keeps ioredis's own
    // connection errors in the structured log rather than bare on the console.
    valkey.on("error", (error: Error) => {
      log.warn("valkey connection error", { error });
    });
  }
  return valkey;
}

export function leaderboards(): Leaderboards {
  return valkeyLeaderboards(db(), valkeyClient());
}

// P3-W16-S02 (MATCH-3): the live 1v1 queue; a pair gets a match on its game server.
export function matchmaking(mode: GameMode): Matchmaking {
  return valkeyMatchmaking(
    valkeyClient(),
    async (players) => {
      const match = await startLiveMatch(
        matches(),
        valkeyMatchHandoff(valkeyClient()),
        players,
        mode,
      );
      return match.id;
    },
    Date.now,
    queuePrefix(mode),
  );
}

// P3-W17-S01, S02 (C-01): with no person to play, a ghost else a bot, handed over.
export function replayMatch(
  userId: string,
  mode: GameMode,
): Promise<LiveMatch | null> {
  return startReplayMatch(
    matches(),
    valkeyMatchHandoff(valkeyClient()),
    userId,
    mode,
  );
}

export function playerRatings(): PlayerRatings {
  return kyselyRatings(db());
}

// P3-W14-S02 (§6.7, Q-P3-08).
export function playerCountries(): PlayerCountries {
  return kyselyPlayerCountries(db());
}

// P3-W14-S03 (§6.7, ADR-0032).
export function playerUniversities(): PlayerUniversities {
  return kyselyPlayerUniversities(db());
}

// P3-W14-S05 (§6.7, Q-P3-11).
export function usernames(): Usernames {
  return kyselyUsernames(db());
}

export function follows(): Follows {
  return kyselyFollows(db());
}

// P3-W15-S02 (ADR-0033): live matches, for match tickets.
export function matches(): Matches {
  return kyselyMatches(db());
}

// P2-W12-S01 (§5H, ADR-0024): Interval's GitHub App; null when it isn't configured,
// and connecting GitHub isn't offered.
export function githubApp(): {
  slug: string;
  clientId: string;
  secureCookies: boolean; // as the visit cookie: the public origin is https
  github: GitHub;
} | null {
  const app = githubEnv();
  if (app === null) return null;
  return {
    slug: app.GITHUB_APP_SLUG,
    clientId: app.GITHUB_APP_CLIENT_ID,
    secureCookies: new URL(env().BETTER_AUTH_URL).protocol === "https:",
    github: fetchGitHub({
      clientId: app.GITHUB_APP_CLIENT_ID,
      clientSecret: app.GITHUB_APP_CLIENT_SECRET,
    }),
  };
}

export function githubAccounts(): GitHubAccounts {
  return kyselyGitHub(db());
}

// P2-W11-S01: private PDF books.
export function books(): Books {
  return kyselyBooks(db());
}

let fileStore: FileStore | undefined;

// DB-6, ADR-0011: one client per process; SeaweedFS (S3_ENDPOINT) needs path-style URLs.
export function files(): FileStore {
  if (fileStore === undefined) {
    const config = filesEnv();
    fileStore = s3Files(
      new S3Client({
        region: config.AWS_REGION,
        ...(config.S3_ENDPOINT === undefined
          ? {}
          : { endpoint: config.S3_ENDPOINT, forcePathStyle: true }),
      }),
      config.PRIVATE_CONTENT_BUCKET,
    );
  }
  return fileStore;
}
