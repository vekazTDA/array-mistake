import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redactMetadata } from "@/lib/redact";

/**
 * Array's event metadata is a handful of short fields. This is generous for
 * that and still small enough that a flood of them can't fill the table.
 * record_array_event() applies its own 8KB ceiling on the metadata itself.
 */
const MAX_BODY_BYTES = 16 * 1024;

/** Component tag names and event names are both short, fixed vocabularies. */
const MAX_FIELD_LENGTH = 64;

/**
 * Appends a row to the local audit trail.
 *
 * Billing is per pull, so there needs to be a record to reconcile against
 * Array's invoice. This is also the first place to look when a customer says
 * a section didn't load.
 *
 * The insert goes through record_array_event(), which redacts server-side and
 * takes user_id from auth.uid(). Direct inserts into array_events are no
 * longer granted to anyone — the browser previously could, which made the
 * redaction here bypassable.
 *
 * Rows carry the consumer, because billing is per pull and a pull is per
 * consumer rather than per login.
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

  let body: { consumerId?: unknown; tagName?: unknown; event?: unknown; metadata?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  // Redacted here as well as in the database. This pass is convenience — it
  // keeps sensitive values out of any error path on the way down — but the
  // database's pass is the one that enforces.
  const metadata =
    typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
      ? redactMetadata(body.metadata as Record<string, unknown>)
      : {};

  const { error } = await supabase.rpc("record_array_event", {
    // Ownership of the consumer is verified inside the function, so a forged
    // id here writes nothing rather than mislabelling somebody else's pull.
    p_consumer_id: typeof body.consumerId === "string" ? body.consumerId : null,
    p_tag_name: typeof body.tagName === "string" ? body.tagName.slice(0, MAX_FIELD_LENGTH) : null,
    p_event: typeof body.event === "string" ? body.event.slice(0, MAX_FIELD_LENGTH) : null,
    p_metadata: metadata,
  });

  if (error) {
    // Auditing must never break the customer's session, so this stays quiet to
    // the caller. It does need to be alertable: a silent gap in the audit trail
    // is a billing reconciliation problem nobody notices for a month.
    console.error("Failed to write audit row", {
      userId: user.id,
      consumerId: body.consumerId,
      error: error.message,
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
