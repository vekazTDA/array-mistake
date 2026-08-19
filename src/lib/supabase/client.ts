"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in client components.
 *
 * The publishable key is safe in the browser: every table has row level
 * security enabled, so it can only reach rows the signed-in customer owns.
 * The secret key is deliberately not available here — see .env.local.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
