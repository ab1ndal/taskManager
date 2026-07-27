import { teardown } from "./fixtures";

export default async function globalTeardown() {
  await teardown();
  console.log("[e2e] seeded rows and test users removed");
}
