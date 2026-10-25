import { z } from "zod";

// DB-5: events go to Firehose when deployed (both modes) and to a file in development.
const events = z.discriminatedUnion("EVENTS_TRANSPORT", [
  z.object({
    EVENTS_TRANSPORT: z.literal("file"),
    // Absolute; scripts/with-env.sh resolves the .env value against the repo root.
    EVENTS_DIR: z.string().min(1),
  }),
  z.object({
    EVENTS_TRANSPORT: z.literal("firehose"),
    EVENTS_STREAM: z.string().min(1),
    AWS_REGION: z.string().min(1),
  }),
]);

const schema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    NODE_ENV: z.enum(["development", "test", "production"]),
    // Better Auth (ADR-0004): signs session cookies; at least 32 random characters.
    BETTER_AUTH_SECRET: z.string().min(32),
    // The public origin, e.g. https://interval.example.com.
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    // Q-P1-33: auth email is logged in development; SES comes before deploy.
    MAIL_TRANSPORT: z.enum(["log"]),
  })
  .and(events)
  .refine(
    // Logged mail carries reset links, so only a local site may use it.
    (e) =>
      ["localhost", "127.0.0.1"].includes(new URL(e.BETTER_AUTH_URL).hostname),
    {
      path: ["MAIL_TRANSPORT"],
      message: "log is only allowed when BETTER_AUTH_URL is a local site",
    },
  );

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Names and reasons only: values can be secrets.
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

let cached: Env | undefined;

// Parsed on first use, not at import: `next build` imports route modules without a runtime env.
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
