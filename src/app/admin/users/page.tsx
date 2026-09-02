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

  const admin = createAdminClient();
  const { data: users } = await admin
    .from("profiles")
    .select("id, full_name, role, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="shell">
      <header className="page-head">
        <h1>Staff</h1>
        <p className="lede">Accounts that can sign in and check client credit.</p>
      </header>

      <NewStaffForm initialUsers={users ?? []} />
    </main>
  );
}
