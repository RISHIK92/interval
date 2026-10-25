-- migrate:up
-- The admin review page (ING-6, Q-P1-29, P1-W3-S05): an admin's corrections to section
-- boundaries and tags. Kept apart from the model's tags (AI-3) and keyed by heading
-- text, never by moment id, so they survive re-ingestion and re-segmentation.

-- Moments start at exactly these headings (the intro is always its own moment), in
-- place of the 2-8 minute rules. Section headings may be shown (Q-P1-01).
create table moment_boundary_override (
  content_item_id bigint primary key references content_item (id) on delete cascade,
  headings text[] not null check (cardinality(headings) >= 1),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

-- Replaces the model's tags for the item ('' heading) or for the moment that starts
-- at a heading. Concepts are slugs: concepts are never deleted, so slugs stay valid.
create table tag_override (
  content_item_id bigint not null references content_item (id) on delete cascade,
  heading text not null,
  difficulty difficulty not null,
  concepts text[] not null check (cardinality(concepts) <= 5),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (content_item_id, heading)
);

-- migrate:down
drop table tag_override;
drop table moment_boundary_override;
