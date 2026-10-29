import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminTechnologies } from "../ports";

// P2-W12-S03 (PER-4, AI-3): the owner's review of suggested technologies. What an
// acceptance adds is marked origin 'suggestion', which a seed reload leaves alone.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

export function kyselyAdminTechnologies(db: Kysely<DB>): AdminTechnologies {
  return {
    pending: async () => {
      const rows = await db
        .selectFrom("technology_suggestion as s")
        .select([
          "s.id",
          "s.ecosystem",
          "s.package",
          "s.users",
          "s.name",
          "s.slug",
          "s.model",
          // Only concepts that exist and are live; the order the model gave them.
          sql<{ slug: string; name: string }[]>`coalesce((
            select json_agg(json_build_object('slug', c.slug, 'name', c.name)
              order by array_position(s.concepts, c.slug))
            from concept c
            where c.slug = any(s.concepts) and c.retired_at is null), '[]')`.as(
            "concepts",
          ),
        ])
        .where("s.status", "=", "pending")
        .orderBy("s.users", "desc")
        .orderBy("s.created_at")
        .execute();
      return rows.flatMap((r) =>
        r.name === null || r.slug === null
          ? []
          : [
              {
                id: r.id,
                ecosystem: r.ecosystem,
                package: r.package,
                users: r.users,
                name: r.name,
                slug: r.slug,
                concepts: r.concepts,
                model: r.model,
              },
            ],
      );
    },

    unclaimed: async (limit) =>
      // A view's columns read as nullable; its rows never have nulls.
      (
        await db
          .selectFrom("unclaimed_dependency")
          .select(["ecosystem", "package", "users"])
          .orderBy("users", "desc")
          .orderBy("ecosystem")
          .orderBy("package")
          .limit(limit)
          .execute()
      ).flatMap((r) =>
        r.ecosystem === null || r.package === null || r.users === null
          ? []
          : [{ ecosystem: r.ecosystem, package: r.package, users: r.users }],
      ),

    coverage: async () => {
      const { rows } = await sql<{
        technologies: number;
        packages: number;
        dependencies: number;
        resolved: number;
      }>`
        select
          (select count(*)::int from technology where retired_at is null)
            as technologies,
          (select count(*)::int from technology_package p
            join technology t on t.id = p.technology_id and t.retired_at is null)
            as packages,
          (select count(distinct (ecosystem, name))::int from github_dependency)
            as dependencies,
          (select count(distinct (ecosystem, name))::int
            from github_dependency_technology) as resolved
      `.execute(db);
      const [row] = rows;
      if (row === undefined) throw new Error("coverage: no row");
      return row;
    },

    accept: (suggestionId, adminUserId) =>
      inTransaction(db, async (trx) => {
        const suggestion = await trx
          .selectFrom("technology_suggestion")
          .select(["ecosystem", "package", "name", "slug", "concepts"])
          .where("id", "=", suggestionId)
          .where("status", "=", "pending")
          .forUpdate()
          .executeTakeFirst();
        if (suggestion?.name == null || suggestion.slug == null)
          return "decided";
        const existing = await trx
          .selectFrom("technology")
          .select(["id", "retired_at"])
          .where("slug", "=", suggestion.slug)
          .executeTakeFirst();
        // A retired slug is never reused (the seed's rule).
        if (existing?.retired_at != null) return "conflict";
        const techId =
          existing?.id ??
          (
            await trx
              .insertInto("technology")
              .values({
                slug: suggestion.slug,
                name: suggestion.name,
                source: "suggestion",
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;
        // Something claims the package now (the seed, since): left as it is.
        const added = await trx
          .insertInto("technology_package")
          .values({
            ecosystem: suggestion.ecosystem,
            pattern: suggestion.package,
            prefix: false,
            technology_id: techId,
            origin: "suggestion",
          })
          .onConflict((oc) => oc.doNothing())
          .returning("pattern")
          .executeTakeFirst();
        if (added === undefined) {
          // Undo a technology made just now for it.
          if (existing === undefined)
            await trx
              .deleteFrom("technology")
              .where("id", "=", techId)
              .execute();
          return "conflict";
        }
        await sql`
          insert into technology_concept (technology_id, concept_id, origin)
          select ${techId}, c.id, 'suggestion' from concept c
          where c.slug = any(${suggestion.concepts}) and c.retired_at is null
          on conflict do nothing
        `.execute(trx);
        await trx
          .updateTable("technology_suggestion")
          .set({
            status: "accepted",
            decided_by: adminUserId,
            decided_at: sql<Date>`now()`,
          })
          .where("id", "=", suggestionId)
          .execute();
        return "accepted";
      }),

    reject: async (suggestionId, adminUserId) => {
      const decided = await db
        .updateTable("technology_suggestion")
        .set({
          status: "rejected",
          decided_by: adminUserId,
          decided_at: sql<Date>`now()`,
        })
        .where("id", "=", suggestionId)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return decided.numUpdatedRows > 0n;
    },
  };
}
