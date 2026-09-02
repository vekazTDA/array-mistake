import { createClient } from "@/lib/supabase/server";

export type AuthzResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 };

/**
 * Confirms the caller is signed in AND has role = 'super_admin'.
 *
 * Deliberately uses the ordinary session-scoped client, not the admin one —
 * checking "who is this and what is their role" is exactly what row level
 * security is for, and profiles: read own already permits a user to read
 * their own role. There is no reason for this check itself to bypass RLS.
 *
 * The admin client (lib/supabase/admin.ts) should only be reached AFTER this
 * returns ok: true.
 */
export async function requireSuperAdmin(): Promise<AuthzResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, status: 401 };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "super_admin") return { ok: false, status: 403 };

  return { ok: true, userId: user.id };
}
