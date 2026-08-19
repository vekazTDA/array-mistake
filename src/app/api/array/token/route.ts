import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rateLimit";

/**
 * A normal session refreshes once an hour, plus a few retries after a logout
 * event. Ten per ten minutes leaves generous headroom over that while still
 * catching a retry loop.
 */
const TOKEN_LIMIT = 10;
const TOKEN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Mints a fresh Array userToken for the signed-in customer.
 *
 * This is the only place the Array server token is used, and the reason a
 * backend exists at all: the server token must never reach the browser.
 *
 * The customer is identified by their own session, not by anything the
 * client sends — a caller cannot request a token for someone else.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  /**
   * Keyed on the user, after authentication — an unauthenticated caller can't
   * consume anyone's budget. This is the one route that reaches a paid third
   * party, so it's the one worth limiting first.
   *
   * See lib/rateLimit.ts: this is in-memory and per-instance, which is enough
   * for a runaway client but not for a determined one.
   */
  const limit = rateLimit(`token:${user.id}`, TOKEN_LIMIT, TOKEN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("array_user_id")
    .eq("id", user.id)
    .single();

  if (!profile?.array_user_id) {
    // Signed in with us, but hasn't completed Array enrolment yet.
    return NextResponse.json({ error: "Not enrolled." }, { status: 409 });
  }

  const ttlInMinutes = process.env.ARRAY_TOKEN_TTL_MINUTES ?? "60";

  let res: Response;
  try {
    res = await fetch(`${process.env.ARRAY_API_BASE}/api/authenticate/v2/usertoken`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-array-server-token": process.env.ARRAY_SERVER_TOKEN!,
      },
      body: JSON.stringify({
        appKey: process.env.NEXT_PUBLIC_ARRAY_APP_KEY,
        userId: profile.array_user_id,
        ttlInMinutes,
      }),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach Array." }, { status: 502 });
  }

  if (!res.ok) {
    // 401/403 here means our own credentials are wrong, not the customer's.
    // Worth alerting on rather than surfacing as a user-facing error.
    console.error("Array token regeneration failed", {
      status: res.status,
      userId: profile.array_user_id,
    });
    return NextResponse.json({ error: "Could not refresh access." }, { status: 502 });
  }

  const { userToken } = (await res.json()) as { userToken: string };

  return NextResponse.json(
    { userToken, ttlInMinutes },
    { headers: { "cache-control": "no-store" } }
  );
}
