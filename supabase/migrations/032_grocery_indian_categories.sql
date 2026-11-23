-- Grocery categories for a vegetarian Indian household in the US.
--
-- Production data (2026-11-22) showed about half of all items filed under 'pantry', because a new
-- item defaults there when the category is left alone. Pantry has no shelf-life estimate, so milk,
-- spinach and paneer-adjacent staples carried no expiry at all. The nine original groups also had no
-- home for dals, atta and rice, masalas versus sauces, or dry fruits — each a shelf of its own in
-- this kitchen and an aisle at the Indian store.
--
-- Additive only: every existing slug stays valid, so the app version still deployed while this runs
-- keeps working. Four slugs are new: dals, grains, condiments, nuts. Labels live in
-- src/app/groceries/categories.ts, which must list exactly these slugs (categories.test.ts checks).

alter table public.grocery_items drop constraint grocery_items_category;

alter table public.grocery_items add constraint grocery_items_category
  check (category in ('produce','dairy','baked','frozen','dals','grains','spices','condiments',
                      'nuts','snacks','beverages','pantry','household'));
