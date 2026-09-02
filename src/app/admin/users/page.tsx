import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import NewStaffForm from "./NewStaffForm";

/**
 * Where staff accounts are created.
 *
 * Self-service signup is gone — see login/page.tsx. Every staff account now
 * starts here, created by a super admin with a password they set directly.
 */
export default async function AdminUsersPage() {
  const authz = await requireSuperAdmin();

  if (!authz.ok) {
    redirect(authz.status === 401 ? "/login" : "/consumers");
  }

  /**
   * createAdminClient() throws synchronously if SUPABASE_SERVICE_ROLE_KEY is
   * missing from this environment. Uncaught in a Server Component, that
   * produces the generic "Application error: a server-side exception has
   * occurred" screen with only a digest — exactly what happened here once,
   * when the key existed in .env.local but wasn't actually present on Vercel.
   * Rendering a real message instead means the failure is diagnosable from
   * the screen itself, not just from server logs nobody's looking at yet.
   */
  let configError = false;
  let users: { id: string; full_name: string | null; role: string; created_at: string }[] = [];

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at", { ascending: false });
    users = data ?? [];
  } catch (err) {
    console.error("Admin client unavailable", { error: err instanceof Error ? err.message : err });
    configError = true;
  }

  return (
    <main className="shell">
      <header className="page-head">
        <h1>Staff</h1>
        <p className="lede">Accounts that can sign in and check client credit.</p>
      </header>

      {configError ? (
        <p className="notice notice--error" role="alert">
          Admin access is misconfigured — SUPABASE_SERVICE_ROLE_KEY is missing from this
          environment. Check the deployment&rsquo;s environment variables.
        </p>
      ) : (
        <NewStaffForm initialUsers={users} />
      )}
    </main>
  );
}
