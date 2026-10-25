-- migrate:up
-- One embedding per moment (DB-3, AI-4, P1-W3-S04), in pgvector so a similarity search
-- can filter by rights, source and difficulty in the same query. Moments exist only
-- under internal full-text rights and are purged when a profile is lowered (ING-2), so
-- embeddings, which cascade from them, follow the same rule.
--
-- 1024 dimensions: the default of the Voyage models the eval compares (voyage-3.5,
-- 3.5-lite, 3-large). The dimension is fixed here; another one means re-embedding
-- (Q-P1-27).
create table moment_embedding (
  moment_id bigint primary key references moment (id) on delete cascade,
  model text not null,
  embedding vector(1024) not null,
  embedded_at timestamptz not null default now()
);

create index moment_embedding_cosine on moment_embedding
  using hnsw (embedding vector_cosine_ops);

-- One row per item embedded in full by a model (AI-4: once). A moment with no text to
-- embed would otherwise make the item look unfinished on every poll.
create table item_embedding (
  content_item_id bigint not null references content_item (id) on delete cascade,
  model text not null,
  embedded_at timestamptz not null default now(),
  primary key (content_item_id, model)
);

-- migrate:down
drop table item_embedding;
drop table moment_embedding;
