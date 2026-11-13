SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: ai_feature; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_feature AS ENUM (
    'tagging',
    'notes',
    'embeddings',
    'concept_drafting',
    'questions',
    'paths',
    'technologies',
    'project_notes',
    'explainer',
    'tts',
    'scenes'
);


--
-- Name: ai_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_provider AS ENUM (
    'openrouter',
    'voyage',
    'groq',
    'google',
    'elevenlabs',
    'inworld',
    'polly'
);


--
-- Name: beta_group; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beta_group AS ENUM (
    'student',
    'developer'
);


--
-- Name: book_checkpoint_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.book_checkpoint_status AS ENUM (
    'preparing',
    'ready',
    'failed'
);


--
-- Name: book_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.book_status AS ENUM (
    'processing',
    'ocr',
    'ready',
    'failed'
);


--
-- Name: break_length; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.break_length AS ENUM (
    '1-3',
    '3-8',
    '8-15'
);


--
-- Name: capability; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.capability AS ENUM (
    'feed.read',
    'admin.review',
    'ai.notes.daily',
    'ai.budget.daily_cents',
    'books.count',
    'books.max_mb',
    'books.max_pages',
    'play.daily',
    'play.sprint',
    'play.estimation',
    'play.live',
    'agent.hook',
    'push.notify',
    'play.battle'
);


--
-- Name: concept_edge_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.concept_edge_type AS ENUM (
    'prerequisite_of',
    'related_to',
    'applied_in'
);


--
-- Name: dependency_ecosystem; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dependency_ecosystem AS ENUM (
    'npm',
    'pypi',
    'go'
);


--
-- Name: difficulty; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.difficulty AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);


--
-- Name: explainer_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.explainer_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: feedback_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.feedback_kind AS ENUM (
    'more_like_this',
    'less_like_this',
    'not_interested'
);


--
-- Name: finish_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.finish_method AS ENUM (
    'return_prompt',
    'mark_done',
    'auto'
);


--
-- Name: flag_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.flag_reason AS ENUM (
    'wrong_key',
    'unclear',
    'not_in_section',
    'other'
);


--
-- Name: learner_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.learner_state AS ENUM (
    'explored',
    'practiced',
    'mastered',
    'due_for_review'
);


--
-- Name: learning_goal; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.learning_goal AS ENUM (
    'system-design-interviews',
    'stack-i-use',
    'finish-that-book',
    'stay-sharp'
);


--
-- Name: lld_difficulty; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lld_difficulty AS ENUM (
    'easy',
    'medium',
    'hard'
);


--
-- Name: moment_link_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.moment_link_type AS ENUM (
    'anchor',
    'text_fragment',
    'page_top'
);


--
-- Name: path_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.path_status AS ENUM (
    'draft',
    'live',
    'retired'
);


--
-- Name: question_batch_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.question_batch_kind AS ENUM (
    'draft',
    'validate'
);


--
-- Name: question_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.question_kind AS ENUM (
    'choice',
    'estimate'
);


--
-- Name: question_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.question_status AS ENUM (
    'pending',
    'live',
    'rejected',
    'flagged',
    'retired'
);


--
-- Name: review_decision; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.review_decision AS ENUM (
    'keep',
    'retire'
);


--
-- Name: review_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.review_reason AS ENUM (
    'sample',
    'flagged',
    'anomaly',
    'daily'
);


--
-- Name: rights_profile; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rights_profile AS ENUM (
    'metadata_only',
    'excerpt',
    'full_text_internal',
    'full_text_display'
);


--
-- Name: suggestion_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.suggestion_status AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'skipped',
    'unreadable'
);


--
-- Name: technology_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.technology_source AS ENUM (
    'seed',
    'suggestion'
);


--
-- Name: topic; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.topic AS ENUM (
    'system-design',
    'databases',
    'distributed-systems',
    'backend'
);


--
-- Name: user_path_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_path_status AS ENUM (
    'active',
    'paused'
);


