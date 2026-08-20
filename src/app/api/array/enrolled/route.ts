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
 * The write goes through record_consumer_enrolment(), which sets
 * array_user_id from the consumer's own row and enforces ownership. This route
 * cannot map a consumer to the wrong Array account even if it wanted to.
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
   * The enrol page passes the consumer's own row id to Array, so what comes
   * back should be identical. This no longer guards anything — the database
   * derives the mapping itself — but a mismatch means Array and this app
   * disagree about who someone is, which is worth knowing about early.
   *
   * Skipped when the caller sends no userId: it is a consistency check on
   * Array's response, not an authorisation check on the caller.
   */
  if (typeof body.userId === "string" && body.userId !== consumerId) {
    console.error("Array returned a userId that isn't the consumer's", {
      consumerId,
      theirs: body.userId,
    });
    return NextResponse.json(
      {
        error: `Array returned userId ${body.userId}, expected ${consumerId}.`,
      },
      { status: 409 }
    );
  }

  const { error } = await supabase.rpc("record_consumer_enrolment", {
    p_consumer_id: consumerId,
  });

  if (error) {
    console.error("Failed to record enrolment", { consumerId, error: error.message });
    // P0002 is the function's "consumer not found", which also covers
    // "not yours".
    const status = error.code === "P0002" ? 404 : 500;
    return NextResponse.json({ error: "Could not record enrolment." }, { status });
  }

  return NextResponse.json({ ok: true });
}
