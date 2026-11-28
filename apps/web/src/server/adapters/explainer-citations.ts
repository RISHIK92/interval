import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import { z } from "zod";

// An explainer's citations (AI-3), as the listening queue and the owner's review read
// them. ADR-0058: a citation names its article (content_item_id), as the worker now
// writes it and stage A backfilled; one written before, whose moment was already gone
// then, has only its moment_id, and counts while that moment still names an article.
const Id = z.union([z.number(), z.string()]).transform(String);
const Cited = z.array(
  z.object({ content_item_id: Id.optional(), moment_id: Id.optional() }),
);

export type CitedArticle = { itemId: string; title: string; link: string };

// Each row's cited articles in citation order, once each, and how many of its
// citations name no article any more.
export async function citedArticles(
  db: Kysely<DB>,
  rows: unknown[],
): Promise<{ articles: CitedArticle[]; missing: number }[]> {
  const parsed = rows.map((raw) => Cited.parse(raw));
  const momentIds = [
    ...new Set(
      parsed.flatMap((cs) =>
        cs.flatMap((c) =>
          c.content_item_id === undefined && c.moment_id !== undefined
            ? [c.moment_id]
            : [],
        ),
      ),
    ),
  ];
  const ofMoment = new Map(
    (momentIds.length === 0
      ? []
      : await db
          .selectFrom("moment")
          .select(["id", "content_item_id"])
          .where("id", "in", momentIds)
          .execute()
    ).map((m) => [m.id, m.content_item_id]),
  );
  const itemOf = (c: (typeof parsed)[number][number]) =>
    c.content_item_id ??
    (c.moment_id === undefined ? undefined : ofMoment.get(c.moment_id));
  const itemIds = [
    ...new Set(
      parsed.flatMap((cs) =>
        cs.flatMap((c) => {
          const id = itemOf(c);
          return id === undefined ? [] : [id];
        }),
      ),
    ),
  ];
  const items = new Map(
    (itemIds.length === 0
      ? []
      : await db
          .selectFrom("content_item")
          .select(["id", "title", "canonical_url"])
          .where("id", "in", itemIds)
          .execute()
    ).map((i) => [i.id, i]),
  );
  return parsed.map((cs) => {
    const articles = new Map<string, CitedArticle>();
    let missing = 0;
    for (const c of cs) {
      const id = itemOf(c);
      const item = id === undefined ? undefined : items.get(id);
      if (item === undefined) missing += 1;
      else
        articles.set(item.id, {
          itemId: item.id,
          title: item.title,
          link: item.canonical_url,
        });
    }
    return { articles: [...articles.values()], missing };
  });
}
