import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 2048;

/**
 * Records that a consumer completed Array enrolment.
 *
 * Called from the enrol page when Array dispatches its "signup" event. That
 * event's metadata also carries a userToken — deliberately not sent here.
 * Tokens are minted server-side by /api/array/token; a token that arrived from
 * the browser is not something this app should trust or store.
 *
 * The userId in that metadata IS the value we store. Array does not adopt the
 * id we supply to array-account-enroll — that one behaves as an external
 * reference Array requires to be unique. The id it returns is Array's own, and
 * it is what the token endpoint expects.
 *
 * record_consumer_enrolment() enforces ownership, writes once, and relies on a
 * unique index so one Array user cannot be claimed by two consumers.
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

  let body: { consumerId?: unknown; userId?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  if (typeof body.consumerId !== "string" || !body.consumerId) {
    return NextResponse.json({ error: "consumerId is required." }, { status: 400 });
  }
  const consumerId = body.consumerId;

  /**
   * Array's own userId, from the signup event. Without it there is nothing to
   * mint a token against later, so this is required rather than advisory —
   * an earlier version treated a difference from our consumer id as an error,
   * which rejected every real enrolment.
   */
  if (typeof body.userId !== "string" || !body.userId.trim()) {
    console.error("Signup event carried no Array userId", { consumerId });
    return NextResponse.json(
      { error: "Array did not return a userId." },
      { status: 422 }
    );
  }
  const arrayUserId = body.userId.trim();

  const { error } = await supabase.rpc("record_consumer_enrolment", {
    p_consumer_id: consumerId,
    p_array_user_id: arrayUserId,
  });

  if (error) {
    console.error("Failed to record enrolment", {
      consumerId,
      arrayUserId,
      code: error.code,
      error: error.message,
    });

    // P0002 = consumer not found, which also covers "not yours".
    // 23505 = already mapped to a different Array user, or that Array user is
    //         already claimed by another consumer.
    const status = error.code === "P0002" ? 404 : error.code === "23505" ? 409 : 500;
    const message =
      error.code === "23505"
        ? "This person is already linked to a different Array record."
        : "Could not record enrolment.";
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
