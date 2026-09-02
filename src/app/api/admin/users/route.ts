import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BODY_BYTES = 2048;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Lists staff accounts.
 *
 * profiles: read own only permits reading your own row, so a super admin
 * listing everyone genuinely needs the elevated client — that is what makes
 * this an /api/admin route rather than a plain one.
 */
export async function GET() {
  const authz = await requireSuperAdmin();
  if (!authz.ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: authz.status });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to list staff", { error: error.message });
    return NextResponse.json({ error: "Could not load staff." }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}

/**
 * Creates a staff account with the password the caller supplies.
 *
 * auth.admin.createUser() is the one place in this codebase that needs the
 * service role — there is no way to create a fully-formed, password-set,
 * confirmed account for someone else through the public client. email_confirm
 * is set true because this account was vetted by a human super admin, not by
 * an email round-trip.
 *
 * The trigger in schema.sql (handle_new_user) fires on this exactly as it
 * does on a normal signup and creates the matching profiles row with role
 * defaulted to 'staff'. If the caller asked for super_admin, that is applied
 * as a second, explicit update — never passed through as user-controlled
 * input to the row the trigger creates.
 */
export async function POST(request: Request) {
  const authz = await requireSuperAdmin();
  if (!authz.ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: authz.status });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large." }, { status: 413 });
  }

  let body: { email?: unknown; password?: unknown; fullName?: unknown; role?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const role = body.role === "super_admin" ? "super_admin" : "staff";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });

  if (createError || !created.user) {
    console.error("Failed to create staff account", {
      email,
      error: createError?.message,
    });
    // Supabase's own message ("A user with this email address has already
    // been registered") is safe to relay — no secret in it.
    const status = createError?.status ?? 500;
    return NextResponse.json(
      { error: createError?.message ?? "Could not create account." },
      { status }
    );
  }

  if (role === "super_admin") {
    const { error: roleError } = await admin
      .from("profiles")
      .update({ role: "super_admin" })
      .eq("id", created.user.id);

    if (roleError) {
      // The account exists at this point; failing to set the role is a data
      // problem worth surfacing, not a reason to pretend creation failed.
      console.error("Account created but role update failed", {
        userId: created.user.id,
        error: roleError.message,
      });
      return NextResponse.json(
        { error: "Account created, but could not set super_admin. Set it manually." },
        { status: 207 }
      );
    }
  }

  return NextResponse.json(
    { user: { id: created.user.id, email, role } },
    { status: 201 }
  );
}
