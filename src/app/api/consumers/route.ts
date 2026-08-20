import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 2048;
const MAX_NAME_LENGTH = 120;
const MAX_REFERENCE_LENGTH = 64;

/**
 * The consumers a staff member has added.
 *
 * RLS scopes this to owner_id = auth.uid(), so there is no filter to forget
 * here — the query physically cannot return another account's rows.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("consumers")
    .select("id, display_name, reference, enrolled_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to list consumers", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "Could not load consumers." }, { status: 500 });
  }

  return NextResponse.json({ consumers: data ?? [] });
}

/**
 * Adds a consumer.
 *
 * The new row's id becomes this person's Array userId. That is why every
 * consumer is a distinct Array user, and why Array's create-user endpoint no
 * longer returns 409 on the second person checked from one login.
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

  let body: { displayName?: unknown; reference?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim().slice(0, MAX_NAME_LENGTH) : "";

  if (!displayName) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }

  const reference =
    typeof body.reference === "string" && body.reference.trim()
      ? body.reference.trim().slice(0, MAX_REFERENCE_LENGTH)
      : null;

  const { data, error } = await supabase
    .from("consumers")
    .insert({ owner_id: user.id, display_name: displayName, reference })
    .select("id, display_name, reference, enrolled_at, created_at")
    .single();

  if (error) {
    console.error("Failed to create consumer", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "Could not add consumer." }, { status: 500 });
  }

  return NextResponse.json({ consumer: data }, { status: 201 });
}
