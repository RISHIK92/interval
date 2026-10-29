import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminTechnologies } from "./kysely-admin-technologies";

// P2-W12-S03 (PER-4, AI-3): the owner accepts or rejects suggested technologies.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = {
  admin: string;
  pkg: string;
  suggestion: string;
  concept: string;
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `TECH${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const admin = randomUUID();
      await trx
        .insertInto("app_user")
        .values({
          id: admin,
          name: "n",
          email: `${admin}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      const concept = `t-${randomUUID().slice(0, 8)}`;
      await trx
        .insertInto("concept")
        .values({ slug: concept, name: "Query builders", topic: "databases" })
        .execute();
      // A connected user whose repository uses the package.
      await trx
        .insertInto("github_account")
        .values({
          user_id: admin,
          github_user_id: String(Date.now()),
          login: "o",
        })
        .execute();
      await trx
        .insertInto("github_repository")
        .values({
          user_id: admin,
          repo_id: "1",
          installation_id: "1",
          full_name: "o/api",
          default_branch: "main",
        })
        .execute();
      const pkg = `zz-knex-${randomUUID().slice(0, 6)}`;
      await trx
        .insertInto("github_dependency")
        .values({
          user_id: admin,
          repo_id: "1",
          ecosystem: "npm",
          name: pkg,
          path: "package.json",
        })
        .execute();
      const suggestion = await trx
        .insertInto("technology_suggestion")
        .values({
          ecosystem: "npm",
          package: pkg,
          users: 1,
          name: "Knex",
          slug: `knex-${randomUUID().slice(0, 6)}`,
          concepts: [concept, "no-such-concept"],
          model: "m",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await body(trx, { admin, pkg, suggestion: suggestion.id, concept });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const resolves = async (trx: Transaction<DB>, pkg: string) =>
  (
    await trx
      .selectFrom("github_dependency_technology")
      .select("technology_id")
      .where("name", "=", pkg)
      .execute()
  ).length;

test("pending suggestions name their concepts; the package shows as unclaimed", async () => {
  await inRollback(async (trx, { pkg, concept }) => {
    const admin = kyselyAdminTechnologies(trx);
    const mine = (await admin.pending()).find((s) => s.package === pkg);
    expect(mine).toMatchObject({
      ecosystem: "npm",
      name: "Knex",
      users: 1,
      concepts: [{ slug: concept, name: "Query builders" }], // unknown slugs left out
    });
    expect((await admin.unclaimed(1000)).map((u) => u.package)).toContain(pkg);
    const coverage = await admin.coverage();
    expect(coverage.dependencies).toBeGreaterThanOrEqual(coverage.resolved);
  });
});

test("accepting creates the technology, its package and concepts, and the dependency resolves", async () => {
  await inRollback(
    async (trx, { admin: adminId, pkg, suggestion, concept }) => {
      const admin = kyselyAdminTechnologies(trx);
      expect(await resolves(trx, pkg)).toBe(0);
      expect(await admin.accept(suggestion, adminId)).toBe("accepted");
      expect(await admin.accept(suggestion, adminId)).toBe("decided");
      expect(await resolves(trx, pkg)).toBe(1);
      const tech = await trx
        .selectFrom("technology as t")
        .innerJoin("technology_package as p", "p.technology_id", "t.id")
        .select([
          "t.source",
          "p.pattern",
          "p.prefix",
          sql<string[]>`array(select c.slug from technology_concept tc
          join concept c on c.id = tc.concept_id where tc.technology_id = t.id)`.as(
            "concepts",
          ),
        ])
        .where("p.pattern", "=", pkg)
        .executeTakeFirstOrThrow();
      expect(tech).toEqual({
        source: "suggestion",
        pattern: pkg,
        prefix: false,
        concepts: [concept],
      });
      expect((await admin.pending()).some((s) => s.package === pkg)).toBe(
        false,
      );
    },
  );
});

test("rejecting keeps the suggestion, so the package isn't asked about again", async () => {
  await inRollback(async (trx, { admin: adminId, pkg, suggestion }) => {
    const admin = kyselyAdminTechnologies(trx);
    expect(await admin.reject(suggestion, adminId)).toBe(true);
    expect(await admin.reject(suggestion, adminId)).toBe(false);
    const row = await trx
      .selectFrom("technology_suggestion")
      .select(["status", "decided_by"])
      .where("id", "=", suggestion)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "rejected", decided_by: adminId });
    expect(await resolves(trx, pkg)).toBe(0);
  });
});

test("accepting onto a retired slug, or a package claimed since, changes nothing", async () => {
  await inRollback(async (trx, { admin: adminId, pkg, suggestion }) => {
    const admin = kyselyAdminTechnologies(trx);
    const { slug } = await trx
      .selectFrom("technology_suggestion")
      .select("slug")
      .where("id", "=", suggestion)
      .executeTakeFirstOrThrow();
    const retired = await trx
      .insertInto("technology")
      .values({
        slug: slug ?? "",
        name: "Old",
        source: "seed",
        retired_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(await admin.accept(suggestion, adminId)).toBe("conflict");
    await trx
      .updateTable("technology")
      .set({ slug: `${slug ?? ""}-old` })
      .where("id", "=", retired.id)
      .execute();
    // The seed claimed the package meanwhile.
    const seed = await trx
      .insertInto("technology")
      .values({ slug: `seed-${pkg}`, name: "Seed", source: "seed" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("technology_package")
      .values({
        ecosystem: "npm",
        pattern: pkg,
        prefix: false,
        technology_id: seed.id,
        origin: "seed",
      })
      .execute();
    expect(await admin.accept(suggestion, adminId)).toBe("conflict");
    const made = await trx
      .selectFrom("technology")
      .select("id")
      .where("slug", "=", slug ?? "")
      .execute();
    expect(made).toEqual([]); // the technology made for it was undone
    const { status } = await trx
      .selectFrom("technology_suggestion")
      .select("status")
      .where("id", "=", suggestion)
      .executeTakeFirstOrThrow();
    expect(status).toBe("pending");
  });
});
