import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Enough for { "userId": "<uuid>" } several times over. */
const MAX_BODY_BYTES = 2048;

/**
 * Records that a customer completed Array enrolment.
 *
 * Called from the enrol page when Array dispatches its "signup" event. That
 * event's metadata also carries a userToken — deliberately not sent here.
 * Tokens are minted server-side by /api/array/token; a token that arrived from
 * the browser is not something this app should trust or store.
 *
 * The write goes through record_array_enrolment(), a SECURITY DEFINER function
 * that sets array_user_id from auth.uid() itself. This route cannot influence
 * which Array account gets mapped to which customer even if it wanted to —
 * there is no argument to get wrong. See supabase/002_security_lockdown.sql.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large." }, { status: 413 });
  }

  let body: { userId?: unknown } = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Malformed body." }, { status: 400 });
    }
  }

  /**
   * The enrol page passes our own Supabase user id to Array, so what comes
   * back should be identical. This no longer guards anything — the database
   * derives the mapping itself — but a mismatch means Array and this app
   * disagree about who someone is, which is worth knowing about early.
   *
   * Note it is skipped entirely when the caller sends no userId. That is
   * intentional: it is a consistency check on Array's response, not an
   * authorisation check on the caller.
   */
  if (typeof body.userId === "string" && body.userId !== user.id) {
    console.error("Array returned a userId that isn't ours", {
      ours: user.id,
      theirs: body.userId,
    });
    return NextResponse.json({ error: "Identity mismatch." }, { status: 409 });
  }

  const { error } = await supabase.rpc("record_array_enrolment");

  if (error) {
    console.error("Failed to record enrolment", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "Could not record enrolment." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
