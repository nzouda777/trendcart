/*
 * Runs once when the server starts, before any request is handled.
 *
 * Local development only: when DATABASE_URL starts with "pglite:", open the
 * embedded PGlite database and apply migrations (lib/db/dev-pglite.ts). The
 * branch is compiled out of production builds (NODE_ENV is inlined), so
 * PGlite never reaches the production bundle.
 */
export async function register() {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("pglite:")) return;

  const { openDevDatabase } = await import("./lib/db/dev-pglite");
  await openDevDatabase(url);
}
