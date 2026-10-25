-- migrate:up
create extension if not exists vector;

create table schema_meta (
  key text primary key,
  value text not null
);

insert into schema_meta (key, value) values ('initial_migration', '20261025000000');

-- migrate:down
drop table schema_meta;

drop extension if exists vector;
