import { seed } from "./fixtures";

export default async function globalSetup() {
  const result = await seed();
  console.log(`[e2e] seeded workspace ${result.workspaceId} with ${result.taskIds.length} tasks`);
}
