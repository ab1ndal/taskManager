-- Phase 07 Task 1 — is pg_cron usable on this project?
-- Run against task-manager-dev. Rolls back: proves the extension can be created without leaving it.
begin;

select name, default_version, installed_version
from pg_available_extensions
where name = 'pg_cron';

create extension if not exists pg_cron;

select extname, extversion from pg_extension where extname = 'pg_cron';

-- The scheduler will need this schema to exist and be callable.
select has_schema_privilege(current_user, 'cron', 'usage') as can_use_cron;

rollback;
