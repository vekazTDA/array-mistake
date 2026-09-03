import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Permanently removes a client.
 *
 * Plain RLS ("consumers: delete own") scopes this — there is no ownership
 * check to write here, the query physically cannot touch another account's
 * row. .select() on the delete is what lets a caller tell "deleted" apart
 * from "no such row" / "not yours": both look identical from the client's
 * side, so both return 404 rather than a silent 200 doing nothing.
 *
 * This does not touch anything at Array. If the client was already verified,
 * their real identity is on file there regardless of what happens to this
 * row — see the confirmation copy in consumers/page.tsx.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("consumers")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to delete consumer", { userId: user.id, consumerId: id, error: error.message });
    return NextResponse.json({ error: "Could not delete client." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
