/**
 * Deliberately not a "use client" module — this runs on both sides.
 *
 * This is the first of two passes, and the skippable one. The pass that
 * actually enforces the rule is redact_array_metadata() in
 * supabase/002_security_lockdown.sql, which runs inside the only function
 * permitted to insert into array_events. Nothing reaches that table without
 * going through it.
 *
 * An earlier version of this comment claimed the route handler's pass was
 * unskippable. It wasn't: the browser could insert into array_events directly
 * under the old RLS policy, bypassing this file entirely.
 */

/**
 * Strip anything credential- or identity-shaped before an event goes anywhere
 * it might be persisted or logged.
 *
 * Array puts userToken directly in signup and KBA success metadata. The
 * identity fields are here because the schema's central promise is that no
 * SSN or date of birth ever reaches this database — metadata is the one
 * free-form path that could carry one in.
 */
const SENSITIVE_KEYS = new Set([
  "usertoken",
  "user-token",
  "user_token",
  "authtoken",
  "auth-token",
  "auth_token",
  "accesstoken",
  "access-token",
  "access_token",
  "refreshtoken",
  "idtoken",
  "token",
  "apikey",
  "api_key",
  "appkey",
  "secret",
  "password",
  "passwd",
  "ssn",
  "socialsecuritynumber",
  "social_security_number",
  "dob",
  "dateofbirth",
  "date_of_birth",
  "birthdate",
  "birthday",
]);

function isSensitive(key: string) {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z_-]/g, ""));
}

/**
 * Recurses into objects *and* arrays.
 *
 * An earlier version skipped arrays, so `{ events: [{ userToken: "…" }] }`
 * passed the key check untouched — the denylist only ever saw the key
 * "events". Array's metadata is flat today, which is exactly why this is the
 * kind of gap that survives until a component version changes shape.
 */
function redactValue(value: unknown, depth: number): unknown {
  if (depth > 4) return null;

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    return redactMetadata(value as Record<string, unknown>, depth + 1);
  }

  return value;
}

export function redactMetadata(
  metadata: Record<string, unknown> = {},
  depth = 0
): Record<string, unknown> {
  if (depth > 4) return {};

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !isSensitive(key))
      .map(([key, value]) => [key, redactValue(value, depth)])
  );
}
