import { createAdminClient } from "@/lib/supabase/admin";
import { assertNoError } from "@/app/tasks/action-run";
import { GROCERY_CATEGORIES, isCategorySlug, type CategorySlug } from "./categories";
import { suggestCategory } from "./category-suggest";
import { mapOpenAiTimeout, openAiHttpError, OPENAI_TIMEOUT_MS, requireOpenAiKey } from "./openai-errors";

const DECISIONS_URL = "https://api.openai.com/v1/decisions";

const CHOICE_DESCRIPTIONS: Record<CategorySlug, string> = {
  produce: "Fresh fruits, vegetables, and herbs.",
  dairy: "Milk, yogurt, cheese, paneer, eggs, tofu, and refrigerated substitutes.",
  baked: "Bread, buns, roti, tortillas, and other bakery items.",
  frozen: "Food sold or kept frozen.",
  dals: "Dals, dried or canned beans, lentils, and legumes.",
  grains: "Atta and other flours, rice, grains, and dry pasta.",
  spices: "Whole or ground spices, masalas, salt, and seasoning blends.",
  condiments: "Sauces, oils, pickles, chutneys, spreads, and dressings.",
  nuts: "Nuts, seeds, and dried fruit.",
  snacks: "Packaged snacks, namkeen, sweets, desserts, and candy.",
  beverages: "Tea, coffee, drink mixes, juices, soda, and other drinks.",
  pantry: "Baking supplies and shelf-stable food that fits no more specific category.",
  household: "Cleaning, paper, personal-care, and other non-food household supplies.",
};

/**
 * Category suggestion order: deterministic local vocabulary, a saved model answer, then one typed
 * Decisions API choice. A saved answer means the same normalized name is never sent twice.
 */
export async function categoryForUnknownName(
  workspaceId: string,
  name: string,
): Promise<CategorySlug | null> {
  const local = suggestCategory(name);
  if (local) return local;

  const normalizedName = name.trim().toLowerCase();
  const admin = createAdminClient();
  const { data: saved, error: loadError } = await admin
    .from("grocery_category_suggestions")
    .select("category")
    .eq("workspace_id", workspaceId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();
  assertNoError("load grocery category suggestion", { error: loadError });
  if (saved && isCategorySlug(String(saved.category))) return saved.category as CategorySlug;

  const category = await requestCategoryDecision(name);
  const { error: saveError } = await admin.from("grocery_category_suggestions").insert({
    workspace_id: workspaceId,
    normalized_name: normalizedName,
    category,
  });
  // A concurrent request may have won the primary key race; either answer is already a valid slug.
  if (saveError?.code !== "23505") assertNoError("save grocery category suggestion", { error: saveError });
  return category;
}

async function requestCategoryDecision(name: string): Promise<CategorySlug> {
  const timeout = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireOpenAiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: name,
        questions: [{
          type: "choice",
          name: "category",
          instructions: "Classify this grocery or household item for a vegetarian Indian household in the US.",
          choices: GROCERY_CATEGORIES.map(({ slug }) => ({
            value: slug,
            description: CHOICE_DESCRIPTIONS[slug],
          })),
        }],
      }),
      signal: timeout,
    });
    if (!response.ok) throw openAiHttpError("category decision", response.status, await response.text());
    const body = await response.json() as { answers?: Array<{ type?: unknown; name?: unknown; choice?: unknown }> };
    const answer = body.answers?.find((item) => item.type === "choice" && item.name === "category");
    if (!answer || typeof answer.choice !== "string" || !isCategorySlug(answer.choice)) {
      throw new Error("OpenAI category decision returned no valid category");
    }
    return answer.choice;
  } catch (error) {
    throw mapOpenAiTimeout("category decision", error, timeout);
  }
}
