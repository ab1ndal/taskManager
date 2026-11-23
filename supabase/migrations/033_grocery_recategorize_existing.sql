-- One-time recategorisation of existing grocery items into the categories added in 032.
--
-- Built from the production item list on 2026-11-22. About half of it sat in 'pantry' only because
-- an untouched selector defaulted there, which also cost those items any expiry estimate. Each row
-- below names a product and the category it belongs in; names are matched case- and
-- whitespace-insensitively, the same way the unique name index compares them.
--
-- Scope and safety:
--   * Household workspaces only — groceries are a household feature.
--   * A row is only touched when its category actually differs, so re-running is a no-op.
--   * Categories only. Stock rows (quantity, expiry) are left exactly as they are: back-dating an
--     estimate onto milk bought weeks ago would mark it expired. New stock gets the right estimate
--     from now on.
--   * A name that does not exist in a workspace simply matches nothing.

update public.grocery_items g
set category = m.category
from (values
  -- Dairy, eggs & tofu: fridge staples previously in pantry.
  ('milk', 'dairy'), ('eggs', 'dairy'), ('tofu', 'dairy'), ('tempeh', 'dairy'),
  ('cream cheese', 'dairy'), ('ricotta cheese', 'dairy'), ('parmesan cheese', 'dairy'),
  ('pepper jack', 'dairy'), ('khoya', 'dairy'),

  -- Fruits & vegetables.
  ('spinach', 'produce'), ('onion', 'produce'), ('carrot', 'produce'), ('cauliflower', 'produce'),
  ('apples', 'produce'), ('blackberry', 'produce'), ('pomegranate', 'produce'), ('salad', 'produce'),
  ('coconut', 'produce'), ('curry leaves', 'produce'),

  -- Bread & bakery.
  ('bread', 'baked'), ('white bread', 'baked'), ('tortilla bread', 'baked'), ('garlic bread', 'baked'),

  -- Frozen.
  ('icecream', 'frozen'), ('vegetable gyoza', 'frozen'), ('frozen vegetables', 'frozen'),

  -- Dals, beans & lentils.
  ('moong daal', 'dals'), ('moong split', 'dals'), ('toor daal', 'dals'), ('kala chana', 'dals'),
  ('kabuli chana', 'dals'), ('garbanzo bean', 'dals'), ('kidney beans', 'dals'),
  ('small white beans', 'dals'), ('horse gram', 'dals'),

  -- Atta, rice & grains (flours and pasta were filed under bakery).
  ('wheat flour', 'grains'), ('besan aata', 'grains'), ('jowar aata', 'grains'),
  ('bajra aata', 'grains'), ('sorghum flour', 'grains'), ('semolina flour', 'grains'),
  ('rice', 'grains'), ('poha', 'grains'), ('quinoa', 'grains'), ('couscous', 'grains'),
  ('pasta', 'grains'), ('quaker overnight oats', 'grains'), ('overnight oats (packets)', 'grains'),

  -- Masalas & spices.
  ('salt', 'spices'), ('cinnamon', 'spices'), ('cardamon', 'spices'), ('kesar', 'spices'),
  ('idli powder', 'spices'),

  -- Sauces, pickles & chutneys (condiments were mostly in pantry).
  ('ketchup', 'condiments'), ('soy sauce', 'condiments'), ('olives', 'condiments'),
  ('homemade chutney', 'condiments'), ('tamarind chutney', 'condiments'),
  ('sriracha chutney', 'condiments'), ('schezwan chutney', 'condiments'),
  ('ikea sauce', 'condiments'), ('white pasta sauce', 'condiments'),
  ('stir fry sauce', 'condiments'), ('teriyaki glaze', 'condiments'),
  ('thousand island dressing', 'condiments'), ('rice vinegar', 'condiments'),
  ('lemon juice', 'condiments'), ('better than bouillon', 'condiments'),
  ('ikea spead', 'condiments'),

  -- Dry fruits, nuts & seeds (were snacks, or spices for raisins).
  ('walnuts', 'nuts'), ('pista', 'nuts'), ('pistachio', 'nuts'), ('cashew', 'nuts'),
  ('badam packet', 'nuts'), ('fox nut', 'nuts'), ('resins', 'nuts'), ('pitted date', 'nuts'),
  ('medjool date', 'nuts'), ('flax seeds', 'nuts'), ('shredded coconut', 'nuts'),

  -- Snacks, namkeen & sweets.
  ('plain papad', 'snacks'), ('boondi', 'snacks'), ('dhana daal', 'snacks'),
  ('garlic naan cracker', 'snacks'), ('breadsticks', 'snacks'), ('crispy crêpe', 'snacks'),
  ('french butter cookies', 'snacks'), ('chocolate covered espresso beans', 'snacks'),
  ('dark chocolate coconut cups', 'snacks'), ('bushard chocolate', 'snacks'),

  -- Chai, coffee & drinks.
  ('coke', 'beverages'), ('coffee', 'beverages'),

  -- Baking & other pantry (sugar was under bakery, sweeteners under spices, curry roux under dairy).
  ('brown sugar', 'pantry'), ('regular sugar', 'pantry'), ('vanilla sweetner', 'pantry'),
  ('shisho sweetner', 'pantry'), ('pandan sweetener', 'pantry'), ('japanese curry', 'pantry'),

  -- Household items that were filed as food.
  ('bedsheet', 'household'), ('elmer school glue', 'household')
) as m(name, category)
where lower(btrim(g.name)) = m.name
  and g.category is distinct from m.category
  and exists (
    select 1 from public.workspaces w where w.id = g.workspace_id and w.kind = 'household'
  );
