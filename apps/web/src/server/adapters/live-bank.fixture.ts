import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import type { Transaction } from "kysely";

// Tests that need a whole match or sprint of live multiple-choice questions seed them
// here: a fresh database (CI) has none, so leaning on whatever a local one holds hid
// failures. ADR-0058: all on one article of a full-text source, as the worker drafts
// them.
export async function seedLiveQuestions(
  trx: Transaction<DB>,
  count: number,
): Promise<string[]> {
  const tag = randomUUID();
  const source = await trx
    .insertInto("source")
    .values({
      name: `bank-${tag}`,
      feed_url: `https://bank.example.test/${tag}.xml`,
      rights_profile: "full_text_internal",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const item = await trx
    .insertInto("content_item")
    .values({
      source_id: source.id,
      guid: tag,
      canonical_url: `https://bank.example.test/${tag}`,
      title: "Bank",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const question = await trx
      .insertInto("question")
      .values({
        content_item_id: item.id,
        article_ordinal: n,
        ordinal: n,
        stem: `Bank ${String(n)}?`,
        options: ["right", "w1", "w2", "w3"],
        correct: 0,
        citation: "a b c",
        status: "live",
        generator_model: "m",
        prompt_version: 1,
        content_hash: "h",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ids.push(question.id);
  }
  return ids;
}
