-- Cache model classifications separately from grocery_items so opening and cancelling the pantry
-- dialog does not ask OpenAI again for the same name. Only server actions may read or write this
-- table; household members reach it through the membership-checked action.
create table public.grocery_category_suggestions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  normalized_name text not null,
  category text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, normalized_name),
  constraint grocery_category_suggestions_name_normalized
    check (normalized_name = lower(btrim(normalized_name)) and length(normalized_name) between 1 and 100),
  constraint grocery_category_suggestions_category
    check (category in ('produce','dairy','baked','frozen','dals','grains','spices','condiments',
                        'nuts','snacks','beverages','pantry','household'))
);

alter table public.grocery_category_suggestions enable row level security;
revoke all on table public.grocery_category_suggestions from public, anon, authenticated;
grant select, insert on table public.grocery_category_suggestions to service_role;