--
-- Name: daily_challenge_fit(date, public.question_kind, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_challenge_fit(p_day date, p_kind public.question_kind, p_except smallint) RETURNS bigint
    LANGUAGE sql
    AS $$
  select q.id
  from question q
  where q.status = 'live' and q.kind = p_kind
    and (
      (q.kind = 'estimate' and q.source_url is not null)
      or exists (
        select 1 from moment m
        join content_item ci on ci.id = m.content_item_id
        join source s on s.id = ci.source_id
         and s.moments_enabled
         and s.rights_profile in ('full_text_internal', 'full_text_display')
        where m.id = q.moment_id
          and (q.kind = 'choice' or ci.link_broken_at is null)
      )
    )
    and not exists (
      select 1 from daily_challenge_question d
      where d.question_id = q.id and d.day between p_day - 30 and p_day + 30
    )
    -- 5 different concepts: none the day's other questions test.
    and not exists (
      select 1 from daily_challenge_question d
      join question_concept other on other.question_id = d.question_id
      join question_concept mine on mine.concept_id = other.concept_id
      where d.day = p_day and d.position is distinct from p_except
        and mine.question_id = q.id
    )
  order by case when q.difficulty = 'intermediate' then 0
                when q.difficulty is null then 1 else 2 end,
           random()
  limit 1
$$;


--
-- Name: daily_challenge_pick(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_challenge_pick(p_day date) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare
  want question_kind;
  found_id bigint;
  pos smallint := 0;
begin
  insert into daily_challenge (day) values (p_day) on conflict do nothing;
  if not found then
    return false;
  end if;
  foreach want in array array['choice', 'choice', 'choice', 'estimate', 'estimate']::question_kind[]
  loop
    found_id := coalesce(
      daily_challenge_fit(p_day, want, null),
      case when want = 'estimate' then daily_challenge_fit(p_day, 'choice', null) end
    );
    if found_id is not null then
      insert into daily_challenge_question (day, position, question_id)
      values (p_day, pos, found_id);
      pos := pos + 1;
    end if;
  end loop;
  return true;
end
$$;


--
-- Name: daily_challenge_swap(date, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_challenge_swap(p_day date, p_position smallint) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare
  slot_kind question_kind;
  found_id bigint;
begin
  if p_day <= (now() at time zone 'utc')::date then
    return false;
  end if;
  -- One swap at a time per day, so two at once never pick the same question.
  perform 1 from daily_challenge where day = p_day for update;
  select q.kind into slot_kind
  from daily_challenge_question d
  join question q on q.id = d.question_id
  where d.day = p_day and d.position = p_position
  for update of d;
  if not found then
    return false;
  end if;
  found_id := daily_challenge_fit(p_day, slot_kind, p_position);
  if found_id is null then
    return false;
  end if;
  update daily_challenge_question set question_id = found_id
  where day = p_day and position = p_position;
  return true;
end
$$;


--
-- Name: enforce_excerpt_rights(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_excerpt_rights() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  profile rights_profile;
begin
  if new.excerpt is null then
    return new;
  end if;
  select rights_profile into profile from source where id = new.source_id;
  if profile <> 'excerpt' then
    raise exception 'rights profile % does not allow storing an excerpt', profile;
  end if;
  return new;
end;
$$;


--
-- Name: enforce_moment_rights(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_moment_rights() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  profile rights_profile;
  enabled boolean;
begin
  select s.rights_profile, s.moments_enabled into profile, enabled
  from content_item ci join source s on s.id = ci.source_id
  where ci.id = new.content_item_id;
  if not enabled or profile not in ('full_text_internal', 'full_text_display') then
    raise exception 'source (profile %, moments_enabled %) does not allow moments',
      profile, enabled;
  end if;
  return new;
end;
$$;


--
-- Name: enforce_private_text_rights(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_private_text_rights() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  profile rights_profile;
begin
  select s.rights_profile into profile
  from content_item ci join source s on s.id = ci.source_id
  where ci.id = new.content_item_id;
  if profile not in ('full_text_internal', 'full_text_display') then
    raise exception 'rights profile % does not allow storing full text', profile;
  end if;
  return new;
end;
$$;


--
-- Name: enforce_simhash_rights(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_simhash_rights() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  profile rights_profile;
begin
  if new.simhash is null then
    return new;
  end if;
  select rights_profile into profile from source where id = new.source_id;
  if profile not in ('full_text_internal', 'full_text_display') then
    raise exception 'rights profile % does not allow a simhash', profile;
  end if;
  return new;
end;
$$;


--
-- Name: item_minutes(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_minutes(item bigint) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  -- At least a minute, as segment.minutes counts; greatest() would turn null into 1.
  select case when count(*) = 0 then null
              else greatest(1, ceil(sum(word_count) / 230.0))::integer end
  from content_item_section where content_item_id = item
$$;


--
-- Name: item_title_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_title_key(title text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN lower(btrim(regexp_replace(title, '\s+'::text, ' '::text, 'g'::text)));


--
-- Name: normalize_invite_code(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_invite_code(raw text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    RETURN upper(regexp_replace(raw, '[\s-]'::text, ''::text, 'g'::text));


--
-- Name: purge_text_beyond_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_text_beyond_profile() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from content_item_private_text pt
    using content_item ci
    where pt.content_item_id = ci.id and ci.source_id = new.id;
    delete from content_item_section cs
    using content_item ci
    where cs.content_item_id = ci.id and ci.source_id = new.id;
    update content_item set simhash = null
    where source_id = new.id and simhash is not null;
  end if;
  if new.rights_profile <> 'excerpt' then
    update content_item set excerpt = null
    where source_id = new.id and excerpt is not null;
  end if;
  if not new.moments_enabled
    or new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from moment m
    using content_item ci
    where m.content_item_id = ci.id and ci.source_id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: refuse_concept_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refuse_concept_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'concept % is retired, never deleted', old.slug;
end;
$$;


--
-- Name: refuse_limited_grant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refuse_limited_grant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if exists (
    select 1 from plan_capability
    where capability = new.capability and limit_value is not null
  ) then
    raise exception 'capability % has a limit; grant it through a plan', new.capability;
  end if;
  return new;
end;
$$;


--
-- Name: refuse_prerequisite_cycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refuse_prerequisite_cycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.type = 'prerequisite_of' and exists (
    with recursive reach(id) as (
      select new.to_id
      union
      select e.to_id from concept_edge e join reach r on e.from_id = r.id
      where e.type = 'prerequisite_of'
    )
    select 1 from reach where id = new.from_id
  ) then
    raise exception 'prerequisite cycle through concept %',
      (select slug from concept where id = new.from_id);
  end if;
  return new;
end;
$$;


--
-- Name: user_goal_concepts(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_goal_concepts(p_user_id text) RETURNS TABLE(concept_id bigint)
    LANGUAGE sql STABLE
    AS $$
  select c.id
  from user_preferences p
  cross join unnest(p.goals) g(goal)
  join goal_concept gc on gc.goal = g.goal
  join concept c on c.slug = gc.concept_slug and c.retired_at is null
  where p.user_id = p_user_id
  union
  select u.concept_id
  from user_preferences p
  cross join user_technology_concepts(p_user_id) u
  where p.user_id = p_user_id and 'stack-i-use' = any(p.goals)
$$;


--
-- Name: user_path_sessions(text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_path_sessions(p_user text, p_section bigint) RETURNS TABLE(ordinal smallint, moment_id bigint)
    LANGUAGE sql STABLE
    AS $$
  select ps.ordinal, coalesce(swapped.id, ps.moment_id) as moment_id
  from path_session ps
  left join lateral (
    select sm.id from user_path_session us
    join moment sm on sm.id = us.moment_id
    join content_item ci on ci.id = sm.content_item_id
    join source so on so.id = ci.source_id
    where us.user_id = p_user and us.section_id = ps.section_id
      and us.ordinal = ps.ordinal
      -- path-rights.ts ALLOWED
      and so.moments_enabled
      and so.rights_profile in ('full_text_internal', 'full_text_display')
      and ci.duplicate_of is null
  ) swapped on true
  where ps.section_id = p_section
$$;


--
-- Name: user_technology_concepts(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_technology_concepts(p_user_id text) RETURNS TABLE(technology_id bigint, technology text, concept_id bigint, repositories text[])
    LANGUAGE sql STABLE
    AS $$
  select t.id, t.name, tc.concept_id,
    array_agg(distinct r.full_name order by r.full_name)
  from github_dependency_technology dt
  join technology t on t.id = dt.technology_id
  join technology_concept tc on tc.technology_id = t.id
  join concept c on c.id = tc.concept_id and c.retired_at is null
  join github_repository r on r.user_id = dt.user_id and r.repo_id = dt.repo_id
  where dt.user_id = p_user_id
  group by t.id, t.name, tc.concept_id
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_device; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_device (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT agent_device_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 40))),
    CONSTRAINT agent_device_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: agent_place; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_place (
    user_id text NOT NULL,
    path text NOT NULL,
    saved_at timestamp with time zone NOT NULL,
    opened_at timestamp with time zone,
    CONSTRAINT agent_place_path_check CHECK (((path ~ '^/[^/]'::text) AND (char_length(path) <= 300)))
);


--
-- Name: agent_task; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_task (
    id bigint NOT NULL,
    device_id uuid NOT NULL,
    user_id text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    start_key text NOT NULL,
    finish_key text,
    CONSTRAINT agent_task_check CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
    CONSTRAINT agent_task_finish_key_check CHECK (((char_length(finish_key) >= 8) AND (char_length(finish_key) <= 100))),
    CONSTRAINT agent_task_start_key_check CHECK (((char_length(start_key) >= 8) AND (char_length(start_key) <= 100)))
);


--
-- Name: agent_task_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.agent_task ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.agent_task_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ai_budget; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_budget (
    scope text NOT NULL,
    daily_cents integer NOT NULL,
    CONSTRAINT ai_budget_daily_cents_check CHECK ((daily_cents >= 0)),
    CONSTRAINT ai_budget_scope_check CHECK ((scope = 'global'::text))
);


--
-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text,
    is_offline boolean NOT NULL,
    feature public.ai_feature NOT NULL,
    provider public.ai_provider NOT NULL,
    model text NOT NULL,
    input_tokens integer NOT NULL,
    output_tokens integer NOT NULL,
    cost_usd numeric(12,6) NOT NULL,
    CONSTRAINT ai_usage_check CHECK (((NOT is_offline) OR (user_id IS NULL))),
    CONSTRAINT ai_usage_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT ai_usage_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT ai_usage_output_tokens_check CHECK ((output_tokens >= 0))
);


--
-- Name: ai_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ai_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: app_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    is_anonymous boolean DEFAULT false NOT NULL,
    beta_group public.beta_group NOT NULL,
    invite_code_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    plan_id text DEFAULT 'beta'::text NOT NULL
);


--
-- Name: auth_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: auth_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_session (
    id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL
);


--
-- Name: auth_verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: board_score; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_score (
    attempt_id bigint NOT NULL,
    board text NOT NULL,
    score integer NOT NULL,
    CONSTRAINT board_score_score_check CHECK ((score >= 0))
);


--
-- Name: book; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book (
    id bigint NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    file_key text NOT NULL,
    size_bytes integer NOT NULL,
    status public.book_status DEFAULT 'processing'::public.book_status NOT NULL,
    failure text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    page_count integer,
    CONSTRAINT book_check CHECK (((status = 'failed'::public.book_status) = (failure IS NOT NULL))),
    CONSTRAINT book_page_count_check CHECK ((page_count > 0)),
    CONSTRAINT book_size_bytes_check CHECK ((size_bytes > 0)),
    CONSTRAINT book_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))
);


--
-- Name: book_chapter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_chapter (
    id bigint NOT NULL,
    book_id bigint NOT NULL,
    ordinal integer NOT NULL,
    title text NOT NULL,
    CONSTRAINT book_chapter_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT book_chapter_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))
);


--
-- Name: book_chapter_checkpoint; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_chapter_checkpoint (
    chapter_id bigint NOT NULL,
    status public.book_checkpoint_status DEFAULT 'preparing'::public.book_checkpoint_status NOT NULL,
    failure text,
    requests integer DEFAULT 1 NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone,
    CONSTRAINT book_chapter_checkpoint_check CHECK (((status = 'failed'::public.book_checkpoint_status) = (failure IS NOT NULL))),
    CONSTRAINT book_chapter_checkpoint_failure_check CHECK ((char_length(failure) <= 200)),
    CONSTRAINT book_chapter_checkpoint_requests_check CHECK ((requests >= 1))
);


--
-- Name: book_chapter_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_chapter_concept (
    chapter_id bigint NOT NULL,
    concept_id bigint NOT NULL
);


--
-- Name: book_chapter_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.book_chapter ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.book_chapter_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: book_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.book ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.book_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: book_page; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_page (
    book_id bigint NOT NULL,
    page_no integer NOT NULL,
    text text NOT NULL,
    scanned boolean NOT NULL,
    ocr_read_at timestamp with time zone,
    CONSTRAINT book_page_ocr_scanned CHECK (((ocr_read_at IS NULL) OR scanned)),
    CONSTRAINT book_page_page_no_check CHECK ((page_no >= 1))
);


--
-- Name: book_position; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_position (
    book_id bigint NOT NULL,
    session_id bigint NOT NULL,
    fraction double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT book_position_fraction_check CHECK (((fraction >= (0)::double precision) AND (fraction <= (1)::double precision)))
);


--
-- Name: book_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_session (
    id bigint NOT NULL,
    chapter_id bigint NOT NULL,
    ordinal integer NOT NULL,
    title text NOT NULL,
    text text NOT NULL,
    estimated_minutes integer NOT NULL,
    first_page integer NOT NULL,
    last_page integer NOT NULL,
    CONSTRAINT book_session_estimated_minutes_check CHECK ((estimated_minutes >= 1)),
    CONSTRAINT book_session_first_page_check CHECK ((first_page >= 1)),
    CONSTRAINT book_session_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT book_session_pages CHECK ((last_page >= first_page)),
    CONSTRAINT book_session_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))
);


--
-- Name: book_session_finished; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_session_finished (
    session_id bigint NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: book_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.book_session ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.book_session_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept (
    id bigint NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    topic text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    merged_into bigint,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT concept_check CHECK (((merged_into IS NULL) OR (retired_at IS NOT NULL))),
    CONSTRAINT concept_check1 CHECK ((merged_into <> id)),
    CONSTRAINT concept_description_check CHECK ((char_length(description) <= 500)),
    CONSTRAINT concept_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200))),
    CONSTRAINT concept_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT concept_topic_check CHECK ((topic = ANY (ARRAY['system-design'::text, 'databases'::text, 'distributed-systems'::text, 'backend'::text])))
);


--
-- Name: concept_edge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_edge (
    from_id bigint NOT NULL,
    to_id bigint NOT NULL,
    type public.concept_edge_type NOT NULL,
    CONSTRAINT concept_edge_check CHECK ((from_id <> to_id))
);


--
-- Name: concept_embedding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_embedding (
    concept_id bigint NOT NULL,
    model text NOT NULL,
    text_hash text NOT NULL,
    embedding public.vector(1024) NOT NULL,
    embedded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: concept_explainer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_explainer (
    id bigint NOT NULL,
    concept_id bigint NOT NULL,
    script text NOT NULL,
    citations jsonb NOT NULL,
    generator_model text NOT NULL,
    prompt_version integer NOT NULL,
    status public.explainer_status DEFAULT 'pending'::public.explainer_status NOT NULL,
    decided_by text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concept_explainer_check CHECK (((status = 'pending'::public.explainer_status) = (decided_at IS NULL))),
    CONSTRAINT concept_explainer_citations_check CHECK ((jsonb_typeof(citations) = 'array'::text)),
    CONSTRAINT concept_explainer_script_check CHECK (((char_length(script) >= 1) AND (char_length(script) <= 4000)))
);


--
-- Name: concept_explainer_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_explainer_attempt (
    concept_id bigint NOT NULL,
    outcome text NOT NULL,
    tried_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concept_explainer_attempt_outcome_check CHECK ((outcome = ANY (ARRAY['skipped'::text, 'refused'::text])))
);


--
-- Name: concept_explainer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.concept_explainer ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.concept_explainer_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: concept_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.concept ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.concept_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: concept_mastery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_mastery (
    user_id text NOT NULL,
    concept_id bigint NOT NULL,
    probability double precision NOT NULL,
    state public.learner_state NOT NULL,
    evidence_count integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concept_mastery_evidence_count_check CHECK ((evidence_count >= 1)),
    CONSTRAINT concept_mastery_probability_check CHECK (((probability >= (0)::double precision) AND (probability <= (1)::double precision)))
);


--
-- Name: concept_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_review (
    user_id text NOT NULL,
    concept_id bigint NOT NULL,
    due timestamp with time zone NOT NULL,
    stability double precision NOT NULL,
    difficulty double precision NOT NULL,
    scheduled_days integer NOT NULL,
    learning_steps integer NOT NULL,
    reps integer NOT NULL,
    lapses integer NOT NULL,
    state smallint NOT NULL,
    last_review timestamp with time zone NOT NULL,
    CONSTRAINT concept_review_difficulty_check CHECK (((difficulty >= (1)::double precision) AND (difficulty <= (10)::double precision))),
    CONSTRAINT concept_review_lapses_check CHECK ((lapses >= 0)),
    CONSTRAINT concept_review_learning_steps_check CHECK ((learning_steps >= 0)),
    CONSTRAINT concept_review_reps_check CHECK ((reps >= 1)),
    CONSTRAINT concept_review_scheduled_days_check CHECK ((scheduled_days >= 0)),
    CONSTRAINT concept_review_stability_check CHECK ((stability >= (0)::double precision)),
    CONSTRAINT concept_review_state_check CHECK (((state >= 0) AND (state <= 3)))
);


--
-- Name: content_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_item (
    id bigint NOT NULL,
    source_id bigint NOT NULL,
    guid text NOT NULL,
    canonical_url text NOT NULL,
    title text NOT NULL,
    author text,
    published_at timestamp with time zone,
    feed_summary text,
    excerpt text,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    duplicate_of bigint,
    simhash bigint,
    link_broken_at timestamp with time zone,
    frameable boolean,
    CONSTRAINT content_item_excerpt_check CHECK ((char_length(excerpt) <= 300)),
    CONSTRAINT content_item_feed_summary_check CHECK ((char_length(feed_summary) <= 300)),
    CONSTRAINT content_item_not_own_duplicate CHECK ((duplicate_of <> id))
);


--
-- Name: content_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.content_item ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.content_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: content_item_private_text; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_item_private_text (
    content_item_id bigint NOT NULL,
    text text NOT NULL,
    extracted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: content_item_section; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_item_section (
    content_item_id bigint NOT NULL,
    ordinal integer NOT NULL,
    heading text,
    level smallint,
    anchor_id text,
    word_count integer NOT NULL,
    CONSTRAINT content_item_section_heading_check CHECK ((char_length(heading) <= 300)),
    CONSTRAINT content_item_section_level_check CHECK (((level >= 1) AND (level <= 6))),
    CONSTRAINT content_item_section_word_count_check CHECK ((word_count >= 0))
);


--
-- Name: continue_dismissal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.continue_dismissal (
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_challenge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_challenge (
    day date NOT NULL,
    picked_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    published_unreviewed_at timestamp with time zone,
    CONSTRAINT daily_challenge_check CHECK (((approved_at IS NULL) OR (published_unreviewed_at IS NULL)))
);


--
-- Name: daily_challenge_question; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_challenge_question (
    day date NOT NULL,
    "position" smallint NOT NULL,
    question_id bigint NOT NULL,
    CONSTRAINT daily_challenge_question_position_check CHECK ((("position" >= 0) AND ("position" <= 4)))
);


--
-- Name: device_push_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_push_token (
    id bigint NOT NULL,
    user_id text NOT NULL,
    platform text NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_push_token_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text]))),
    CONSTRAINT device_push_token_token_check CHECK ((((char_length(token) >= 1) AND (char_length(token) <= 4096)) AND (token ~ '^[A-Za-z0-9:_-]+$'::text)))
);


--
-- Name: device_push_token_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.device_push_token ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.device_push_token_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: explainer_audio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.explainer_audio (
    id bigint NOT NULL,
    explainer_id bigint NOT NULL,
    provider text NOT NULL,
    voice text NOT NULL,
    playlist_key text NOT NULL,
    duration_seconds numeric(8,2) NOT NULL,
    words jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    captions jsonb NOT NULL,
    CONSTRAINT explainer_audio_captions_check CHECK ((jsonb_typeof(captions) = 'array'::text)),
    CONSTRAINT explainer_audio_duration_seconds_check CHECK ((duration_seconds > (0)::numeric)),
    CONSTRAINT explainer_audio_provider_check CHECK ((provider = ANY (ARRAY['elevenlabs'::text, 'inworld'::text, 'polly'::text]))),
    CONSTRAINT explainer_audio_words_check CHECK ((jsonb_typeof(words) = 'array'::text))
);


--
-- Name: explainer_audio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.explainer_audio ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.explainer_audio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: explainer_listen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.explainer_listen (
    user_id text NOT NULL,
    explainer_id bigint NOT NULL,
    position_seconds numeric(8,2) DEFAULT 0 NOT NULL,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT explainer_listen_position_seconds_check CHECK ((position_seconds >= (0)::numeric))
);


--
-- Name: explainer_scene; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.explainer_scene (
    id bigint NOT NULL,
    explainer_id bigint NOT NULL,
    scene_key text NOT NULL,
    generator_model text NOT NULL,
    prompt_version integer NOT NULL,
    status public.explainer_status DEFAULT 'pending'::public.explainer_status NOT NULL,
    decided_by text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT explainer_scene_check CHECK (((status = 'pending'::public.explainer_status) = (decided_at IS NULL))),
    CONSTRAINT explainer_scene_scene_key_check CHECK ((scene_key ~~ 'media/explainers/%.json'::text))
);


--
-- Name: explainer_scene_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.explainer_scene_attempt (
    explainer_id bigint NOT NULL,
    tried_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: explainer_scene_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.explainer_scene ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.explainer_scene_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: explore_arm_outcome; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.explore_arm_outcome (
    kind text NOT NULL,
    arm text NOT NULL,
    shown bigint DEFAULT 0 NOT NULL,
    finished bigint DEFAULT 0 NOT NULL,
    CONSTRAINT explore_arm_outcome_check CHECK (((finished >= 0) AND (finished <= shown))),
    CONSTRAINT explore_arm_outcome_kind_check CHECK ((kind = ANY (ARRAY['topic'::text, 'source'::text]))),
    CONSTRAINT explore_arm_outcome_shown_check CHECK ((shown >= 0))
);


--
-- Name: fair_play_flag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fair_play_flag (
    id bigint NOT NULL,
    match_id uuid NOT NULL,
    user_id text NOT NULL,
    signals integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decision text,
    decided_at timestamp with time zone,
    decided_by text,
    penalty double precision,
    CONSTRAINT fair_play_flag_check CHECK (((decision IS NULL) = (decided_at IS NULL))),
    CONSTRAINT fair_play_flag_check1 CHECK (((decision = 'penalized'::text) = (penalty IS NOT NULL))),
    CONSTRAINT fair_play_flag_decision_check CHECK ((decision = ANY (ARRAY['dismissed'::text, 'penalized'::text]))),
    CONSTRAINT fair_play_flag_penalty_check CHECK ((penalty >= (0)::double precision)),
    CONSTRAINT fair_play_flag_signals_check CHECK ((signals >= 1))
);


--
-- Name: fair_play_flag_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fair_play_flag ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fair_play_flag_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: feed_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_note (
    id bigint NOT NULL,
    content_item_id bigint NOT NULL,
    signal text NOT NULL,
    level public.difficulty NOT NULL,
    variant text NOT NULL,
    text text NOT NULL,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    polished_at timestamp with time zone,
    CONSTRAINT feed_note_text_check CHECK (((length(text) >= 1) AND (length(text) <= 300)))
);


--
-- Name: feed_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.feed_note ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.feed_note_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fetch_validator; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fetch_validator (
    url text NOT NULL,
    etag text,
    last_modified text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fetch_validator_check CHECK (((etag IS NOT NULL) OR (last_modified IS NOT NULL)))
);


--
-- Name: follow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follow (
    follower_id text NOT NULL,
    followee_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follow_check CHECK ((follower_id <> followee_id))
);


--
-- Name: game_match; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_match (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    server_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    outcome text,
    winner_id text,
    rated_at timestamp with time zone,
    mode text DEFAULT 'fastest_finger'::text NOT NULL,
    ghost_run_id bigint,
    replay_seat text,
    replay_rating double precision,
    replay_rd double precision,
    replay_volatility double precision,
    unrated boolean DEFAULT false NOT NULL,
    problem_slug text,
    CONSTRAINT game_match_battle_problem_check CHECK (((mode = 'battle'::text) = (problem_slug IS NOT NULL))),
    CONSTRAINT game_match_check CHECK (((finished_at IS NULL) = (outcome IS NULL))),
    CONSTRAINT game_match_mode_check CHECK ((mode = ANY (ARRAY['sprint'::text, 'fastest_finger'::text, 'battle'::text]))),
    CONSTRAINT game_match_outcome_check CHECK ((outcome = ANY (ARRAY['finished'::text, 'abandoned'::text, 'cancelled'::text, 'void'::text]))),
    CONSTRAINT game_match_replay_rd_check CHECK ((replay_rd > (0)::double precision)),
    CONSTRAINT game_match_replay_volatility_check CHECK ((replay_volatility > (0)::double precision)),
    CONSTRAINT game_match_replay_whole CHECK ((num_nulls(replay_seat, replay_rating, replay_rd, replay_volatility) = ANY (ARRAY[0, 4]))),
    CONSTRAINT game_match_server_id_check CHECK ((server_id >= 0))
);


--
-- Name: game_match_player; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_match_player (
    match_id uuid NOT NULL,
    user_id text NOT NULL,
    played_as text,
    total integer,
    time_ms bigint,
    abandoned boolean,
    signals jsonb,
    CONSTRAINT game_match_player_signals_check CHECK (((signals IS NULL) OR (jsonb_typeof(signals) = 'array'::text))),
    CONSTRAINT game_match_player_time_ms_check CHECK ((time_ms >= 0)),
    CONSTRAINT game_match_player_total_check CHECK ((total >= 0))
);


--
-- Name: game_match_question; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_match_question (
    match_id uuid NOT NULL,
    round smallint NOT NULL,
    question_id bigint NOT NULL,
    CONSTRAINT game_match_question_round_check CHECK (((round >= 1) AND (round <= 30)))
);


--
-- Name: ghost_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ghost_run (
    id bigint NOT NULL,
    match_id uuid NOT NULL,
    user_id text NOT NULL,
    mode text NOT NULL,
    rating double precision NOT NULL,
    rd double precision NOT NULL,
    volatility double precision NOT NULL,
    answers jsonb NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ghost_run_answers_check CHECK ((jsonb_typeof(answers) = 'array'::text)),
    CONSTRAINT ghost_run_mode_check CHECK ((mode = ANY (ARRAY['sprint'::text, 'fastest_finger'::text]))),
    CONSTRAINT ghost_run_rd_check CHECK ((rd > (0)::double precision)),
    CONSTRAINT ghost_run_volatility_check CHECK ((volatility > (0)::double precision))
);


--
-- Name: ghost_run_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ghost_run ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ghost_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: github_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_account (
    user_id text NOT NULL,
    github_user_id bigint NOT NULL,
    login text NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    synced_at timestamp with time zone,
    CONSTRAINT github_account_login_check CHECK (((char_length(login) >= 1) AND (char_length(login) <= 100)))
);


--
-- Name: github_dependency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_dependency (
    user_id text NOT NULL,
    repo_id bigint NOT NULL,
    ecosystem public.dependency_ecosystem NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    dev boolean DEFAULT false NOT NULL,
    CONSTRAINT github_dependency_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 214)))
);


