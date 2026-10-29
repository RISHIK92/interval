import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { GitHubAccounts } from "../ports";

// P2-W12-S01 (§5H, ADR-0024): a user's GitHub connection: who they are on GitHub and
// which of the App's installations they can reach. Disconnecting deletes it all.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

export function kyselyGitHub(db: Kysely<DB>): GitHubAccounts {
  return {
    connect: (userId, account, installations, reachable) =>
      inTransaction(db, async (trx) => {
        // The GitHub account was someone else's connection: it moves here, and what
        // was read for them goes with it.
        await trx
          .deleteFrom("github_account")
          .where("github_user_id", "=", account.githubUserId)
          .where("user_id", "<>", userId)
          .execute();
        await trx
          .insertInto("github_account")
          .values({
            user_id: userId,
            github_user_id: account.githubUserId,
            login: account.login,
          })
          .onConflict((oc) =>
            oc.column("user_id").doUpdateSet({
              github_user_id: account.githubUserId,
              login: account.login,
              connected_at: new Date(),
            }),
          )
          .execute();
        await trx
          .deleteFrom("github_installation")
          .where("user_id", "=", userId)
          .execute();
        await trx
          .deleteFrom("github_reachable_repository")
          .where("user_id", "=", userId)
          .execute();
        // S02: what was read under the old access goes; Profile says it's reading
        // until the queued read lands.
        await trx
          .deleteFrom("github_repository")
          .where("user_id", "=", userId)
          .execute();
        await trx
          .updateTable("github_account")
          .set({ synced_at: null })
          .where("user_id", "=", userId)
          .execute();
        const rows = Object.entries(reachable).flatMap(
          ([installationId, ids]) =>
            ids.map((repoId) => ({
              user_id: userId,
              installation_id: installationId,
              repo_id: repoId,
            })),
        );
        if (rows.length > 0)
          await trx
            .insertInto("github_reachable_repository")
            .values(rows)
            .execute();
        if (installations.length > 0)
          await trx
            .insertInto("github_installation")
            .values(
              installations.map((i) => ({
                user_id: userId,
                installation_id: i.installationId,
                account_login: i.accountLogin,
                account_type: i.accountType,
              })),
            )
            .execute();
      }),

    disconnect: async (userId) => {
      // One statement, so both happen or neither. ADR-0027: an explanation that
      // names the user's repositories goes at once; the recompute the disconnect
      // queues writes it again without them.
      const result = await sql<{ gone: number }>`
        with gone as (
          delete from github_account where user_id = ${userId} returning user_id
        ), cleared as (
          update user_feed_entry set reasons = null, reason_kinds = '{}'
          where user_id in (select user_id from gone)
            and 'project_match' = any(reason_kinds)
        )
        select count(*)::int as gone from gone
      `.execute(db);
      return (result.rows[0]?.gone ?? 0) > 0;
    },

    get: async (userId) => {
      const account = await db
        .selectFrom("github_account")
        .select([
          "login",
          "connected_at",
          sql<
            number | null
          >`floor(extract(epoch from now() - synced_at) / 60)::int`.as(
            "synced_minutes_ago",
          ),
        ])
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (account === undefined) return null;
      const installations = await db
        .selectFrom("github_installation")
        .select(["installation_id", "account_login", "account_type"])
        .where("user_id", "=", userId)
        .orderBy("account_type", "desc") // the user's own account first
        .orderBy("account_login")
        .execute();
      const repositories = await db
        .selectFrom("github_repository as r")
        .select([
          "r.full_name",
          "r.languages",
          sql<number>`(select count(*)::int from github_dependency d
            where d.user_id = r.user_id and d.repo_id = r.repo_id)`.as(
            "dependencies",
          ),
          sql<string[]>`array(
            select distinct t.name from github_dependency_technology dt
            join technology t on t.id = dt.technology_id
            where dt.user_id = r.user_id and dt.repo_id = r.repo_id
            order by t.name)`.as("technologies"),
        ])
        .where("r.user_id", "=", userId)
        .orderBy("r.pushed_at", "desc")
        .orderBy("r.full_name")
        .execute();
      return {
        login: account.login,
        connectedAt: account.connected_at,
        syncedMinutesAgo: account.synced_minutes_ago,
        repositories: repositories.map((r) => ({
          fullName: r.full_name,
          languages: r.languages,
          dependencies: r.dependencies,
          technologies: r.technologies,
        })),
        installations: installations.map((i) => ({
          installationId: i.installation_id,
          accountLogin: i.account_login,
          accountType:
            i.account_type === "Organization" ? "Organization" : "User",
        })),
      };
    },
  };
}
