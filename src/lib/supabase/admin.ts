import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * The one Supabase client in this project that bypasses row level security.
 *
 * "server-only" makes any accidental import of this file from client code
 * fail the build, rather than silently shipping SUPABASE_SERVICE_ROLE_KEY to
 * the browser. That is the actual protection here — a code review catching
 * a stray import is not something to depend on.
 *
 * This client is instantiated fresh per call and never held in a module-level
 * singleton exported elsewhere, so there is exactly one way to reach it: call
 * this function from inside a route that has already run requireSuperAdmin().
 *
 * Every route that calls this MUST check the caller is a super_admin FIRST,
 * using the ordinary session-scoped client (see lib/authz.ts). This client
 * has no concept of "who is calling" — it can read and write anything.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Required for /api/admin routes only."
    );
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
