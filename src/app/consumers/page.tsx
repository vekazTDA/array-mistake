"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Consumer = {
  id: string;
  display_name: string;
  reference: string | null;
  enrolled_at: string | null;
  created_at: string;
};

/**
 * The step between signing in and the Array form.
 *
 * One staff login covers many consumers, and each consumer's row id is their
 * Array userId. Adding someone here is what makes them a distinct Array user —
 * which is why checking a second person no longer collides with the first.
 */
export default function ConsumersPage() {
  const router = useRouter();
  const [consumers, setConsumers] = useState<Consumer[] | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/consumers");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    if (!res.ok) {
      setError("Couldn't load the list.");
      setConsumers([]);
      return;
    }
    const { consumers } = await res.json();
    setConsumers(consumers);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/consumers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, reference }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }));
      setError(error ?? "Couldn't add that person.");
      setBusy(false);
      return;
    }

    const { consumer } = await res.json();
    setDisplayName("");
    setReference("");
    setBusy(false);
    router.push(`/consumers/${consumer.id}/enroll`);
  }

  return (
    <main className="shell">
      <header className="page-head">
        <h1>Clients</h1>
        <p className="lede">
          Each person is verified with the credit bureau separately. Add them here, then
          run verification with them on the phone or in the room.
        </p>
      </header>

      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={onAdd} className="add-row">
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={120}
          />
        </label>
        <label className="field">
          <span>Reference (optional)</span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={64}
            placeholder="Matter or case number"
          />
        </label>
        <button className="button" type="submit" disabled={busy || !displayName.trim()}>
          {busy ? "Adding…" : "Add client"}
        </button>
      </form>

      {consumers === null && <p className="muted">Loading…</p>}

      {consumers?.length === 0 && (
        <p className="muted">No clients yet. Add the first one above.</p>
      )}

      {consumers && consumers.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Reference</th>
              <th scope="col">Status</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {consumers.map((c) => (
              <tr key={c.id}>
                <td>{c.display_name}</td>
                <td className="muted">{c.reference ?? "—"}</td>
                <td>
                  {c.enrolled_at ? (
                    <span className="pill pill--ok">Verified</span>
                  ) : (
                    <span className="pill">Not verified</span>
                  )}
                </td>
                <td className="right">
                  <Link
                    className="button button--quiet"
                    href={
                      c.enrolled_at
                        ? `/consumers/${c.id}/dashboard`
                        : `/consumers/${c.id}/enroll`
                    }
                  >
                    {c.enrolled_at ? "View credit" : "Verify"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