--
-- Name: technology; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.technology (
    id bigint NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    source public.technology_source NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT technology_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT technology_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: technology_package; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.technology_package (
    ecosystem public.dependency_ecosystem NOT NULL,
    pattern text NOT NULL,
    prefix boolean DEFAULT false NOT NULL,
    technology_id bigint NOT NULL,
    origin public.technology_source NOT NULL,
    CONSTRAINT technology_package_pattern_check CHECK (((char_length(pattern) >= 1) AND (char_length(pattern) <= 214)))
);


--
-- Name: github_dependency_technology; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.github_dependency_technology AS
 SELECT d.user_id,
    d.repo_id,
    d.ecosystem,
    d.name,
    d.dev,
    m.technology_id
   FROM (public.github_dependency d
     CROSS JOIN LATERAL ( SELECT p.technology_id
           FROM (public.technology_package p
             JOIN public.technology t ON (((t.id = p.technology_id) AND (t.retired_at IS NULL))))
          WHERE ((p.ecosystem = d.ecosystem) AND (((NOT p.prefix) AND (p.pattern = d.name)) OR (p.prefix AND starts_with(d.name, p.pattern))))
          ORDER BY p.prefix, (char_length(p.pattern)) DESC
         LIMIT 1) m);


--
-- Name: github_installation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_installation (
    user_id text NOT NULL,
    installation_id bigint NOT NULL,
    account_login text NOT NULL,
    account_type text NOT NULL,
    CONSTRAINT github_installation_account_login_check CHECK (((char_length(account_login) >= 1) AND (char_length(account_login) <= 100))),
    CONSTRAINT github_installation_account_type_check CHECK ((account_type = ANY (ARRAY['User'::text, 'Organization'::text])))
);


--
-- Name: github_reachable_repository; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_reachable_repository (
    user_id text NOT NULL,
    installation_id bigint NOT NULL,
    repo_id bigint NOT NULL
);


--
-- Name: github_repository; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_repository (
    user_id text NOT NULL,
    repo_id bigint NOT NULL,
    installation_id bigint NOT NULL,
    full_name text NOT NULL,
    description text,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    default_branch text NOT NULL,
    pushed_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT github_repository_description_check CHECK ((char_length(description) <= 500)),
    CONSTRAINT github_repository_full_name_check CHECK (((char_length(full_name) >= 3) AND (char_length(full_name) <= 200))),
    CONSTRAINT github_repository_languages_check CHECK ((cardinality(languages) <= 5))
);


--
-- Name: goal_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_concept (
    goal public.learning_goal NOT NULL,
    concept_slug text NOT NULL
);


--
-- Name: graph_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_version (
    version integer NOT NULL,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT graph_version_version_check CHECK ((version >= 1))
);


--
-- Name: guest_start; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_start (
    ip_key bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invite_code; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_code (
    id bigint NOT NULL,
    code text NOT NULL,
    beta_group public.beta_group NOT NULL,
    max_uses integer NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invite_code_check CHECK (((used_count >= 0) AND (used_count <= max_uses))),
    CONSTRAINT invite_code_code_check CHECK (((code = public.normalize_invite_code(code)) AND (length(code) >= 10))),
    CONSTRAINT invite_code_max_uses_check CHECK ((max_uses >= 1))
);


--
-- Name: invite_code_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.invite_code ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.invite_code_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: item_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_concept (
    content_item_id bigint NOT NULL,
    concept_id bigint NOT NULL
);


--
-- Name: item_concept_probability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_concept_probability (
    content_item_id bigint NOT NULL,
    model text NOT NULL,
    concept_id bigint NOT NULL,
    probability double precision NOT NULL,
    CONSTRAINT item_concept_probability_probability_check CHECK (((probability >= (0)::double precision) AND (probability <= (1)::double precision)))
);


--
-- Name: item_decision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_decision (
    content_item_id bigint NOT NULL,
    model text NOT NULL,
    content_hash text NOT NULL,
    difficulty double precision NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_decision_difficulty_check CHECK (((difficulty >= (0)::double precision) AND (difficulty <= (2)::double precision)))
);


--
-- Name: item_embedding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_embedding (
    content_item_id bigint NOT NULL,
    model text NOT NULL,
    embedded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: item_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_feedback (
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    kind public.feedback_kind NOT NULL,
    given_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: item_tagging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_tagging (
    content_item_id bigint NOT NULL,
    difficulty public.difficulty NOT NULL,
    model text NOT NULL,
    prompt_version integer NOT NULL,
    tagged_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_tagging_prompt_version_check CHECK ((prompt_version >= 1))
);


--
-- Name: listen_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listen_queue (
    user_id text NOT NULL,
    explainer_id bigint NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lld_problem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lld_problem (
    slug text NOT NULL,
    title text NOT NULL,
    difficulty public.lld_difficulty NOT NULL,
    statement text NOT NULL,
    interface jsonb NOT NULL,
    checks jsonb DEFAULT '[]'::jsonb NOT NULL,
    limits jsonb NOT NULL,
    visible jsonb NOT NULL,
    private_key text NOT NULL,
    content_hash text NOT NULL,
    retired_at timestamp with time zone,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    extension_statement text,
    extension_interface jsonb,
    CONSTRAINT lld_problem_check CHECK ((private_key = (((('lld/problems/'::text || slug) || '/'::text) || content_hash) || '.json'::text))),
    CONSTRAINT lld_problem_check1 CHECK (((extension_statement IS NULL) = (extension_interface IS NULL))),
    CONSTRAINT lld_problem_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT lld_problem_slug_check CHECK (((slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'::text) AND (length(slug) <= 48))),
    CONSTRAINT lld_problem_title_check CHECK (((length(title) >= 3) AND (length(title) <= 80))),
    CONSTRAINT lld_problem_visible_check CHECK ((jsonb_typeof(visible) = 'array'::text))
);


--
-- Name: moment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moment (
    id bigint NOT NULL,
    content_item_id bigint NOT NULL,
    ordinal integer NOT NULL,
    title text NOT NULL,
    estimated_minutes integer NOT NULL,
    link text NOT NULL,
    link_type public.moment_link_type NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    oversized boolean DEFAULT false NOT NULL,
    CONSTRAINT moment_estimated_minutes_check CHECK ((estimated_minutes >= 1)),
    CONSTRAINT moment_link_http CHECK ((link ~ '^https?://'::text)),
    CONSTRAINT moment_title_check CHECK ((char_length(title) <= 300))
);


--
-- Name: moment_boundary_override; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moment_boundary_override (
    content_item_id bigint NOT NULL,
    headings text[] NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moment_boundary_override_headings_check CHECK ((cardinality(headings) >= 1))
);


--
-- Name: moment_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moment_concept (
    moment_id bigint NOT NULL,
    concept_id bigint NOT NULL
);


--
-- Name: moment_concept_probability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moment_concept_probability (
    moment_id bigint NOT NULL,
    model text NOT NULL,
    concept_id bigint NOT NULL,
    probability double precision NOT NULL,
    CONSTRAINT moment_concept_probability_probability_check CHECK (((probability >= (0)::double precision) AND (probability <= (1)::double precision)))
);


--
-- Name: moment_decision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moment_decision (
    moment_id bigint NOT NULL,
    model text NOT NULL,
    content_hash text NOT NULL,
    difficulty double precision NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moment_decision_difficulty_check CHECK (((difficulty >= (0)::double precision) AND (difficulty <= (2)::double precision)))
);


--
-- Name: moment_embedding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moment_embedding (
    moment_id bigint NOT NULL,
    model text NOT NULL,
    embedding public.vector(1024) NOT NULL,
    embedded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: moment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.moment ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.moment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: moment_tagging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moment_tagging (
    moment_id bigint NOT NULL,
    difficulty public.difficulty NOT NULL
);


--
-- Name: path; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.path (
    id bigint NOT NULL,
    name text NOT NULL,
    why text NOT NULL,
    status public.path_status DEFAULT 'draft'::public.path_status NOT NULL,
    model text NOT NULL,
    prompt_version integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT path_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT path_prompt_version_check CHECK ((prompt_version >= 1)),
    CONSTRAINT path_why_check CHECK (((char_length(why) >= 1) AND (char_length(why) <= 500)))
);


--
-- Name: path_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.path ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.path_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: path_section; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.path_section (
    id bigint NOT NULL,
    path_id bigint NOT NULL,
    ordinal smallint NOT NULL,
    CONSTRAINT path_section_ordinal_check CHECK ((ordinal >= 0))
);


--
-- Name: path_section_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.path_section_concept (
    section_id bigint NOT NULL,
    concept_id bigint NOT NULL
);


--
-- Name: path_section_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.path_section ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.path_section_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: path_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.path_session (
    section_id bigint NOT NULL,
    ordinal smallint NOT NULL,
    moment_id bigint NOT NULL,
    CONSTRAINT path_session_ordinal_check CHECK ((ordinal >= 0))
);


--
-- Name: plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan (
    id text NOT NULL,
    name text NOT NULL
);


--
-- Name: plan_capability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_capability (
    plan_id text NOT NULL,
    capability public.capability NOT NULL,
    limit_value integer,
    CONSTRAINT plan_capability_limit_value_check CHECK ((limit_value >= 0))
);


--
-- Name: player_country; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_country (
    user_id text NOT NULL,
    country text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_country_country_check CHECK ((country ~ '^[A-Z]{2}$'::text))
);


--
-- Name: player_rating; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_rating (
    user_id text NOT NULL,
    rating double precision NOT NULL,
    rd double precision NOT NULL,
    volatility double precision NOT NULL,
    games integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_rating_games_check CHECK ((games >= 0)),
    CONSTRAINT player_rating_rd_check CHECK ((rd > (0)::double precision)),
    CONSTRAINT player_rating_volatility_check CHECK ((volatility > (0)::double precision))
);


--
-- Name: player_university; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_university (
    user_id text NOT NULL,
    university_id bigint,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: player_username; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_username (
    user_id text NOT NULL,
    username text NOT NULL,
    searchable boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_username_username_check CHECK ((username ~ '^[a-z0-9_]{3,20}$'::text))
);


--
-- Name: project_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_note (
    id bigint NOT NULL,
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    repositories text[] NOT NULL,
    technologies text[] NOT NULL,
    text text,
    model text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    prompt_version smallint DEFAULT 1 NOT NULL,
    CONSTRAINT project_note_repositories_check CHECK (((cardinality(repositories) >= 1) AND (cardinality(repositories) <= 20))),
    CONSTRAINT project_note_technologies_check CHECK ((cardinality(technologies) >= 1)),
    CONSTRAINT project_note_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 300)))
);


--
-- Name: project_note_batch_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_note_batch_item (
    batch_id text NOT NULL,
    custom_id text NOT NULL,
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    repositories text[] NOT NULL,
    prompt_version smallint NOT NULL,
    result text,
    CONSTRAINT project_note_batch_item_result_check CHECK ((result = ANY (ARRAY['saved'::text, 'broken'::text, 'error'::text, 'skipped'::text])))
);


--
-- Name: project_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.project_note ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.project_note_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pronunciation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pronunciation (
    id bigint NOT NULL,
    term text NOT NULL,
    say text NOT NULL,
    origin text NOT NULL,
    added_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pronunciation_origin_check CHECK ((origin = ANY (ARRAY['seed'::text, 'admin'::text]))),
    CONSTRAINT pronunciation_say_check CHECK (((char_length(say) >= 1) AND (char_length(say) <= 200))),
    CONSTRAINT pronunciation_term_check CHECK (((char_length(term) >= 1) AND (char_length(term) <= 80)))
);


--
-- Name: pronunciation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pronunciation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pronunciation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: push_preference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_preference (
    user_id text NOT NULL,
    digest boolean DEFAULT false NOT NULL,
    path_reminder boolean DEFAULT false NOT NULL,
    daily_challenge boolean DEFAULT false NOT NULL,
    hour smallint DEFAULT 18 NOT NULL,
    time_zone text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_preference_hour_check CHECK (((hour >= 8) AND (hour <= 20))),
    CONSTRAINT push_preference_time_zone_check CHECK (((char_length(time_zone) >= 1) AND (char_length(time_zone) <= 64)))
);


--
-- Name: push_sent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_sent (
    user_id text NOT NULL,
    local_day date NOT NULL,
    kind text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_sent_kind_check CHECK ((kind = ANY (ARRAY['daily_challenge'::text, 'path_reminder'::text, 'digest'::text])))
);


--
-- Name: push_subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscription (
    id bigint NOT NULL,
    user_id text NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_subscription_auth_check CHECK ((auth ~ '^[A-Za-z0-9_-]{22}$'::text)),
    CONSTRAINT push_subscription_endpoint_check CHECK (((endpoint ~ '^https://'::text) AND (char_length(endpoint) <= 2000))),
    CONSTRAINT push_subscription_p256dh_check CHECK ((p256dh ~ '^[A-Za-z0-9_-]{87}$'::text))
);


--
-- Name: push_subscription_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.push_subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.push_subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: question; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question (
    id bigint NOT NULL,
    moment_id bigint,
    ordinal smallint NOT NULL,
    stem text NOT NULL,
    options text[],
    correct smallint,
    citation text NOT NULL,
    status public.question_status DEFAULT 'pending'::public.question_status NOT NULL,
    generator_model text,
    prompt_version integer,
    content_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    validator_model text,
    validator_answer smallint,
    validated_at timestamp with time zone,
    difficulty public.difficulty,
    answer_count integer DEFAULT 0 NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    calibrated_at timestamp with time zone,
    book_chapter_id bigint,
    kind public.question_kind DEFAULT 'choice'::public.question_kind NOT NULL,
    answer double precision,
    unit text,
    source_url text,
    source_title text,
    validator_estimate double precision,
    CONSTRAINT question_citation_check CHECK (((char_length(citation) >= 1) AND (char_length(citation) <= 300))),
    CONSTRAINT question_correct_check CHECK (((correct >= 0) AND (correct <= 3))),
    CONSTRAINT question_correct_within_answers CHECK (((correct_count >= 0) AND (correct_count <= answer_count))),
    CONSTRAINT question_hand_written CHECK ((((source_url IS NULL) = (source_title IS NULL)) AND ((source_url IS NULL) = (generator_model IS NOT NULL)) AND ((generator_model IS NULL) = (prompt_version IS NULL)) AND ((generator_model IS NULL) = (content_hash IS NULL)))),
    CONSTRAINT question_one_home CHECK ((num_nonnulls(moment_id, book_chapter_id, source_url) = 1)),
    CONSTRAINT question_options_check CHECK ((cardinality(options) = 4)),
    CONSTRAINT question_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT question_prompt_version_check CHECK ((prompt_version >= 1)),
    CONSTRAINT question_shape CHECK ((((kind = 'choice'::public.question_kind) AND (options IS NOT NULL) AND (correct IS NOT NULL) AND (answer IS NULL) AND (unit IS NULL)) OR ((kind = 'estimate'::public.question_kind) AND (answer > (0)::double precision) AND (answer < 'Infinity'::double precision) AND (unit IS NOT NULL) AND (options IS NULL) AND (correct IS NULL) AND (validator_answer IS NULL)))),
    CONSTRAINT question_source_title_check CHECK (((char_length(source_title) >= 1) AND (char_length(source_title) <= 300))),
    CONSTRAINT question_source_url_check CHECK ((source_url ~ '^https?://'::text)),
    CONSTRAINT question_stem_check CHECK (((char_length(stem) >= 1) AND (char_length(stem) <= 500))),
    CONSTRAINT question_unit_check CHECK (((char_length(unit) >= 1) AND (char_length(unit) <= 40))),
    CONSTRAINT question_validated_together CHECK ((((validator_model IS NULL) = (validated_at IS NULL)) AND ((validator_model IS NULL) = ((validator_answer IS NULL) AND (validator_estimate IS NULL))) AND ((validator_answer IS NULL) OR (validator_estimate IS NULL)))),
    CONSTRAINT question_validator_answer_check CHECK (((validator_answer >= 0) AND (validator_answer <= 3))),
    CONSTRAINT question_validator_estimate_check CHECK (((validator_estimate > (0)::double precision) AND (validator_estimate < 'Infinity'::double precision))),
    CONSTRAINT question_validator_estimate_shape CHECK (((validator_estimate IS NULL) OR (kind = 'estimate'::public.question_kind)))
);


--
-- Name: question_batch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_batch (
    id text NOT NULL,
    kind public.question_batch_kind NOT NULL,
    model text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    outcome text,
    cost_usd numeric(12,6),
    CONSTRAINT question_batch_check CHECK (((closed_at IS NULL) = (outcome IS NULL))),
    CONSTRAINT question_batch_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT question_batch_outcome_check CHECK ((outcome = ANY (ARRAY['completed'::text, 'failed'::text])))
);


--
-- Name: question_batch_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_batch_item (
    batch_id text NOT NULL,
    custom_id text NOT NULL,
    moment_id bigint,
    question_id bigint,
    content_hash text,
    result text,
    kind public.question_kind DEFAULT 'choice'::public.question_kind NOT NULL,
    CONSTRAINT question_batch_item_check CHECK (((moment_id IS NULL) <> (question_id IS NULL))),
    CONSTRAINT question_batch_item_result_check CHECK ((result = ANY (ARRAY['saved'::text, 'decided'::text, 'broken'::text, 'error'::text, 'skipped'::text])))
);


--
-- Name: question_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_concept (
    question_id bigint NOT NULL,
    concept_id bigint NOT NULL
);


--
-- Name: question_drafting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_drafting (
    moment_id bigint NOT NULL,
    attempt integer NOT NULL,
    retry_at timestamp with time zone NOT NULL,
    CONSTRAINT question_drafting_attempt_check CHECK ((attempt >= 1))
);


--
-- Name: question_estimate_drafted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_estimate_drafted (
    moment_id bigint NOT NULL,
    content_hash text NOT NULL
);


--
-- Name: question_flag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_flag (
    user_id text NOT NULL,
    question_id bigint NOT NULL,
    reason public.flag_reason NOT NULL,
    flagged_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: question_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.question ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.question_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: question_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_review (
    id bigint NOT NULL,
    question_id bigint NOT NULL,
    reason public.review_reason NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    decision public.review_decision,
    decided_by text,
    decided_at timestamp with time zone,
    CONSTRAINT question_review_check CHECK ((((decision IS NULL) = (decided_by IS NULL)) AND ((decision IS NULL) = (decided_at IS NULL))))
);


--
-- Name: question_review_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.question_review ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.question_review_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: quiz_answer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_answer (
    attempt_id bigint NOT NULL,
    question_id bigint NOT NULL,
    served_at timestamp with time zone DEFAULT now() NOT NULL,
    chosen smallint,
    correct boolean,
    answered_at timestamp with time zone,
    guess double precision,
    score double precision,
    CONSTRAINT quiz_answer_answered CHECK ((((answered_at IS NULL) AND (chosen IS NULL) AND (correct IS NULL) AND (guess IS NULL) AND (score IS NULL)) OR ((answered_at IS NOT NULL) AND (chosen IS NOT NULL) AND (correct IS NOT NULL) AND (guess IS NULL) AND (score IS NULL)) OR ((answered_at IS NOT NULL) AND (guess IS NOT NULL) AND (score IS NOT NULL) AND (chosen IS NULL) AND (correct IS NULL)))),
    CONSTRAINT quiz_answer_chosen_check CHECK (((chosen >= 0) AND (chosen <= 3))),
    CONSTRAINT quiz_answer_guess_check CHECK (((guess > (0)::double precision) AND (guess < 'Infinity'::double precision))),
    CONSTRAINT quiz_answer_score_check CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
);


--
-- Name: quiz_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_attempt (
    id bigint NOT NULL,
    user_id text NOT NULL,
    content_item_id bigint,
    moment_id bigint,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    finished_at timestamp with time zone,
    review boolean DEFAULT false NOT NULL,
    path_section_id bigint,
    checkpoint_size smallint,
    pass_mark smallint GENERATED ALWAYS AS (
CASE
    WHEN (checkpoint_size >= 5) THEN 4
    ELSE GREATEST((checkpoint_size - 1), 1)
END) STORED,
    checkpoint_passed boolean,
    book_chapter_id bigint,
    sprint boolean DEFAULT false NOT NULL,
    estimation boolean DEFAULT false NOT NULL,
    daily_day date,
    share_id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_id uuid,
    evidence_applied_at timestamp with time zone,
    CONSTRAINT quiz_attempt_check CHECK ((ends_at > started_at)),
    CONSTRAINT quiz_attempt_checkpoint_size_check CHECK (((checkpoint_size >= 1) AND (checkpoint_size <= 5))),
    CONSTRAINT quiz_attempt_estimation_is_sprint CHECK (((NOT estimation) OR sprint)),
    CONSTRAINT quiz_attempt_match_shape CHECK (((match_id IS NULL) OR ((NOT review) AND (NOT sprint) AND (NOT estimation) AND (daily_day IS NULL) AND (ends_at IS NOT NULL) AND (finished_at IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)))),
    CONSTRAINT quiz_attempt_shape CHECK (((match_id IS NOT NULL) OR (((daily_day IS NULL) AND ((review AND (NOT sprint) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (ends_at IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)) OR ((NOT review) AND (NOT sprint) AND (content_item_id IS NOT NULL) AND (ends_at IS NOT NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)) OR ((NOT review) AND (NOT sprint) AND (num_nonnulls(path_section_id, book_chapter_id) = 1) AND (checkpoint_size IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (ends_at IS NOT NULL)) OR (sprint AND (NOT review) AND (ends_at IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)))) OR ((daily_day IS NOT NULL) AND (NOT review) AND (NOT sprint) AND (ends_at IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)))))
);


--
-- Name: quiz_attempt_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_attempt_concept (
    attempt_id bigint NOT NULL,
    concept_id bigint NOT NULL,
    ordinal smallint NOT NULL,
    CONSTRAINT quiz_attempt_concept_ordinal_check CHECK ((ordinal >= 0))
);


--
-- Name: quiz_attempt_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.quiz_attempt ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.quiz_attempt_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ranking_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ranking_config (
    key text NOT NULL,
    value numeric NOT NULL,
    note text NOT NULL,
    CONSTRAINT ranking_config_value_check CHECK (((value >= (0)::numeric) AND (value < 'Infinity'::numeric) AND (value <> 'NaN'::numeric)))
);


--
-- Name: rating_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rating_history (
    id bigint NOT NULL,
    user_id text NOT NULL,
    match_id uuid NOT NULL,
    rating_before double precision NOT NULL,
    rating_after double precision NOT NULL,
    rd_after double precision NOT NULL,
    volatility_after double precision NOT NULL,
    score real NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rating_history_score_check CHECK ((score = ANY (ARRAY[(0)::real, (0.5)::real, (1)::real])))
);


--
-- Name: rating_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rating_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rating_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reason_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reason_report (
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    reason text NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reason_report_reason_check CHECK ((reason = ANY (ARRAY['topic_match'::text, 'goal_match'::text, 'project_match'::text, 'level_fit'::text, 'time_fit'::text, 'quality'::text, 'freshness'::text, 'explore'::text])))
);


--
-- Name: schema_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_meta (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: season_close; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.season_close (
    season text NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT season_close_season_check CHECK ((season ~ '^[0-9]{4}-[0-9]{2}$'::text))
);


--
-- Name: season_standing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.season_standing (
    season text NOT NULL,
    user_id text NOT NULL,
    rating double precision NOT NULL
);


--
-- Name: source; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source (
    id bigint NOT NULL,
    name text NOT NULL,
    homepage text,
    feed_url text NOT NULL,
    rights_profile public.rights_profile DEFAULT 'metadata_only'::public.rights_profile NOT NULL,
    moments_enabled boolean DEFAULT false NOT NULL,
    paywalled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    quality_score smallint,
    topics text[] DEFAULT '{}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    poll_interval_seconds integer DEFAULT 3600 NOT NULL,
    next_poll_at timestamp with time zone DEFAULT now() NOT NULL,
    polled_at timestamp with time zone,
    moments_seeded boolean DEFAULT false NOT NULL,
    moments_switched_off boolean DEFAULT false NOT NULL,
    moments_switched_by text,
    moments_switched_at timestamp with time zone,
    CONSTRAINT source_moments_switch CHECK ((moments_enabled = (moments_seeded AND (NOT moments_switched_off)))),
    CONSTRAINT source_poll_interval_seconds_check CHECK (((poll_interval_seconds >= 900) AND (poll_interval_seconds <= 86400))),
    CONSTRAINT source_quality_score_check CHECK (((quality_score >= 1) AND (quality_score <= 5)))
);


--
-- Name: source_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.source ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.source_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: starter_feed_entry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.starter_feed_entry (
    topic text NOT NULL,
    level public.difficulty NOT NULL,
    moment_id bigint,
    rank integer NOT NULL,
    chip public.break_length NOT NULL,
    content_item_id bigint NOT NULL,
    note_id bigint,
    reasons text,
    reason_kinds text[] DEFAULT '{}'::text[] NOT NULL,
    difficulty public.difficulty,
    CONSTRAINT starter_feed_entry_reason_kinds_check CHECK ((reason_kinds <@ ARRAY['topic_match'::text, 'goal_match'::text, 'project_match'::text, 'level_fit'::text, 'time_fit'::text, 'quality'::text, 'freshness'::text, 'explore'::text])),
    CONSTRAINT starter_feed_entry_reasons_check CHECK (((char_length(reasons) >= 1) AND (char_length(reasons) <= 600)))
);


--
-- Name: starter_feed_visible; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.starter_feed_visible AS
 SELECT fe.topic,
    fe.level,
    fe.chip,
    fe.rank,
        CASE
            WHEN (fe.moment_id IS NULL) THEN 'article'::text
            ELSE 'moment'::text
        END AS kind,
    fe.content_item_id,
    m.id AS moment_id,
    m.title AS section_title,
    (m.ordinal + 1) AS section_number,
    (( SELECT count(*) AS count
           FROM public.moment m2
          WHERE (m2.content_item_id = m.content_item_id)))::integer AS section_count,
    COALESCE(m.estimated_minutes, public.item_minutes(ci.id)) AS estimated_minutes,
    COALESCE(m.link, ci.canonical_url) AS link,
    ci.title AS article_title,
    ci.author,
    s.name AS source_name,
    n.text AS note_text,
    (n.model IS NOT NULL) AS note_ai,
    ci.frameable,
    ( SELECT (t.v)::public.topic AS v
           FROM unnest(s.topics) WITH ORDINALITY t(v, i)
          WHERE (t.v = ANY ((enum_range(NULL::public.topic))::text[]))
          ORDER BY t.i
         LIMIT 1) AS source_topic,
    fe.reasons,
    fe.reason_kinds,
    fe.difficulty
   FROM ((((public.starter_feed_entry fe
     JOIN public.content_item ci ON ((ci.id = fe.content_item_id)))
     JOIN public.source s ON ((s.id = ci.source_id)))
     LEFT JOIN public.moment m ON ((m.id = fe.moment_id)))
     LEFT JOIN public.feed_note n ON ((n.id = fe.note_id)))
  WHERE ((ci.link_broken_at IS NULL) AND ((fe.moment_id IS NULL) OR (s.moments_enabled AND (s.rights_profile = ANY (ARRAY['full_text_internal'::public.rights_profile, 'full_text_display'::public.rights_profile])))));


--
-- Name: tag_override; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_override (
    content_item_id bigint NOT NULL,
    heading text NOT NULL,
    difficulty public.difficulty NOT NULL,
    concepts text[] NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_override_concepts_check CHECK ((cardinality(concepts) <= 5))
);


--
-- Name: technology_concept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.technology_concept (
    technology_id bigint NOT NULL,
    concept_id bigint NOT NULL,
    origin public.technology_source NOT NULL
);


--
-- Name: technology_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.technology ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.technology_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: technology_suggestion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.technology_suggestion (
    id bigint NOT NULL,
    ecosystem public.dependency_ecosystem NOT NULL,
    package text NOT NULL,
    users integer NOT NULL,
    name text,
    slug text,
    concepts text[] DEFAULT '{}'::text[] NOT NULL,
    model text NOT NULL,
    status public.suggestion_status DEFAULT 'pending'::public.suggestion_status NOT NULL,
    decided_by text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT technology_suggestion_check CHECK (((status = ANY (ARRAY['skipped'::public.suggestion_status, 'unreadable'::public.suggestion_status])) = (slug IS NULL))),
    CONSTRAINT technology_suggestion_check1 CHECK (((status = ANY (ARRAY['accepted'::public.suggestion_status, 'rejected'::public.suggestion_status])) = (decided_at IS NOT NULL))),
    CONSTRAINT technology_suggestion_users_check CHECK ((users >= 0))
);


--
-- Name: technology_suggestion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.technology_suggestion ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.technology_suggestion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tts_sample; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tts_sample (
    id bigint NOT NULL,
    run uuid NOT NULL,
    script_no integer NOT NULL,
    provider text NOT NULL,
    voice_label text NOT NULL,
    file_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    picked_at timestamp with time zone,
    picked_by text,
    CONSTRAINT tts_sample_provider_check CHECK ((provider = ANY (ARRAY['elevenlabs'::text, 'inworld'::text, 'polly'::text]))),
    CONSTRAINT tts_sample_script_no_check CHECK (((script_no >= 1) AND (script_no <= 5))),
    CONSTRAINT tts_sample_voice_label_check CHECK ((voice_label = ANY (ARRAY['A'::text, 'B'::text, 'C'::text])))
);


--
-- Name: tts_sample_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tts_sample ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tts_sample_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: unclaimed_dependency; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.unclaimed_dependency AS
 SELECT ecosystem,
    name AS package,
    (count(DISTINCT user_id))::integer AS users,
    (EXISTS ( SELECT 1
           FROM public.technology_suggestion s
          WHERE ((s.ecosystem = d.ecosystem) AND (s.package = d.name)))) AS asked
   FROM public.github_dependency d
  WHERE ((name ~ '^[A-Za-z0-9@][A-Za-z0-9@/._~-]*$'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.github_dependency_technology t
          WHERE ((t.user_id = d.user_id) AND (t.repo_id = d.repo_id) AND (t.ecosystem = d.ecosystem) AND (t.name = d.name))))))
  GROUP BY ecosystem, name;


--
-- Name: university; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.university (
    id bigint NOT NULL,
    name text NOT NULL,
    country text,
    listed boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT university_country_check CHECK ((country ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT university_name_check CHECK (((length(name) >= 2) AND (length(name) <= 120)))
);


--
-- Name: university_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.university ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.university_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_article_finished; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_article_finished (
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    method public.finish_method NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_inferred_reset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_inferred_reset (
    user_id text NOT NULL,
    reset_at timestamp with time zone NOT NULL
);


--
-- Name: user_avoided_concept; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_avoided_concept AS
 SELECT DISTINCT f.user_id,
    c.slug,
    c.name
   FROM (((public.item_feedback f
     LEFT JOIN public.user_inferred_reset r ON ((r.user_id = f.user_id)))
     LEFT JOIN public.tag_override o ON (((o.content_item_id = f.content_item_id) AND (o.heading = ''::text))))
     JOIN public.concept c ON ((((o.content_item_id IS NOT NULL) AND (c.slug = ANY (o.concepts))) OR ((o.content_item_id IS NULL) AND (c.id IN ( SELECT item_concept.concept_id
           FROM public.item_concept
          WHERE (item_concept.content_item_id = f.content_item_id)))))))
  WHERE ((f.kind = 'not_interested'::public.feedback_kind) AND ((r.reset_at IS NULL) OR (f.given_at > r.reset_at)));


--
-- Name: user_capability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_capability (
    user_id text NOT NULL,
    capability public.capability NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_entitlement; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_entitlement AS
 SELECT u.id AS user_id,
    pc.capability,
    pc.limit_value
   FROM (public.app_user u
     JOIN public.plan_capability pc ON ((pc.plan_id = u.plan_id)))
UNION ALL
 SELECT uc.user_id,
    uc.capability,
    NULL::integer AS limit_value
   FROM (public.user_capability uc
     JOIN public.app_user u ON ((u.id = uc.user_id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.plan_capability pc
          WHERE ((pc.plan_id = u.plan_id) AND (pc.capability = uc.capability)))));


--
-- Name: user_explore_open; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_explore_open (
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    kind text NOT NULL,
    arm text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_counted boolean DEFAULT false NOT NULL,
    CONSTRAINT user_explore_open_kind_check CHECK ((kind = ANY (ARRAY['topic'::text, 'source'::text])))
);


--
-- Name: user_feed_entry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feed_entry (
    user_id text NOT NULL,
    moment_id bigint,
    rank integer NOT NULL,
    top_signal text NOT NULL,
    chip public.break_length NOT NULL,
    content_item_id bigint NOT NULL,
    note_id bigint,
    explore_kind text,
    explore_arm text,
    score_parts jsonb,
    reasons text,
    reason_kinds text[] DEFAULT '{}'::text[] NOT NULL,
    difficulty public.difficulty,
    CONSTRAINT user_feed_entry_explore CHECK (((explore_kind IS NULL) = (explore_arm IS NULL))),
    CONSTRAINT user_feed_entry_explore_kind_check CHECK ((explore_kind = ANY (ARRAY['topic'::text, 'source'::text]))),
    CONSTRAINT user_feed_entry_reason_kinds_check CHECK ((reason_kinds <@ ARRAY['topic_match'::text, 'goal_match'::text, 'project_match'::text, 'level_fit'::text, 'time_fit'::text, 'quality'::text, 'freshness'::text, 'explore'::text])),
    CONSTRAINT user_feed_entry_reasons_check CHECK (((char_length(reasons) >= 1) AND (char_length(reasons) <= 600)))
);


--
-- Name: user_feed_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feed_state (
    user_id text NOT NULL,
    computed_at timestamp with time zone NOT NULL
);


--
-- Name: user_feed_visible; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_feed_visible AS
 SELECT fe.user_id,
    fe.chip,
    fe.rank,
        CASE
            WHEN (fe.moment_id IS NULL) THEN 'article'::text
            ELSE 'moment'::text
        END AS kind,
    fe.content_item_id,
    m.id AS moment_id,
    m.title AS section_title,
    (m.ordinal + 1) AS section_number,
    (( SELECT count(*) AS count
           FROM public.moment m2
          WHERE (m2.content_item_id = m.content_item_id)))::integer AS section_count,
    COALESCE(m.estimated_minutes, public.item_minutes(ci.id)) AS estimated_minutes,
    COALESCE(m.link, ci.canonical_url) AS link,
    ci.title AS article_title,
    ci.author,
    s.name AS source_name,
    n.text AS note_text,
    (n.model IS NOT NULL) AS note_ai,
    ci.frameable,
    ( SELECT (t.v)::public.topic AS v
           FROM unnest(s.topics) WITH ORDINALITY t(v, i)
          WHERE (t.v = ANY ((enum_range(NULL::public.topic))::text[]))
          ORDER BY t.i
         LIMIT 1) AS source_topic,
    pn.text AS project_note_text,
    pn.repositories AS project_note_repositories,
    fe.reasons,
    fe.reason_kinds,
    fe.difficulty
   FROM (((((public.user_feed_entry fe
     JOIN public.content_item ci ON ((ci.id = fe.content_item_id)))
     JOIN public.source s ON ((s.id = ci.source_id)))
     LEFT JOIN public.moment m ON ((m.id = fe.moment_id)))
     LEFT JOIN public.feed_note n ON ((n.id = fe.note_id)))
     LEFT JOIN LATERAL ( SELECT p.text,
            p.repositories
           FROM public.project_note p
          WHERE ((p.user_id = fe.user_id) AND (p.content_item_id = fe.content_item_id) AND (p.text IS NOT NULL) AND (p.repositories <@ ARRAY( SELECT r.full_name
                   FROM public.github_repository r
                  WHERE (r.user_id = fe.user_id))))
          ORDER BY p.created_at DESC
         LIMIT 1) pn ON (true))
  WHERE ((ci.link_broken_at IS NULL) AND ((fe.moment_id IS NULL) OR (s.moments_enabled AND (s.rights_profile = ANY (ARRAY['full_text_internal'::public.rights_profile, 'full_text_display'::public.rights_profile])))));


--
-- Name: user_hidden_source; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_hidden_source (
    user_id text NOT NULL,
    source_id bigint NOT NULL,
    hidden_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_moment_finished; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_moment_finished (
    user_id text NOT NULL,
    moment_id bigint NOT NULL,
    method public.finish_method NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_moment_opened; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_moment_opened (
    user_id text NOT NULL,
    moment_id bigint NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note (
    id bigint NOT NULL,
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    moment_id bigint,
    section_title text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_note_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000)))
);


--
-- Name: user_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_note ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_note_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_path; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_path (
    user_id text NOT NULL,
    path_id bigint NOT NULL,
    status public.user_path_status NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_path_section; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_path_section (
    user_id text NOT NULL,
    path_id bigint NOT NULL,
    section_id bigint NOT NULL,
    ordinal smallint NOT NULL,
    skipped_at timestamp with time zone,
    unskipped_at timestamp with time zone,
    CONSTRAINT user_path_section_check CHECK (((unskipped_at IS NULL) OR (skipped_at IS NOT NULL))),
    CONSTRAINT user_path_section_ordinal_check CHECK ((ordinal >= 0))
);


--
-- Name: user_path_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_path_session (
    user_id text NOT NULL,
    section_id bigint NOT NULL,
    ordinal smallint NOT NULL,
    moment_id bigint NOT NULL
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id text NOT NULL,
    topics public.topic[] NOT NULL,
    level public.difficulty NOT NULL,
    break_length public.break_length NOT NULL,
    onboarded_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    goals public.learning_goal[] NOT NULL,
    CONSTRAINT user_preferences_goals_check CHECK (((cardinality(goals) >= 1) AND (cardinality(goals) <= 4))),
    CONSTRAINT user_preferences_topics_check CHECK (((cardinality(topics) >= 1) AND (cardinality(topics) <= 4)))
);


--
-- Name: user_save; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_save (
    user_id text NOT NULL,
    content_item_id bigint NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_device agent_device_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_device
    ADD CONSTRAINT agent_device_pkey PRIMARY KEY (id);


--
-- Name: agent_device agent_device_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_device
    ADD CONSTRAINT agent_device_token_hash_key UNIQUE (token_hash);


--
-- Name: agent_place agent_place_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_place
    ADD CONSTRAINT agent_place_pkey PRIMARY KEY (user_id);


--
-- Name: agent_task agent_task_device_id_finish_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_device_id_finish_key_key UNIQUE (device_id, finish_key);


--
-- Name: agent_task agent_task_device_id_start_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_device_id_start_key_key UNIQUE (device_id, start_key);


--
-- Name: agent_task agent_task_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_pkey PRIMARY KEY (id);


--
-- Name: ai_budget ai_budget_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_budget
    ADD CONSTRAINT ai_budget_pkey PRIMARY KEY (scope);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


--
-- Name: app_user app_user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_email_key UNIQUE (email);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- Name: auth_account auth_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_pkey PRIMARY KEY (id);


--
-- Name: auth_session auth_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (id);


--
-- Name: auth_session auth_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_token_key UNIQUE (token);


--
-- Name: auth_verification auth_verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_verification
    ADD CONSTRAINT auth_verification_pkey PRIMARY KEY (id);


--
-- Name: board_score board_score_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_score
    ADD CONSTRAINT board_score_pkey PRIMARY KEY (attempt_id);


--
-- Name: book_chapter book_chapter_book_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter
    ADD CONSTRAINT book_chapter_book_id_ordinal_key UNIQUE (book_id, ordinal);


--
-- Name: book_chapter_checkpoint book_chapter_checkpoint_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter_checkpoint
    ADD CONSTRAINT book_chapter_checkpoint_pkey PRIMARY KEY (chapter_id);


--
-- Name: book_chapter_concept book_chapter_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter_concept
    ADD CONSTRAINT book_chapter_concept_pkey PRIMARY KEY (chapter_id, concept_id);


--
-- Name: book_chapter book_chapter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter
    ADD CONSTRAINT book_chapter_pkey PRIMARY KEY (id);


--
-- Name: book book_file_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book
    ADD CONSTRAINT book_file_key_key UNIQUE (file_key);


--
-- Name: book_page book_page_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_page
    ADD CONSTRAINT book_page_pkey PRIMARY KEY (book_id, page_no);


--
-- Name: book book_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book
    ADD CONSTRAINT book_pkey PRIMARY KEY (id);


--
-- Name: book_position book_position_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_position
    ADD CONSTRAINT book_position_pkey PRIMARY KEY (book_id);


--
-- Name: book_session book_session_chapter_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_session
    ADD CONSTRAINT book_session_chapter_id_ordinal_key UNIQUE (chapter_id, ordinal);


--
-- Name: book_session_finished book_session_finished_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_session_finished
    ADD CONSTRAINT book_session_finished_pkey PRIMARY KEY (session_id);


--
-- Name: book_session book_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_session
    ADD CONSTRAINT book_session_pkey PRIMARY KEY (id);


--
-- Name: concept_edge concept_edge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_edge
    ADD CONSTRAINT concept_edge_pkey PRIMARY KEY (from_id, to_id, type);


--
-- Name: concept_embedding concept_embedding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_embedding
    ADD CONSTRAINT concept_embedding_pkey PRIMARY KEY (concept_id, model);


--
-- Name: concept_explainer_attempt concept_explainer_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explainer_attempt
    ADD CONSTRAINT concept_explainer_attempt_pkey PRIMARY KEY (concept_id);


--
-- Name: concept_explainer concept_explainer_concept_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explainer
    ADD CONSTRAINT concept_explainer_concept_id_key UNIQUE (concept_id);


--
-- Name: concept_explainer concept_explainer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explainer
    ADD CONSTRAINT concept_explainer_pkey PRIMARY KEY (id);


--
-- Name: concept_mastery concept_mastery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_mastery
    ADD CONSTRAINT concept_mastery_pkey PRIMARY KEY (user_id, concept_id);


--
-- Name: concept concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept
    ADD CONSTRAINT concept_pkey PRIMARY KEY (id);


--
-- Name: concept_review concept_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_review
    ADD CONSTRAINT concept_review_pkey PRIMARY KEY (user_id, concept_id);


--
-- Name: concept concept_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept
    ADD CONSTRAINT concept_slug_key UNIQUE (slug);


--
-- Name: content_item content_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item
    ADD CONSTRAINT content_item_pkey PRIMARY KEY (id);


--
-- Name: content_item_private_text content_item_private_text_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item_private_text
    ADD CONSTRAINT content_item_private_text_pkey PRIMARY KEY (content_item_id);


--
-- Name: content_item_section content_item_section_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item_section
    ADD CONSTRAINT content_item_section_pkey PRIMARY KEY (content_item_id, ordinal);


--
-- Name: content_item content_item_source_id_guid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item
    ADD CONSTRAINT content_item_source_id_guid_key UNIQUE (source_id, guid);


--
-- Name: continue_dismissal continue_dismissal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.continue_dismissal
    ADD CONSTRAINT continue_dismissal_pkey PRIMARY KEY (user_id, content_item_id);


--
-- Name: daily_challenge daily_challenge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_challenge
    ADD CONSTRAINT daily_challenge_pkey PRIMARY KEY (day);


--
-- Name: daily_challenge_question daily_challenge_question_day_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_challenge_question
    ADD CONSTRAINT daily_challenge_question_day_question_id_key UNIQUE (day, question_id);


--
-- Name: daily_challenge_question daily_challenge_question_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_challenge_question
    ADD CONSTRAINT daily_challenge_question_pkey PRIMARY KEY (day, "position");


--
-- Name: device_push_token device_push_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_token
    ADD CONSTRAINT device_push_token_pkey PRIMARY KEY (id);


--
-- Name: device_push_token device_push_token_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_token
    ADD CONSTRAINT device_push_token_token_key UNIQUE (token);


--
-- Name: explainer_audio explainer_audio_explainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_audio
    ADD CONSTRAINT explainer_audio_explainer_id_key UNIQUE (explainer_id);


--
-- Name: explainer_audio explainer_audio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_audio
    ADD CONSTRAINT explainer_audio_pkey PRIMARY KEY (id);


--
-- Name: explainer_listen explainer_listen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_listen
    ADD CONSTRAINT explainer_listen_pkey PRIMARY KEY (user_id, explainer_id);


--
-- Name: explainer_scene_attempt explainer_scene_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_scene_attempt
    ADD CONSTRAINT explainer_scene_attempt_pkey PRIMARY KEY (explainer_id);


--
-- Name: explainer_scene explainer_scene_explainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_scene
    ADD CONSTRAINT explainer_scene_explainer_id_key UNIQUE (explainer_id);


--
-- Name: explainer_scene explainer_scene_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_scene
    ADD CONSTRAINT explainer_scene_pkey PRIMARY KEY (id);


--
-- Name: explore_arm_outcome explore_arm_outcome_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explore_arm_outcome
    ADD CONSTRAINT explore_arm_outcome_pkey PRIMARY KEY (kind, arm);


--
-- Name: fair_play_flag fair_play_flag_match_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fair_play_flag
    ADD CONSTRAINT fair_play_flag_match_id_user_id_key UNIQUE (match_id, user_id);


--
-- Name: fair_play_flag fair_play_flag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fair_play_flag
    ADD CONSTRAINT fair_play_flag_pkey PRIMARY KEY (id);


--
-- Name: feed_note feed_note_content_item_id_signal_level_variant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_note
    ADD CONSTRAINT feed_note_content_item_id_signal_level_variant_key UNIQUE (content_item_id, signal, level, variant);


--
-- Name: feed_note feed_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_note
    ADD CONSTRAINT feed_note_pkey PRIMARY KEY (id);


--
-- Name: fetch_validator fetch_validator_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fetch_validator
    ADD CONSTRAINT fetch_validator_pkey PRIMARY KEY (url);


--
-- Name: follow follow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow
    ADD CONSTRAINT follow_pkey PRIMARY KEY (follower_id, followee_id);


--
-- Name: game_match game_match_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match
    ADD CONSTRAINT game_match_pkey PRIMARY KEY (id);


--
-- Name: game_match_player game_match_player_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match_player
    ADD CONSTRAINT game_match_player_pkey PRIMARY KEY (match_id, user_id);


--
-- Name: game_match_question game_match_question_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match_question
    ADD CONSTRAINT game_match_question_pkey PRIMARY KEY (match_id, round);


--
-- Name: ghost_run ghost_run_match_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_run
    ADD CONSTRAINT ghost_run_match_id_user_id_key UNIQUE (match_id, user_id);


--
-- Name: ghost_run ghost_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_run
    ADD CONSTRAINT ghost_run_pkey PRIMARY KEY (id);


--
-- Name: github_account github_account_github_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_account
    ADD CONSTRAINT github_account_github_user_id_key UNIQUE (github_user_id);


--
-- Name: github_account github_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_account
    ADD CONSTRAINT github_account_pkey PRIMARY KEY (user_id);


--
-- Name: github_dependency github_dependency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_dependency
    ADD CONSTRAINT github_dependency_pkey PRIMARY KEY (user_id, repo_id, ecosystem, name);


--
-- Name: github_installation github_installation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_installation
    ADD CONSTRAINT github_installation_pkey PRIMARY KEY (user_id, installation_id);


--
-- Name: github_reachable_repository github_reachable_repository_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_reachable_repository
    ADD CONSTRAINT github_reachable_repository_pkey PRIMARY KEY (user_id, installation_id, repo_id);


--
-- Name: github_repository github_repository_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_repository
    ADD CONSTRAINT github_repository_pkey PRIMARY KEY (user_id, repo_id);


--
-- Name: goal_concept goal_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_concept
    ADD CONSTRAINT goal_concept_pkey PRIMARY KEY (goal, concept_slug);


--
-- Name: graph_version graph_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_version
    ADD CONSTRAINT graph_version_pkey PRIMARY KEY (version);


--
-- Name: invite_code invite_code_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_code
    ADD CONSTRAINT invite_code_code_key UNIQUE (code);


--
-- Name: invite_code invite_code_id_beta_group_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_code
    ADD CONSTRAINT invite_code_id_beta_group_key UNIQUE (id, beta_group);


--
-- Name: invite_code invite_code_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_code
    ADD CONSTRAINT invite_code_pkey PRIMARY KEY (id);


--
-- Name: item_concept item_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_concept
    ADD CONSTRAINT item_concept_pkey PRIMARY KEY (content_item_id, concept_id);


--
-- Name: item_concept_probability item_concept_probability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_concept_probability
    ADD CONSTRAINT item_concept_probability_pkey PRIMARY KEY (content_item_id, model, concept_id);


--
-- Name: item_decision item_decision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_decision
    ADD CONSTRAINT item_decision_pkey PRIMARY KEY (content_item_id, model);


--
-- Name: item_embedding item_embedding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_embedding
    ADD CONSTRAINT item_embedding_pkey PRIMARY KEY (content_item_id, model);


--
-- Name: item_feedback item_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_feedback
    ADD CONSTRAINT item_feedback_pkey PRIMARY KEY (user_id, content_item_id, kind);


--
-- Name: item_tagging item_tagging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tagging
    ADD CONSTRAINT item_tagging_pkey PRIMARY KEY (content_item_id);


--
-- Name: listen_queue listen_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listen_queue
    ADD CONSTRAINT listen_queue_pkey PRIMARY KEY (user_id, explainer_id);


--
-- Name: lld_problem lld_problem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lld_problem
    ADD CONSTRAINT lld_problem_pkey PRIMARY KEY (slug);


--
-- Name: moment_boundary_override moment_boundary_override_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_boundary_override
    ADD CONSTRAINT moment_boundary_override_pkey PRIMARY KEY (content_item_id);


--
-- Name: moment_concept moment_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_concept
    ADD CONSTRAINT moment_concept_pkey PRIMARY KEY (moment_id, concept_id);


--
-- Name: moment_concept_probability moment_concept_probability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_concept_probability
    ADD CONSTRAINT moment_concept_probability_pkey PRIMARY KEY (moment_id, model, concept_id);


--
-- Name: moment moment_content_item_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment
    ADD CONSTRAINT moment_content_item_id_ordinal_key UNIQUE (content_item_id, ordinal);


--
-- Name: moment_decision moment_decision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_decision
    ADD CONSTRAINT moment_decision_pkey PRIMARY KEY (moment_id, model);


--
-- Name: moment_embedding moment_embedding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_embedding
    ADD CONSTRAINT moment_embedding_pkey PRIMARY KEY (moment_id);


--
-- Name: moment moment_id_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment
    ADD CONSTRAINT moment_id_item UNIQUE (id, content_item_id);


--
-- Name: moment moment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment
    ADD CONSTRAINT moment_pkey PRIMARY KEY (id);


--
-- Name: moment_tagging moment_tagging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_tagging
    ADD CONSTRAINT moment_tagging_pkey PRIMARY KEY (moment_id);


--
-- Name: path path_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path
    ADD CONSTRAINT path_pkey PRIMARY KEY (id);


--
-- Name: path_section_concept path_section_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_section_concept
    ADD CONSTRAINT path_section_concept_pkey PRIMARY KEY (section_id, concept_id);


--
-- Name: path_section path_section_path_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_section
    ADD CONSTRAINT path_section_path_id_ordinal_key UNIQUE (path_id, ordinal);


--
-- Name: path_section path_section_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_section
    ADD CONSTRAINT path_section_pkey PRIMARY KEY (id);


--
-- Name: path_session path_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_session
    ADD CONSTRAINT path_session_pkey PRIMARY KEY (section_id, ordinal);


--
-- Name: plan_capability plan_capability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_capability
    ADD CONSTRAINT plan_capability_pkey PRIMARY KEY (plan_id, capability);


--
-- Name: plan plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan
    ADD CONSTRAINT plan_pkey PRIMARY KEY (id);


--
-- Name: player_country player_country_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_country
    ADD CONSTRAINT player_country_pkey PRIMARY KEY (user_id);


--
-- Name: player_rating player_rating_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_rating
    ADD CONSTRAINT player_rating_pkey PRIMARY KEY (user_id);


--
-- Name: player_university player_university_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_university
    ADD CONSTRAINT player_university_pkey PRIMARY KEY (user_id);


--
-- Name: player_username player_username_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_username
    ADD CONSTRAINT player_username_pkey PRIMARY KEY (user_id);


--
-- Name: player_username player_username_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_username
    ADD CONSTRAINT player_username_username_key UNIQUE (username);


--
-- Name: project_note_batch_item project_note_batch_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note_batch_item
    ADD CONSTRAINT project_note_batch_item_pkey PRIMARY KEY (batch_id, custom_id);


--
-- Name: project_note project_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note
    ADD CONSTRAINT project_note_pkey PRIMARY KEY (id);


--
-- Name: project_note project_note_user_id_content_item_id_repositories_prompt_ve_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note
    ADD CONSTRAINT project_note_user_id_content_item_id_repositories_prompt_ve_key UNIQUE (user_id, content_item_id, repositories, prompt_version);


--
-- Name: pronunciation pronunciation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pronunciation
    ADD CONSTRAINT pronunciation_pkey PRIMARY KEY (id);


--
-- Name: push_preference push_preference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_preference
    ADD CONSTRAINT push_preference_pkey PRIMARY KEY (user_id);


--
-- Name: push_sent push_sent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_sent
    ADD CONSTRAINT push_sent_pkey PRIMARY KEY (user_id, local_day);


--
-- Name: push_subscription push_subscription_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscription
    ADD CONSTRAINT push_subscription_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscription push_subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscription
    ADD CONSTRAINT push_subscription_pkey PRIMARY KEY (id);


--
-- Name: question_batch_item question_batch_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_batch_item
    ADD CONSTRAINT question_batch_item_pkey PRIMARY KEY (batch_id, custom_id);


--
-- Name: question_batch question_batch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_batch
    ADD CONSTRAINT question_batch_pkey PRIMARY KEY (id);


--
-- Name: question_concept question_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_concept
    ADD CONSTRAINT question_concept_pkey PRIMARY KEY (question_id, concept_id);


--
-- Name: question_drafting question_drafting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_drafting
    ADD CONSTRAINT question_drafting_pkey PRIMARY KEY (moment_id);


--
-- Name: question_estimate_drafted question_estimate_drafted_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_estimate_drafted
    ADD CONSTRAINT question_estimate_drafted_pkey PRIMARY KEY (moment_id);


--
-- Name: question_flag question_flag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_flag
    ADD CONSTRAINT question_flag_pkey PRIMARY KEY (user_id, question_id);


--
-- Name: question question_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question
    ADD CONSTRAINT question_pkey PRIMARY KEY (id);


--
-- Name: question_review question_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_review
    ADD CONSTRAINT question_review_pkey PRIMARY KEY (id);


--
-- Name: quiz_answer quiz_answer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answer
    ADD CONSTRAINT quiz_answer_pkey PRIMARY KEY (attempt_id, question_id);


--
-- Name: quiz_attempt_concept quiz_attempt_concept_attempt_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt_concept
    ADD CONSTRAINT quiz_attempt_concept_attempt_id_ordinal_key UNIQUE (attempt_id, ordinal);


--
-- Name: quiz_attempt_concept quiz_attempt_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt_concept
    ADD CONSTRAINT quiz_attempt_concept_pkey PRIMARY KEY (attempt_id, concept_id);


--
-- Name: quiz_attempt quiz_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_pkey PRIMARY KEY (id);


--
-- Name: quiz_attempt quiz_attempt_share_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_share_id_key UNIQUE (share_id);


--
-- Name: ranking_config ranking_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranking_config
    ADD CONSTRAINT ranking_config_pkey PRIMARY KEY (key);


--
-- Name: rating_history rating_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_pkey PRIMARY KEY (id);


--
-- Name: rating_history rating_history_user_id_match_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_user_id_match_id_key UNIQUE (user_id, match_id);


--
-- Name: reason_report reason_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_report
    ADD CONSTRAINT reason_report_pkey PRIMARY KEY (user_id, content_item_id, reason);


--
-- Name: schema_meta schema_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_meta
    ADD CONSTRAINT schema_meta_pkey PRIMARY KEY (key);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: season_close season_close_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.season_close
    ADD CONSTRAINT season_close_pkey PRIMARY KEY (season);


--
-- Name: season_standing season_standing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.season_standing
    ADD CONSTRAINT season_standing_pkey PRIMARY KEY (season, user_id);


--
-- Name: source source_feed_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source
    ADD CONSTRAINT source_feed_url_key UNIQUE (feed_url);


--
-- Name: source source_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source
    ADD CONSTRAINT source_name_key UNIQUE (name);


--
-- Name: source source_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source
    ADD CONSTRAINT source_pkey PRIMARY KEY (id);


--
-- Name: starter_feed_entry starter_feed_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.starter_feed_entry
    ADD CONSTRAINT starter_feed_entry_pkey PRIMARY KEY (topic, level, chip, rank);


--
-- Name: tag_override tag_override_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_override
    ADD CONSTRAINT tag_override_pkey PRIMARY KEY (content_item_id, heading);


--
-- Name: technology_concept technology_concept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_concept
    ADD CONSTRAINT technology_concept_pkey PRIMARY KEY (technology_id, concept_id);


--
-- Name: technology_package technology_package_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_package
    ADD CONSTRAINT technology_package_pkey PRIMARY KEY (ecosystem, pattern, prefix);


--
-- Name: technology technology_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology
    ADD CONSTRAINT technology_pkey PRIMARY KEY (id);


--
-- Name: technology technology_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology
    ADD CONSTRAINT technology_slug_key UNIQUE (slug);


--
-- Name: technology_suggestion technology_suggestion_ecosystem_package_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_suggestion
    ADD CONSTRAINT technology_suggestion_ecosystem_package_key UNIQUE (ecosystem, package);


--
-- Name: technology_suggestion technology_suggestion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_suggestion
    ADD CONSTRAINT technology_suggestion_pkey PRIMARY KEY (id);


--
-- Name: tts_sample tts_sample_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tts_sample
    ADD CONSTRAINT tts_sample_pkey PRIMARY KEY (id);


--
-- Name: tts_sample tts_sample_run_script_no_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tts_sample
    ADD CONSTRAINT tts_sample_run_script_no_provider_key UNIQUE (run, script_no, provider);


--
-- Name: tts_sample tts_sample_run_script_no_voice_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tts_sample
    ADD CONSTRAINT tts_sample_run_script_no_voice_label_key UNIQUE (run, script_no, voice_label);


--
-- Name: university university_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.university
    ADD CONSTRAINT university_pkey PRIMARY KEY (id);


--
-- Name: user_article_finished user_article_finished_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_article_finished
    ADD CONSTRAINT user_article_finished_pkey PRIMARY KEY (user_id, content_item_id);


--
-- Name: user_capability user_capability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_capability
    ADD CONSTRAINT user_capability_pkey PRIMARY KEY (user_id, capability);


--
-- Name: user_explore_open user_explore_open_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_explore_open
    ADD CONSTRAINT user_explore_open_pkey PRIMARY KEY (user_id, content_item_id);


--
-- Name: user_feed_entry user_feed_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_entry
    ADD CONSTRAINT user_feed_entry_pkey PRIMARY KEY (user_id, chip, rank);


--
-- Name: user_feed_state user_feed_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_state
    ADD CONSTRAINT user_feed_state_pkey PRIMARY KEY (user_id);


--
-- Name: user_hidden_source user_hidden_source_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_hidden_source
    ADD CONSTRAINT user_hidden_source_pkey PRIMARY KEY (user_id, source_id);


--
-- Name: user_inferred_reset user_inferred_reset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_inferred_reset
    ADD CONSTRAINT user_inferred_reset_pkey PRIMARY KEY (user_id);


--
-- Name: user_moment_finished user_moment_finished_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_moment_finished
    ADD CONSTRAINT user_moment_finished_pkey PRIMARY KEY (user_id, moment_id);


--
-- Name: user_moment_opened user_moment_opened_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_moment_opened
    ADD CONSTRAINT user_moment_opened_pkey PRIMARY KEY (user_id, moment_id);


--
-- Name: user_note user_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note
    ADD CONSTRAINT user_note_pkey PRIMARY KEY (id);


--
-- Name: user_path user_path_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path
    ADD CONSTRAINT user_path_pkey PRIMARY KEY (user_id, path_id);


--
-- Name: user_path_section user_path_section_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_section
    ADD CONSTRAINT user_path_section_pkey PRIMARY KEY (user_id, section_id);


--
-- Name: user_path_section user_path_section_place; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_section
    ADD CONSTRAINT user_path_section_place UNIQUE (user_id, path_id, ordinal) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: user_path_session user_path_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_session
    ADD CONSTRAINT user_path_session_pkey PRIMARY KEY (user_id, section_id, ordinal);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: user_save user_save_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_save
    ADD CONSTRAINT user_save_pkey PRIMARY KEY (user_id, content_item_id);


--
-- Name: agent_device_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_device_user ON public.agent_device USING btree (user_id);


--
-- Name: agent_task_running; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_task_running ON public.agent_task USING btree (user_id, started_at DESC) WHERE (finished_at IS NULL);


--
-- Name: ai_usage_offline_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_offline_day ON public.ai_usage USING btree (occurred_at) WHERE is_offline;


--
-- Name: ai_usage_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_user_day ON public.ai_usage USING btree (user_id, occurred_at);


--
-- Name: app_user_invite_code_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_user_invite_code_id ON public.app_user USING btree (invite_code_id);


--
-- Name: auth_account_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_user_id ON public.auth_account USING btree (user_id);


--
-- Name: auth_session_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_user_id ON public.auth_session USING btree (user_id);


--
-- Name: auth_verification_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_verification_identifier ON public.auth_verification USING btree (identifier);


--
-- Name: board_score_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_score_board ON public.board_score USING btree (board);


--
-- Name: book_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX book_user ON public.book USING btree (user_id, created_at);


--
-- Name: concept_edge_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX concept_edge_to ON public.concept_edge USING btree (to_id, type);


--
-- Name: concept_review_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX concept_review_due ON public.concept_review USING btree (user_id, due);


--
-- Name: content_item_canonical_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_item_canonical_url ON public.content_item USING btree (canonical_url);


--
-- Name: content_item_duplicate_of; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_item_duplicate_of ON public.content_item USING btree (duplicate_of) WHERE (duplicate_of IS NOT NULL);


--
-- Name: content_item_metadata_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_item_metadata_key ON public.content_item USING btree (public.item_title_key(title), (((published_at AT TIME ZONE 'UTC'::text))::date));


--
-- Name: daily_challenge_question_by_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_challenge_question_by_question ON public.daily_challenge_question USING btree (question_id);


--
-- Name: device_push_token_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_push_token_user ON public.device_push_token USING btree (user_id);


--
-- Name: explainer_listen_finished; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX explainer_listen_finished ON public.explainer_listen USING btree (user_id, finished_at DESC) WHERE (finished_at IS NOT NULL);


--
-- Name: fair_play_flag_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fair_play_flag_pending ON public.fair_play_flag USING btree (created_at) WHERE (decision IS NULL);


--
-- Name: fair_play_flag_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fair_play_flag_user ON public.fair_play_flag USING btree (user_id);


--
-- Name: follow_followee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX follow_followee ON public.follow USING btree (followee_id);


--
-- Name: game_match_ghost_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_match_ghost_run ON public.game_match USING btree (ghost_run_id) WHERE (ghost_run_id IS NOT NULL);


--
-- Name: game_match_player_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_match_player_user ON public.game_match_player USING btree (user_id);


--
-- Name: game_match_question_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_match_question_question ON public.game_match_question USING btree (question_id);


--
-- Name: ghost_run_pick; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghost_run_pick ON public.ghost_run USING btree (mode, recorded_at);


--
-- Name: ghost_run_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghost_run_user ON public.ghost_run USING btree (user_id);


--
-- Name: guest_start_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_start_key ON public.guest_start USING btree (ip_key, created_at);


--
-- Name: item_concept_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_concept_concept ON public.item_concept USING btree (concept_id);


--
-- Name: item_feedback_user_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_feedback_user_kind ON public.item_feedback USING btree (user_id, kind);


--
-- Name: moment_concept_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moment_concept_concept ON public.moment_concept USING btree (concept_id);


--
-- Name: moment_embedding_cosine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moment_embedding_cosine ON public.moment_embedding USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: project_note_batch_item_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_note_batch_item_user ON public.project_note_batch_item USING btree (user_id);


--
-- Name: pronunciation_term; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pronunciation_term ON public.pronunciation USING btree (lower(term));


--
-- Name: push_subscription_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscription_user ON public.push_subscription USING btree (user_id);


--
-- Name: question_batch_item_moment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_batch_item_moment ON public.question_batch_item USING btree (moment_id);


--
-- Name: question_batch_item_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_batch_item_question ON public.question_batch_item USING btree (question_id);


--
-- Name: question_batch_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_batch_open ON public.question_batch USING btree (submitted_at) WHERE (closed_at IS NULL);


--
-- Name: question_flag_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_flag_question ON public.question_flag USING btree (question_id);


--
-- Name: question_one_per_chapter_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX question_one_per_chapter_slot ON public.question USING btree (book_chapter_id, ordinal) WHERE (book_chapter_id IS NOT NULL);


--
-- Name: question_one_per_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX question_one_per_slot ON public.question USING btree (moment_id, kind, ordinal) WHERE (status <> 'retired'::public.question_status);


--
-- Name: question_review_by_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_review_by_question ON public.question_review USING btree (question_id, reason);


--
-- Name: question_review_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX question_review_one_open ON public.question_review USING btree (question_id) WHERE (decision IS NULL);


--
-- Name: question_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_status_created ON public.question USING btree (status, created_at);


--
-- Name: quiz_answer_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quiz_answer_one_open ON public.quiz_answer USING btree (attempt_id) WHERE (answered_at IS NULL);


--
-- Name: quiz_answer_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_answer_question ON public.quiz_answer USING btree (question_id) WHERE (correct IS NOT NULL);


--
-- Name: quiz_attempt_book_chapter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_attempt_book_chapter ON public.quiz_attempt USING btree (book_chapter_id) WHERE (book_chapter_id IS NOT NULL);


--
-- Name: quiz_attempt_match_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_attempt_match_pending ON public.quiz_attempt USING btree (user_id) WHERE ((match_id IS NOT NULL) AND (evidence_applied_at IS NULL));


--
-- Name: quiz_attempt_one_daily; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quiz_attempt_one_daily ON public.quiz_attempt USING btree (user_id, daily_day) WHERE (daily_day IS NOT NULL);


--
-- Name: quiz_attempt_one_open_book_checkpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quiz_attempt_one_open_book_checkpoint ON public.quiz_attempt USING btree (user_id, book_chapter_id) WHERE ((book_chapter_id IS NOT NULL) AND (finished_at IS NULL));


--
-- Name: quiz_attempt_one_open_checkpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quiz_attempt_one_open_checkpoint ON public.quiz_attempt USING btree (user_id, path_section_id) WHERE ((path_section_id IS NOT NULL) AND (finished_at IS NULL));


--
-- Name: quiz_attempt_one_open_review; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quiz_attempt_one_open_review ON public.quiz_attempt USING btree (user_id) WHERE (review AND (finished_at IS NULL));


--
-- Name: quiz_attempt_one_open_sprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quiz_attempt_one_open_sprint ON public.quiz_attempt USING btree (user_id, estimation) WHERE (sprint AND (finished_at IS NULL));


--
-- Name: quiz_attempt_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_attempt_section ON public.quiz_attempt USING btree (path_section_id) WHERE (path_section_id IS NOT NULL);


--
-- Name: quiz_attempt_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_attempt_user ON public.quiz_attempt USING btree (user_id, started_at);


--
-- Name: rating_history_user_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rating_history_user_at ON public.rating_history USING btree (user_id, at);


--
-- Name: reason_report_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reason_report_item ON public.reason_report USING btree (content_item_id);


--
-- Name: source_next_poll_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_next_poll_at ON public.source USING btree (next_poll_at) WHERE active;


--
-- Name: starter_feed_entry_article; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX starter_feed_entry_article ON public.starter_feed_entry USING btree (topic, level, chip, content_item_id) WHERE (moment_id IS NULL);


--
-- Name: starter_feed_entry_moment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX starter_feed_entry_moment ON public.starter_feed_entry USING btree (topic, level, chip, moment_id) WHERE (moment_id IS NOT NULL);


--
-- Name: tts_sample_one_pick; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tts_sample_one_pick ON public.tts_sample USING btree (run, script_no) WHERE (picked_at IS NOT NULL);


--
-- Name: university_listed_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX university_listed_key ON public.university USING btree (name, country) WHERE listed;


--
-- Name: university_typed_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX university_typed_key ON public.university USING btree (lower(name)) WHERE (NOT listed);


--
-- Name: user_feed_entry_article; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_feed_entry_article ON public.user_feed_entry USING btree (user_id, chip, content_item_id) WHERE (moment_id IS NULL);


--
-- Name: user_feed_entry_moment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_feed_entry_moment ON public.user_feed_entry USING btree (user_id, chip, moment_id) WHERE (moment_id IS NOT NULL);


--
-- Name: user_note_by_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_by_user ON public.user_note USING btree (user_id, updated_at DESC);


--
-- Name: user_note_one_per_article; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_note_one_per_article ON public.user_note USING btree (user_id, content_item_id) WHERE ((moment_id IS NULL) AND (section_title IS NULL));


--
-- Name: user_note_one_per_section; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_note_one_per_section ON public.user_note USING btree (user_id, moment_id) WHERE (moment_id IS NOT NULL);


--
-- Name: user_path_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_path_one_active ON public.user_path USING btree (user_id) WHERE (status = 'active'::public.user_path_status);


--
-- Name: concept_edge concept_edge_acyclic; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER concept_edge_acyclic BEFORE INSERT OR UPDATE ON public.concept_edge FOR EACH ROW EXECUTE FUNCTION public.refuse_prerequisite_cycle();


--
-- Name: concept concept_never_deleted; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER concept_never_deleted BEFORE DELETE ON public.concept FOR EACH ROW EXECUTE FUNCTION public.refuse_concept_delete();


--
-- Name: content_item content_item_excerpt_rights; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER content_item_excerpt_rights BEFORE INSERT OR UPDATE ON public.content_item FOR EACH ROW EXECUTE FUNCTION public.enforce_excerpt_rights();


--
-- Name: content_item_private_text content_item_private_text_rights; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER content_item_private_text_rights BEFORE INSERT OR UPDATE ON public.content_item_private_text FOR EACH ROW EXECUTE FUNCTION public.enforce_private_text_rights();


--
-- Name: content_item_section content_item_section_rights; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER content_item_section_rights BEFORE INSERT OR UPDATE ON public.content_item_section FOR EACH ROW EXECUTE FUNCTION public.enforce_private_text_rights();


--
-- Name: content_item content_item_simhash_rights; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER content_item_simhash_rights BEFORE INSERT OR UPDATE OF simhash ON public.content_item FOR EACH ROW EXECUTE FUNCTION public.enforce_simhash_rights();


--
-- Name: moment moment_rights; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moment_rights BEFORE INSERT OR UPDATE ON public.moment FOR EACH ROW EXECUTE FUNCTION public.enforce_moment_rights();


--
-- Name: source source_purge_text_beyond_profile; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER source_purge_text_beyond_profile AFTER UPDATE OF rights_profile, moments_enabled ON public.source FOR EACH ROW WHEN (((old.rights_profile IS DISTINCT FROM new.rights_profile) OR (old.moments_enabled IS DISTINCT FROM new.moments_enabled))) EXECUTE FUNCTION public.purge_text_beyond_profile();


--
-- Name: user_capability user_capability_unlimited_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_capability_unlimited_only BEFORE INSERT OR UPDATE ON public.user_capability FOR EACH ROW EXECUTE FUNCTION public.refuse_limited_grant();


--
-- Name: agent_device agent_device_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_device
    ADD CONSTRAINT agent_device_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: agent_place agent_place_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_place
    ADD CONSTRAINT agent_place_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: agent_task agent_task_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.agent_device(id) ON DELETE CASCADE;


--
-- Name: agent_task agent_task_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: ai_usage ai_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: app_user app_user_invite_code_id_beta_group_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_invite_code_id_beta_group_fkey FOREIGN KEY (invite_code_id, beta_group) REFERENCES public.invite_code(id, beta_group);


--
-- Name: app_user app_user_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plan(id);


--
-- Name: auth_account auth_account_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: auth_session auth_session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: board_score board_score_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_score
    ADD CONSTRAINT board_score_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.quiz_attempt(id) ON DELETE CASCADE;


--
-- Name: book_chapter book_chapter_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter
    ADD CONSTRAINT book_chapter_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.book(id) ON DELETE CASCADE;


--
-- Name: book_chapter_checkpoint book_chapter_checkpoint_chapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter_checkpoint
    ADD CONSTRAINT book_chapter_checkpoint_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.book_chapter(id) ON DELETE CASCADE;


--
-- Name: book_chapter_concept book_chapter_concept_chapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter_concept
    ADD CONSTRAINT book_chapter_concept_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.book_chapter(id) ON DELETE CASCADE;


--
-- Name: book_chapter_concept book_chapter_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chapter_concept
    ADD CONSTRAINT book_chapter_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id) ON DELETE CASCADE;


--
-- Name: book_page book_page_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_page
    ADD CONSTRAINT book_page_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.book(id) ON DELETE CASCADE;


--
-- Name: book_position book_position_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_position
    ADD CONSTRAINT book_position_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.book(id) ON DELETE CASCADE;


--
-- Name: book_position book_position_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_position
    ADD CONSTRAINT book_position_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.book_session(id) ON DELETE CASCADE;


--
-- Name: book_session book_session_chapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_session
    ADD CONSTRAINT book_session_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.book_chapter(id) ON DELETE CASCADE;


--
-- Name: book_session_finished book_session_finished_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_session_finished
    ADD CONSTRAINT book_session_finished_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.book_session(id) ON DELETE CASCADE;


--
-- Name: book book_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book
    ADD CONSTRAINT book_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: concept_edge concept_edge_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_edge
    ADD CONSTRAINT concept_edge_from_id_fkey FOREIGN KEY (from_id) REFERENCES public.concept(id);


--
-- Name: concept_edge concept_edge_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_edge
    ADD CONSTRAINT concept_edge_to_id_fkey FOREIGN KEY (to_id) REFERENCES public.concept(id);


--
-- Name: concept_embedding concept_embedding_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_embedding
    ADD CONSTRAINT concept_embedding_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id) ON DELETE CASCADE;


--
-- Name: concept_explainer_attempt concept_explainer_attempt_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explainer_attempt
    ADD CONSTRAINT concept_explainer_attempt_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: concept_explainer concept_explainer_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explainer
    ADD CONSTRAINT concept_explainer_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: concept_explainer concept_explainer_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explainer
    ADD CONSTRAINT concept_explainer_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: concept_mastery concept_mastery_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_mastery
    ADD CONSTRAINT concept_mastery_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: concept_mastery concept_mastery_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_mastery
    ADD CONSTRAINT concept_mastery_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: concept concept_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept
    ADD CONSTRAINT concept_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.concept(id);


--
-- Name: concept_review concept_review_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_review
    ADD CONSTRAINT concept_review_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: concept_review concept_review_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_review
    ADD CONSTRAINT concept_review_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: content_item content_item_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item
    ADD CONSTRAINT content_item_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.content_item(id) ON DELETE SET NULL;


--
-- Name: content_item_private_text content_item_private_text_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item_private_text
    ADD CONSTRAINT content_item_private_text_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: content_item_section content_item_section_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item_section
    ADD CONSTRAINT content_item_section_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: content_item content_item_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item
    ADD CONSTRAINT content_item_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: continue_dismissal continue_dismissal_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.continue_dismissal
    ADD CONSTRAINT continue_dismissal_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: continue_dismissal continue_dismissal_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.continue_dismissal
    ADD CONSTRAINT continue_dismissal_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: daily_challenge_question daily_challenge_question_day_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_challenge_question
    ADD CONSTRAINT daily_challenge_question_day_fkey FOREIGN KEY (day) REFERENCES public.daily_challenge(day) ON DELETE CASCADE;


--
-- Name: daily_challenge_question daily_challenge_question_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_challenge_question
    ADD CONSTRAINT daily_challenge_question_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(id) ON DELETE CASCADE;


--
-- Name: device_push_token device_push_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_token
    ADD CONSTRAINT device_push_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: explainer_audio explainer_audio_explainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_audio
    ADD CONSTRAINT explainer_audio_explainer_id_fkey FOREIGN KEY (explainer_id) REFERENCES public.concept_explainer(id);


--
-- Name: explainer_listen explainer_listen_explainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_listen
    ADD CONSTRAINT explainer_listen_explainer_id_fkey FOREIGN KEY (explainer_id) REFERENCES public.concept_explainer(id) ON DELETE CASCADE;


--
-- Name: explainer_listen explainer_listen_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_listen
    ADD CONSTRAINT explainer_listen_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: explainer_scene_attempt explainer_scene_attempt_explainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_scene_attempt
    ADD CONSTRAINT explainer_scene_attempt_explainer_id_fkey FOREIGN KEY (explainer_id) REFERENCES public.concept_explainer(id) ON DELETE CASCADE;


--
-- Name: explainer_scene explainer_scene_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_scene
    ADD CONSTRAINT explainer_scene_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: explainer_scene explainer_scene_explainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explainer_scene
    ADD CONSTRAINT explainer_scene_explainer_id_fkey FOREIGN KEY (explainer_id) REFERENCES public.concept_explainer(id) ON DELETE CASCADE;


--
-- Name: fair_play_flag fair_play_flag_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fair_play_flag
    ADD CONSTRAINT fair_play_flag_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: fair_play_flag fair_play_flag_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fair_play_flag
    ADD CONSTRAINT fair_play_flag_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.game_match(id) ON DELETE CASCADE;


--
-- Name: fair_play_flag fair_play_flag_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fair_play_flag
    ADD CONSTRAINT fair_play_flag_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: feed_note feed_note_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_note
    ADD CONSTRAINT feed_note_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: follow follow_followee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow
    ADD CONSTRAINT follow_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: follow follow_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow
    ADD CONSTRAINT follow_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: game_match game_match_ghost_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match
    ADD CONSTRAINT game_match_ghost_run_id_fkey FOREIGN KEY (ghost_run_id) REFERENCES public.ghost_run(id) ON DELETE SET NULL;


--
-- Name: game_match_player game_match_player_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match_player
    ADD CONSTRAINT game_match_player_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.game_match(id) ON DELETE CASCADE;


--
-- Name: game_match_player game_match_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match_player
    ADD CONSTRAINT game_match_player_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: game_match game_match_problem_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match
    ADD CONSTRAINT game_match_problem_slug_fkey FOREIGN KEY (problem_slug) REFERENCES public.lld_problem(slug);


--
-- Name: game_match_question game_match_question_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match_question
    ADD CONSTRAINT game_match_question_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.game_match(id) ON DELETE CASCADE;


--
-- Name: game_match_question game_match_question_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match_question
    ADD CONSTRAINT game_match_question_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(id);


--
-- Name: game_match game_match_winner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_match
    ADD CONSTRAINT game_match_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: ghost_run ghost_run_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_run
    ADD CONSTRAINT ghost_run_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.game_match(id) ON DELETE CASCADE;


--
-- Name: ghost_run ghost_run_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_run
    ADD CONSTRAINT ghost_run_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: github_account github_account_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_account
    ADD CONSTRAINT github_account_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: github_dependency github_dependency_user_id_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_dependency
    ADD CONSTRAINT github_dependency_user_id_repo_id_fkey FOREIGN KEY (user_id, repo_id) REFERENCES public.github_repository(user_id, repo_id) ON DELETE CASCADE;


--
-- Name: github_installation github_installation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_installation
    ADD CONSTRAINT github_installation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.github_account(user_id) ON DELETE CASCADE;


--
-- Name: github_reachable_repository github_reachable_repository_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_reachable_repository
    ADD CONSTRAINT github_reachable_repository_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.github_account(user_id) ON DELETE CASCADE;


--
-- Name: github_repository github_repository_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_repository
    ADD CONSTRAINT github_repository_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.github_account(user_id) ON DELETE CASCADE;


--
-- Name: item_concept item_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_concept
    ADD CONSTRAINT item_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: item_concept item_concept_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_concept
    ADD CONSTRAINT item_concept_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.item_tagging(content_item_id) ON DELETE CASCADE;


--
-- Name: item_concept_probability item_concept_probability_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_concept_probability
    ADD CONSTRAINT item_concept_probability_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id) ON DELETE CASCADE;


--
-- Name: item_concept_probability item_concept_probability_content_item_id_model_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_concept_probability
    ADD CONSTRAINT item_concept_probability_content_item_id_model_fkey FOREIGN KEY (content_item_id, model) REFERENCES public.item_decision(content_item_id, model) ON DELETE CASCADE;


--
-- Name: item_decision item_decision_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_decision
    ADD CONSTRAINT item_decision_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: item_embedding item_embedding_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_embedding
    ADD CONSTRAINT item_embedding_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: item_feedback item_feedback_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_feedback
    ADD CONSTRAINT item_feedback_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: item_feedback item_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_feedback
    ADD CONSTRAINT item_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: item_tagging item_tagging_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tagging
    ADD CONSTRAINT item_tagging_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: listen_queue listen_queue_explainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listen_queue
    ADD CONSTRAINT listen_queue_explainer_id_fkey FOREIGN KEY (explainer_id) REFERENCES public.concept_explainer(id) ON DELETE CASCADE;


--
-- Name: listen_queue listen_queue_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listen_queue
    ADD CONSTRAINT listen_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: moment_boundary_override moment_boundary_override_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_boundary_override
    ADD CONSTRAINT moment_boundary_override_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: moment_concept moment_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_concept
    ADD CONSTRAINT moment_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: moment_concept moment_concept_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_concept
    ADD CONSTRAINT moment_concept_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment_tagging(moment_id) ON DELETE CASCADE;


--
-- Name: moment_concept_probability moment_concept_probability_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_concept_probability
    ADD CONSTRAINT moment_concept_probability_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id) ON DELETE CASCADE;


--
-- Name: moment_concept_probability moment_concept_probability_moment_id_model_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_concept_probability
    ADD CONSTRAINT moment_concept_probability_moment_id_model_fkey FOREIGN KEY (moment_id, model) REFERENCES public.moment_decision(moment_id, model) ON DELETE CASCADE;


--
-- Name: moment moment_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment
    ADD CONSTRAINT moment_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: moment_decision moment_decision_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_decision
    ADD CONSTRAINT moment_decision_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: moment_embedding moment_embedding_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_embedding
    ADD CONSTRAINT moment_embedding_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: moment_tagging moment_tagging_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moment_tagging
    ADD CONSTRAINT moment_tagging_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: path_section_concept path_section_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_section_concept
    ADD CONSTRAINT path_section_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: path_section_concept path_section_concept_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_section_concept
    ADD CONSTRAINT path_section_concept_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.path_section(id) ON DELETE CASCADE;


--
-- Name: path_section path_section_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_section
    ADD CONSTRAINT path_section_path_id_fkey FOREIGN KEY (path_id) REFERENCES public.path(id) ON DELETE CASCADE;


--
-- Name: path_session path_session_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_session
    ADD CONSTRAINT path_session_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: path_session path_session_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.path_session
    ADD CONSTRAINT path_session_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.path_section(id) ON DELETE CASCADE;


--
-- Name: plan_capability plan_capability_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_capability
    ADD CONSTRAINT plan_capability_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plan(id);


--
-- Name: player_country player_country_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_country
    ADD CONSTRAINT player_country_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: player_rating player_rating_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_rating
    ADD CONSTRAINT player_rating_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: player_university player_university_university_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_university
    ADD CONSTRAINT player_university_university_id_fkey FOREIGN KEY (university_id) REFERENCES public.university(id) ON DELETE SET NULL;


--
-- Name: player_university player_university_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_university
    ADD CONSTRAINT player_university_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: player_username player_username_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_username
    ADD CONSTRAINT player_username_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: project_note_batch_item project_note_batch_item_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note_batch_item
    ADD CONSTRAINT project_note_batch_item_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.question_batch(id) ON DELETE CASCADE;


--
-- Name: project_note_batch_item project_note_batch_item_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note_batch_item
    ADD CONSTRAINT project_note_batch_item_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: project_note_batch_item project_note_batch_item_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note_batch_item
    ADD CONSTRAINT project_note_batch_item_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: project_note project_note_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note
    ADD CONSTRAINT project_note_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: project_note project_note_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_note
    ADD CONSTRAINT project_note_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.github_account(user_id) ON DELETE CASCADE;


--
-- Name: pronunciation pronunciation_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pronunciation
    ADD CONSTRAINT pronunciation_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: push_preference push_preference_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_preference
    ADD CONSTRAINT push_preference_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: push_sent push_sent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_sent
    ADD CONSTRAINT push_sent_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: push_subscription push_subscription_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscription
    ADD CONSTRAINT push_subscription_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: question_batch_item question_batch_item_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_batch_item
    ADD CONSTRAINT question_batch_item_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.question_batch(id) ON DELETE CASCADE;


--
-- Name: question_batch_item question_batch_item_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_batch_item
    ADD CONSTRAINT question_batch_item_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: question_batch_item question_batch_item_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_batch_item
    ADD CONSTRAINT question_batch_item_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(id) ON DELETE CASCADE;


--
-- Name: question question_book_chapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question
    ADD CONSTRAINT question_book_chapter_id_fkey FOREIGN KEY (book_chapter_id) REFERENCES public.book_chapter(id) ON DELETE CASCADE;


--
-- Name: question_concept question_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_concept
    ADD CONSTRAINT question_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: question_concept question_concept_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_concept
    ADD CONSTRAINT question_concept_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(id) ON DELETE CASCADE;


--
-- Name: question_drafting question_drafting_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_drafting
    ADD CONSTRAINT question_drafting_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: question_estimate_drafted question_estimate_drafted_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_estimate_drafted
    ADD CONSTRAINT question_estimate_drafted_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: question_flag question_flag_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_flag
    ADD CONSTRAINT question_flag_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(id) ON DELETE CASCADE;


--
-- Name: question_flag question_flag_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_flag
    ADD CONSTRAINT question_flag_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: question question_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question
    ADD CONSTRAINT question_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: question_review question_review_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_review
    ADD CONSTRAINT question_review_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(id) ON DELETE CASCADE;


--
-- Name: quiz_answer quiz_answer_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answer
    ADD CONSTRAINT quiz_answer_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.quiz_attempt(id) ON DELETE CASCADE;


--
-- Name: quiz_answer quiz_answer_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answer
    ADD CONSTRAINT quiz_answer_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt quiz_attempt_book_chapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_book_chapter_id_fkey FOREIGN KEY (book_chapter_id) REFERENCES public.book_chapter(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt_concept quiz_attempt_concept_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt_concept
    ADD CONSTRAINT quiz_attempt_concept_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.quiz_attempt(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt_concept quiz_attempt_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt_concept
    ADD CONSTRAINT quiz_attempt_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id);


--
-- Name: quiz_attempt quiz_attempt_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt quiz_attempt_daily_day_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_daily_day_fkey FOREIGN KEY (daily_day) REFERENCES public.daily_challenge(day);


--
-- Name: quiz_attempt quiz_attempt_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.game_match(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt quiz_attempt_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt quiz_attempt_path_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_path_section_id_fkey FOREIGN KEY (path_section_id) REFERENCES public.path_section(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt quiz_attempt_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: rating_history rating_history_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.game_match(id) ON DELETE CASCADE;


--
-- Name: rating_history rating_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: reason_report reason_report_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_report
    ADD CONSTRAINT reason_report_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: reason_report reason_report_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_report
    ADD CONSTRAINT reason_report_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: season_standing season_standing_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.season_standing
    ADD CONSTRAINT season_standing_season_fkey FOREIGN KEY (season) REFERENCES public.season_close(season) ON DELETE CASCADE;


--
-- Name: season_standing season_standing_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.season_standing
    ADD CONSTRAINT season_standing_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: starter_feed_entry starter_feed_entry_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.starter_feed_entry
    ADD CONSTRAINT starter_feed_entry_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: starter_feed_entry starter_feed_entry_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.starter_feed_entry
    ADD CONSTRAINT starter_feed_entry_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: starter_feed_entry starter_feed_entry_moment_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.starter_feed_entry
    ADD CONSTRAINT starter_feed_entry_moment_item FOREIGN KEY (moment_id, content_item_id) REFERENCES public.moment(id, content_item_id) ON DELETE CASCADE;


--
-- Name: starter_feed_entry starter_feed_entry_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.starter_feed_entry
    ADD CONSTRAINT starter_feed_entry_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.feed_note(id) ON DELETE SET NULL;


--
-- Name: tag_override tag_override_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_override
    ADD CONSTRAINT tag_override_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: technology_concept technology_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_concept
    ADD CONSTRAINT technology_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concept(id) ON DELETE CASCADE;


--
-- Name: technology_concept technology_concept_technology_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_concept
    ADD CONSTRAINT technology_concept_technology_id_fkey FOREIGN KEY (technology_id) REFERENCES public.technology(id) ON DELETE CASCADE;


--
-- Name: technology_package technology_package_technology_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_package
    ADD CONSTRAINT technology_package_technology_id_fkey FOREIGN KEY (technology_id) REFERENCES public.technology(id) ON DELETE CASCADE;


--
-- Name: technology_suggestion technology_suggestion_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.technology_suggestion
    ADD CONSTRAINT technology_suggestion_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: tts_sample tts_sample_picked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tts_sample
    ADD CONSTRAINT tts_sample_picked_by_fkey FOREIGN KEY (picked_by) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: user_article_finished user_article_finished_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_article_finished
    ADD CONSTRAINT user_article_finished_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: user_article_finished user_article_finished_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_article_finished
    ADD CONSTRAINT user_article_finished_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_capability user_capability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_capability
    ADD CONSTRAINT user_capability_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_explore_open user_explore_open_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_explore_open
    ADD CONSTRAINT user_explore_open_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: user_explore_open user_explore_open_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_explore_open
    ADD CONSTRAINT user_explore_open_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_feed_entry user_feed_entry_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_entry
    ADD CONSTRAINT user_feed_entry_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: user_feed_entry user_feed_entry_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_entry
    ADD CONSTRAINT user_feed_entry_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: user_feed_entry user_feed_entry_moment_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_entry
    ADD CONSTRAINT user_feed_entry_moment_item FOREIGN KEY (moment_id, content_item_id) REFERENCES public.moment(id, content_item_id) ON DELETE CASCADE;


--
-- Name: user_feed_entry user_feed_entry_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_entry
    ADD CONSTRAINT user_feed_entry_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.feed_note(id) ON DELETE SET NULL;


--
-- Name: user_feed_entry user_feed_entry_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_entry
    ADD CONSTRAINT user_feed_entry_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_feed_state user_feed_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feed_state
    ADD CONSTRAINT user_feed_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_hidden_source user_hidden_source_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_hidden_source
    ADD CONSTRAINT user_hidden_source_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: user_hidden_source user_hidden_source_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_hidden_source
    ADD CONSTRAINT user_hidden_source_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_inferred_reset user_inferred_reset_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_inferred_reset
    ADD CONSTRAINT user_inferred_reset_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_moment_finished user_moment_finished_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_moment_finished
    ADD CONSTRAINT user_moment_finished_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: user_moment_finished user_moment_finished_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_moment_finished
    ADD CONSTRAINT user_moment_finished_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_moment_opened user_moment_opened_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_moment_opened
    ADD CONSTRAINT user_moment_opened_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: user_moment_opened user_moment_opened_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_moment_opened
    ADD CONSTRAINT user_moment_opened_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_note user_note_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note
    ADD CONSTRAINT user_note_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: user_note user_note_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note
    ADD CONSTRAINT user_note_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE SET NULL;


--
-- Name: user_note user_note_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note
    ADD CONSTRAINT user_note_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_path user_path_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path
    ADD CONSTRAINT user_path_path_id_fkey FOREIGN KEY (path_id) REFERENCES public.path(id) ON DELETE CASCADE;


--
-- Name: user_path_section user_path_section_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_section
    ADD CONSTRAINT user_path_section_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.path_section(id) ON DELETE CASCADE;


--
-- Name: user_path_section user_path_section_user_id_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_section
    ADD CONSTRAINT user_path_section_user_id_path_id_fkey FOREIGN KEY (user_id, path_id) REFERENCES public.user_path(user_id, path_id) ON DELETE CASCADE;


--
-- Name: user_path_session user_path_session_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_session
    ADD CONSTRAINT user_path_session_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moment(id) ON DELETE CASCADE;


--
-- Name: user_path_session user_path_session_section_id_ordinal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_session
    ADD CONSTRAINT user_path_session_section_id_ordinal_fkey FOREIGN KEY (section_id, ordinal) REFERENCES public.path_session(section_id, ordinal) ON DELETE CASCADE;


--
-- Name: user_path_session user_path_session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path_session
    ADD CONSTRAINT user_path_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_path user_path_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_path
    ADD CONSTRAINT user_path_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_save user_save_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_save
    ADD CONSTRAINT user_save_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_item(id) ON DELETE CASCADE;


--
-- Name: user_save user_save_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_save
    ADD CONSTRAINT user_save_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261025000000'),
    ('20261025010000'),
    ('20261025020000'),
    ('20261025030000'),
    ('20261025040000'),
    ('20261025050000'),
    ('20261025060000'),
    ('20261025060100'),
    ('20261026000000'),
    ('20261026010000'),
    ('20261026020000'),
    ('20261026030000'),
    ('20261026040000'),
    ('20261026050000'),
    ('20261026060000'),
    ('20261026070000'),
    ('20261026080000'),
    ('20261026090000'),
    ('20261026100000'),
    ('20261026110000'),
    ('20261026120000'),
    ('20261026130000'),
    ('20261026140000'),
    ('20261026150000'),
    ('20261026160000'),
    ('20261026170000'),
    ('20261026180000'),
    ('20261026190000'),
    ('20261026200000'),
    ('20261026210000'),
    ('20261026220000'),
    ('20261026230000'),
    ('20261026235000'),
    ('20261027000000'),
    ('20261027010000'),
    ('20261027020000'),
    ('20261027030000'),
    ('20261027040000'),
    ('20261027050000'),
    ('20261027060000'),
    ('20261027070000'),
    ('20261027080000'),
    ('20261027090000'),
    ('20261027100000'),
    ('20261027110000'),
    ('20261027120000'),
    ('20261027130000'),
    ('20261027140000'),
    ('20261027150000'),
    ('20261028090000'),
    ('20261028100000'),
    ('20261028110000'),
    ('20261028120000'),
    ('20261028130000'),
    ('20261028140000'),
    ('20261028150000'),
    ('20261028160000'),
    ('20261028170000'),
    ('20261029090000'),
    ('20261029090100'),
    ('20261029100000'),
    ('20261029110000'),
    ('20261029120000'),
    ('20261029130000'),
    ('20261029140000'),
    ('20261029150000'),
    ('20261029160000'),
    ('20261029170000'),
    ('20261029180000'),
    ('20261029190000'),
    ('20261029200000'),
    ('20261029210000'),
    ('20261029220000'),
    ('20261029230000'),
    ('20261030000000'),
    ('20261031000000'),
    ('20261031000100'),
    ('20261031010000'),
    ('20261031020000'),
    ('20261031030000'),
    ('20261031040000'),
    ('20261101000000'),
    ('20261102000000'),
    ('20261102100000'),
    ('20261102200000'),
    ('20261102300000'),
    ('20261102400000'),
    ('20261102500000'),
    ('20261102600000'),
    ('20261102700000'),
    ('20261102800000'),
    ('20261102900000'),
    ('20261102950000'),
    ('20261103000000'),
    ('20261103100000'),
    ('20261103200000'),
    ('20261103300000'),
    ('20261103400000'),
    ('20261103500000'),
    ('20261103600000'),
    ('20261105000000'),
    ('20261108000000'),
    ('20261108000100'),
    ('20261109000000'),
    ('20261109010000'),
    ('20261109020000'),
    ('20261109030000'),
    ('20261109040000'),
    ('20261110000000'),
    ('20261110010000'),
    ('20261111000000'),
    ('20261111010000'),
    ('20261111020000'),
    ('20261111030000'),
    ('20261112000000'),
    ('20261113000000'),
    ('20261113010000'),
    ('20261113020000'),
    ('20261113030000'),
    ('20261113030100'),
    ('20261113040000');
