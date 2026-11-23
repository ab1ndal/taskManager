"use server";

import { assertHouseholdWorkspace, assertWorkspaceMember, requireUser } from "@/lib/auth";
import type { ActionResult } from "@/app/tasks/action-result";
import { run } from "@/app/tasks/action-run";
import { parseInput } from "@/app/tasks/schemas";
import type { CategorySlug } from "./categories";
import { categoryForUnknownName } from "./category-decision";
import { suggestGroceryCategorySchema, type SuggestGroceryCategoryInput } from "./schemas";

/** Public action used to prefill a new pantry item's selector before the person saves it. */
export async function suggestGroceryCategory(
  input: SuggestGroceryCategoryInput,
): Promise<ActionResult<{ category: CategorySlug }>> {
  return run("suggestGroceryCategory", async () => {
    const { user } = await requireUser();
    const { workspaceId, name } = parseInput(suggestGroceryCategorySchema, input);
    await assertWorkspaceMember(workspaceId, user.id);
    await assertHouseholdWorkspace(workspaceId);
    return { category: await categoryForUnknownName(workspaceId, name) ?? "pantry" };
  });
}
