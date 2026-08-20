import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHash } from "crypto";
import { rateLimit } from "@/lib/rateLimit";

const MAX_BODY_BYTES = 2048;

/**
 * A normal session refreshes once an hour, plus a few retries after a logout
 * event. Ten per ten minutes leaves generous headroom over that while still
 * catching a retry loop. Keyed per consumer, since staff legitimately switch
 * between several in one sitting.
 */
const TOKEN_LIMIT = 10;
const TOKEN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Mints a fresh Array userToken for one consumer.
 *
 * This is the only place the Array server token is used, and the reason a
 * backend exists at all: the server token must never reach the browser.
 *
 * This route takes a consumerId, which reintroduces a parameter that used to
 * be derived from the session. The protection moved rather than disappeared:
 * the lookup runs under the staff member's own session, so RLS
 * (owner_id = auth.uid()) scopes it. Another account's consumer id matches no
 * row and returns 404 — it cannot produce a token.
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

  let body: { consumerId?: unknown };
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
   * Rate limited after authentication, so an unauthenticated caller can't
   * consume anyone's budget. This is the one route that reaches a paid third
   * party, so it's the one worth limiting first.
   *
   * See lib/rateLimit.ts: in-memory and per-instance, enough for a runaway
   * client but not for a determined one.
   */
  const limit = rateLimit(`token:${user.id}:${consumerId}`, TOKEN_LIMIT, TOKEN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }

  const { data: consumer } = await supabase
    .from("consumers")
    .select("array_user_id")
    .eq("id", consumerId)
    .maybeSingle();

  if (!consumer) {
    // Either no such consumer, or not this account's. Deliberately the same
    // response for both.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!consumer.array_user_id) {
    return NextResponse.json({ error: "Not enrolled." }, { status: 409 });
  }

  /**
   * Sent as a number. It was previously forwarded straight from the
   * environment as a string, which is a plausible cause of a 400 from Array
   * and costs nothing to rule out.
   */
  const ttlInMinutes = Number(process.env.ARRAY_TOKEN_TTL_MINUTES ?? 60);

  /**
   * Array allowlists source IPs, and Vercel serverless has no static outbound
   * address — the same credential returns 200 from the office and 403 from a
   * deployment. When ARRAY_RELAY_URL is set, this call goes through a relay
   * running at the allowlisted location instead of straight to Array.
   *
   * Opt-in by environment so nothing has to change here the day Array
   * allowlists a permanent egress address: clear the variable and the request
   * goes direct again. See relay/server.mjs.
   */
  const relayUrl = process.env.ARRAY_RELAY_URL;
  const target = relayUrl || `${process.env.ARRAY_API_BASE}/api/authenticate/v2/usertoken`;

  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // The relay passes this through rather than holding it, so the
        // credential never rests on the relay machine.
        "x-array-server-token": process.env.ARRAY_SERVER_TOKEN!,
        ...(relayUrl ? { "x-relay-secret": process.env.ARRAY_RELAY_SECRET ?? "" } : {}),
      },
      body: JSON.stringify({
        appKey: process.env.NEXT_PUBLIC_ARRAY_APP_KEY,
        userId: consumer.array_user_id,
        ttlInMinutes,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Covers the relay being offline, which is the failure mode this setup
    // adds: the office machine going down takes the dashboard with it.
    console.error("Could not reach Array", { viaRelay: Boolean(relayUrl) });
    return NextResponse.json({ error: "Could not reach Array." }, { status: 502 });
  }

  if (!res.ok) {
    /**
     * A rejection here is ours, not the consumer's — wrong credentials, an
     * unknown userId, or a malformed body. Array's own response body says
     * which, so log it: a bare status code turns every failure into a
     * guessing exercise.
     *
     * Truncated, and server-side only. Nothing we send Array is echoed back
     * in an error body, but the cap means a surprise can't dump anything
     * large into the log either.
     */
    const detail = await res.text().catch(() => "<unreadable>");

    /**
     * A 403 has two very different causes and they need separating: the wrong
     * server token deployed to this environment, or a credential that is fine
     * but coming from an IP Array does not allow.
     *
     * This logs a one-way fingerprint of the token, never the token. Compare
     * the length and hash against the local value to tell whether the two
     * environments hold the same secret. If they match, the credential is not
     * the problem and the rejection is about where the request came from.
     */
    const token = process.env.ARRAY_SERVER_TOKEN ?? "";
    const fingerprint = token
      ? `len=${token.length} sha256=${createHash("sha256").update(token).digest("hex").slice(0, 12)}`
      : "MISSING — ARRAY_SERVER_TOKEN is not set in this environment";

    console.error("Array token regeneration failed", {
      /**
       * Which build produced this line. Vercel sets VERCEL_GIT_COMMIT_SHA
       * automatically. Without it there is no way to tell from a log whether
       * you are reading current code or an older deployment that was
       * redeployed on top of it — a redeploy rebuilds that commit, not latest
       * main, and the two are easy to confuse in the dashboard.
       */
      build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      viaRelay: Boolean(relayUrl),
      status: res.status,
      statusText: res.statusText,
      arrayUserId: consumer.array_user_id,
      arrayResponse: detail.slice(0, 500),
      serverTokenFingerprint: fingerprint,
      // Which of the three open questions this points at.
      likelyCause:
        res.status === 401 || res.status === 403
          ? "credential or source IP refused — compare serverTokenFingerprint with the local value to tell which"
          : res.status === 404
            ? "Array does not recognise this userId"
            : res.status === 400
              ? "Array rejected the request body"
              : "unexpected",
    });

    return NextResponse.json({ error: "Could not refresh access." }, { status: 502 });
  }

  const { userToken } = (await res.json()) as { userToken: string };

  return NextResponse.json(
    { userToken, ttlInMinutes },
    { headers: { "cache-control": "no-store" } }
  );
}
