/**
 * The identifier the running deployment was built from.
 *
 * `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is inlined into the client bundle at build time and read
 * from the environment on the server at request time, so a client left open across a deploy holds
 * the old value while the server reports the new one. That difference is the update signal.
 *
 * Outside Vercel the variable is unset and every caller sees `development`, so the comparison is
 * always equal and nothing reloads.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "development";
