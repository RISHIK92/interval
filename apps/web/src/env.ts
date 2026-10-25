import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  NODE_ENV: z.enum(["development", "test", "production"]),
  // Better Auth (ADR-0004): signs session cookies; at least 32 random characters.
  BETTER_AUTH_SECRET: z.string().min(32),
  // The public origin, e.g. https://interval.example.com.
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
});

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
