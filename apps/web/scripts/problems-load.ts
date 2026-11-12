// P5-W31-S01 (LLDQ-4, DB-6): loads problems/lld/* into Postgres and the private bucket.
// Every problem is parsed and checked before any is loaded; an unchanged one is
// skipped, and one gone from disk is retired. Same env as the web: DATABASE_URL and the
// private bucket's (S3_ENDPOINT locally and on the VM).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Expected, Problem } from "@interval/lld";
import { filesEnv } from "../src/env";
import { createDb } from "../src/server/adapters/kysely";
import { kyselyProblemStore } from "../src/server/adapters/kysely-problems";
import { s3Files } from "../src/server/adapters/s3-files";
import { type ProblemSource, loadProblems } from "../src/server/problems";

const url = process.env["DATABASE_URL"];
if (url === undefined) {
  console.error("DATABASE_URL is not set; copy .env.example to .env");
  process.exit(1);
}
const root = join(import.meta.dirname, "../../../problems/lld");
const sources: ProblemSource[] = readdirSync(root)
  .filter((slug) => !slug.startsWith("."))
  .sort()
  .map((slug) => {
    const read = (name: string) => readFileSync(join(root, slug, name), "utf8");
    const problem = Problem.parse(JSON.parse(read("problem.json")));
    if (problem.slug !== slug)
      throw new Error(
        `problems/lld/${slug}: problem.json says "${problem.slug}"`,
      );
    return {
      problem,
      statement: read("statement.md"),
      expected: Expected.parse(JSON.parse(read("expected.json"))),
    };
  });
const config = filesEnv();
const files = s3Files(
  new S3Client({
    region: config.AWS_REGION,
    ...(config.S3_ENDPOINT === undefined
      ? {}
      : { endpoint: config.S3_ENDPOINT, forcePathStyle: true }),
  }),
  config.PRIVATE_CONTENT_BUCKET,
);
// The owner runs this against the real database at release: name the target first.
console.log(
  `loading ${String(sources.length)} problems into ${new URL(url).host} and bucket ${config.PRIVATE_CONTENT_BUCKET}`,
);
const db = createDb(url);
try {
  const report = await loadProblems(sources, {
    store: kyselyProblemStore(db),
    files,
  });
  console.log(JSON.stringify(report));
} finally {
  await db.destroy();
}
