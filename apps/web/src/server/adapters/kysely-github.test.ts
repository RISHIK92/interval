import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyGitHub } from "./kysely-github";

// P2-W12-S01 (§5H, ADR-0024): a user's GitHub connection.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>, users: [string, string]) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `GH${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 2,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const users: [string, string] = [randomUUID(), randomUUID()];
      for (const id of users)
        await trx
          .insertInto("app_user")
          .values({
            id,
            name: "n",
            email: `${id}@example.test`,
            beta_group: "student",
            invite_code_id: code.id,
          })
          .execute();
      await body(trx, users);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const mine = {
  installationId: "11",
  accountLogin: "octo",
  accountType: "User" as const,
};
const org = {
  installationId: "12",
  accountLogin: "acme",
  accountType: "Organization" as const,
};
const octo = {
  githubUserId: String(900_000 + Math.floor(Math.random() * 1e5)),
  login: "octo",
};

test("connecting stores the account and its installations; connecting again replaces them", async () => {
  await inRollback(async (trx, [me]) => {
    const github = kyselyGitHub(trx);
    expect(await github.get(me)).toBeNull();
    await github.connect(me, octo, [org, mine], {});
    expect(await github.get(me)).toMatchObject({
      login: "octo",
      installations: [mine, org],
    });
    await github.connect(me, { ...octo, login: "octo2" }, [org], {});
    expect(await github.get(me)).toMatchObject({
      login: "octo2",
      installations: [org],
    });
  });
});

test("a GitHub account connected to another user moves; disconnect removes everything", async () => {
  await inRollback(async (trx, [me, other]) => {
    const github = kyselyGitHub(trx);
    await github.connect(other, octo, [mine], {});
    await github.connect(me, octo, [mine], {});
    expect(await github.get(other)).toBeNull();
    expect((await github.get(me))?.installations).toEqual([mine]);
    expect(await github.disconnect(me)).toBe(true);
    expect(await github.disconnect(me)).toBe(false);
    expect(await github.get(me)).toBeNull();
    const left = await trx
      .selectFrom("github_installation")
      .select("installation_id")
      .where("user_id", "=", me)
      .execute();
    expect(left).toEqual([]);
  });
});

test("a deleted account takes its GitHub connection with it", async () => {
  await inRollback(async (trx, [me]) => {
    const github = kyselyGitHub(trx);
    await github.connect(me, octo, [mine], {});
    await trx.deleteFrom("app_user").where("id", "=", me).execute();
    const rows = await trx
      .selectFrom("github_account")
      .select("user_id")
      .where("github_user_id", "=", octo.githubUserId)
      .execute();
    expect(rows).toEqual([]);
  });
});

// P2-W12-S02: an organisation's reachable repositories, and what the worker read.
test("reachable repositories are stored per organisation installation and replaced", async () => {
  await inRollback(async (trx, [me]) => {
    const github = kyselyGitHub(trx);
    await github.connect(me, octo, [mine, org], { "12": ["21", "22"] });
    const reachable = async () =>
      (
        await trx
          .selectFrom("github_reachable_repository")
          .select(["installation_id", "repo_id"])
          .where("user_id", "=", me)
          .orderBy("repo_id")
          .execute()
      ).map((r) => [r.installation_id, r.repo_id]);
    expect(await reachable()).toEqual([
      ["12", "21"],
      ["12", "22"],
    ]);
    await github.connect(me, octo, [mine, org], { "12": ["23"] });
    expect(await reachable()).toEqual([["12", "23"]]);
  });
});

test("the connection carries what the worker last read", async () => {
  await inRollback(async (trx, [me]) => {
    const github = kyselyGitHub(trx);
    await github.connect(me, octo, [mine], {});
    expect(await github.get(me)).toMatchObject({
      syncedMinutesAgo: null,
      repositories: [],
    });
    await trx
      .insertInto("github_repository")
      .values({
        user_id: me,
        repo_id: "1",
        installation_id: "11",
        full_name: "octo/api",
        languages: ["TypeScript", "Go"],
        default_branch: "main",
      })
      .execute();
    // A package no seed claims, so the dev database's seed can't resolve it first.
    const pkg = `zz-${me.slice(0, 8)}`;
    const { id } = await trx
      .insertInto("technology")
      .values({
        slug: `t-${me.slice(0, 8).toLowerCase()}`,
        name: "Tech",
        source: "seed",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("technology_package")
      .values({
        ecosystem: "npm",
        pattern: pkg,
        technology_id: id,
        origin: "seed",
      })
      .execute();
    await trx
      .insertInto("github_dependency")
      .values(
        [pkg, "vitest"].map((name) => ({
          user_id: me,
          repo_id: "1",
          ecosystem: "npm" as const,
          name,
          path: "package.json",
        })),
      )
      .execute();
    await trx
      .updateTable("github_account")
      .set({ synced_at: sql<Date>`now()` })
      .where("user_id", "=", me)
      .execute();
    const connection = await github.get(me);
    expect(connection?.syncedMinutesAgo).toBe(0);
    expect(connection?.repositories).toEqual([
      {
        fullName: "octo/api",
        languages: ["TypeScript", "Go"],
        dependencies: 2,
        technologies: ["Tech"],
      },
    ]);
  });
});

test("a fresh connect clears what was read under the old access", async () => {
  await inRollback(async (trx, [me]) => {
    const github = kyselyGitHub(trx);
    await github.connect(me, octo, [mine], {});
    await trx
      .insertInto("github_repository")
      .values({
        user_id: me,
        repo_id: "1",
        installation_id: "11",
        full_name: "octo/api",
        default_branch: "main",
      })
      .execute();
    await trx
      .updateTable("github_account")
      .set({ synced_at: sql<Date>`now()` })
      .where("user_id", "=", me)
      .execute();
    await github.connect(me, octo, [mine], {});
    expect(await github.get(me)).toMatchObject({
      syncedMinutesAgo: null,
      repositories: [],
    });
  });
});
