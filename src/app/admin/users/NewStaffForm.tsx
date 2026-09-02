"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StaffUser = {
  id: string;
  full_name: string | null;
  role: string;
  created_at: string;
};

export default function NewStaffForm({ initialUsers }: { initialUsers: StaffUser[] }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"staff" | "super_admin">("staff");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, fullName, role }),
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok && res.status !== 207) {
      setError(payload?.error ?? "Couldn't create the account.");
      setBusy(false);
      return;
    }

    if (res.status === 207) {
      setNotice(`Account created, but ${payload?.error ?? "the role update failed"}`);
    } else {
      setNotice(`Account created for ${email}. Share the password with them directly.`);
    }

    setEmail("");
    setFullName("");
    setPassword("");
    setRole("staff");
    setBusy(false);
    router.refresh();

    // Refresh the list from the server rather than guessing the new row's
    // shape locally.
    const listRes = await fetch("/api/admin/users");
    if (listRes.ok) {
      const { users } = await listRes.json();
      setUsers(users);
    }
  }

  return (
    <>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="add-row">
        <label className="field">
          <span>Full name</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "staff" | "super_admin")}
          >
            <option value="staff">Staff</option>
            <option value="super_admin">Super admin</option>
          </select>
        </label>
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Added</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.full_name ?? "—"}</td>
              <td>
                {u.role === "super_admin" ? (
                  <span className="pill pill--ok">Super admin</span>
                ) : (
                  <span className="pill">Staff</span>
                )}
              </td>
              <td className="muted">{new Date(u.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
