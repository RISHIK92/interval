import { HldProblem } from "./problem";

// P6-W39 (ADR-0042 PROPOSED, Q-P6-03): solo practice problems, until W40's families
// replace them. PROVISIONAL: the owner reviews the numbers before launch.

// A URL shortener: reads (redirects) dominate and are cacheable; writes (new links)
// are not.
export const URL_SHORTENER = HldProblem.parse({
  slug: "url-shortener",
  title: "URL shortener",
  timeLimitMinutes: 30,
  requirements: ["Shorten a URL", "Redirect a short code to its URL"],
  traffic: {
    requests: [
      { type: "read", rps: 8_000, kind: "read", cacheable: true },
      { type: "write", rps: 400, kind: "write", cacheable: false },
    ],
    workingSetGb: 40,
    hotKeySkew: 0.8,
    storedGb: 200,
    growthGbPerDay: 2,
    horizonDays: 365,
  },
  budgetPerMonth: 6_000,
  scenarios: [
    {
      id: "baseline",
      name: "A normal day",
      weight: 3,
      load: 1,
      targets: { p99Ms: 100, availability: 0.999 },
    },
    {
      id: "peak",
      name: "A launch-day spike",
      weight: 2,
      load: 3,
      targets: { p99Ms: 200, availability: 0.995 },
    },
    {
      id: "zone",
      name: "A zone goes down",
      weight: 2,
      load: 1,
      failure: { scope: "zone" },
      targets: { p99Ms: 150, availability: 0.99 },
    },
  ],
  allowedComponents: [
    "load_balancer",
    "app_service",
    "cache",
    "sql_db",
    "kv_store",
    "cdn",
  ],
  rubric: [
    {
      id: "caching",
      criterion: "Caches redirects and explains its invalidation.",
      weight: 1,
    },
  ],
  concepts: ["caching", "replication"],
});

export const PRACTICE_PROBLEMS: readonly HldProblem[] = [URL_SHORTENER];
