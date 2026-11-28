import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import { z } from "zod";

// An explainer's citations (AI-3), as the listening queue and the owner's review read
// them. Each names its article (content_item_id); one whose article was gone before
// ADR-0058 folded the moments into their articles names none.
const Id = z.union([z.number(), z.string()]).transform(String);
const Cited = z.array(z.object({ content_item_id: Id.optional() }));

export type CitedArticle = { itemId: string; title: string; link: string };

// Each row's cited articles in citation order, once each, and how many of its
// citations name no article any more.
export async function citedArticles(
  db: Kysely<DB>,
  rows: unknown[],
): Promise<{ articles: CitedArticle[]; missing: number }[]> {
  const parsed = rows.map((raw) => Cited.parse(raw));
  const itemIds = [
    ...new Set(
      parsed.flatMap((cs) =>
        cs.flatMap((c) =>
          c.content_item_id === undefined ? [] : [c.content_item_id],
        ),
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
      const id = c.content_item_id;
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
