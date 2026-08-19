import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase client for route handlers and server components.
 *
 * Runs under the customer's own session, read from their cookies — not under a
 * service role. That is what makes the row level security policies in
 * supabase/schema.sql the actual access control: a route handler physically
 * cannot read or write another customer's rows, whatever it asks for.
 *
 * cookies() is async in Next 15, so this function is too.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a server component, where cookies are read-only.
            // The middleware refreshes the session instead, so this is safe
            // to swallow.
          }
        },
      },
    }
  );
}
