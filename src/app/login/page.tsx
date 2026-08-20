"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

/**
 * Our own accounts, not array-account-login.
 *
 * Using Array's login component would mean a second, separate login. Staff
 * sign in here once and work through their client list.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }

      /**
       * With "Confirm email" enabled, signUp returns a user but no session —
       * nothing is signed in until the link is clicked. Say so, rather than
       * pushing on to /consumers where they'd be bounced straight back here
       * with no explanation.
       */
      if (!data.session) {
        setNotice("Check your email for a confirmation link, then sign in.");
        setMode("signin");
        setBusy(false);
        return;
      }

      router.push("/consumers");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    router.push("/consumers");
  }

  return (
    <main className="shell shell--narrow">
      <header className="page-head">
        <h1>{mode === "signin" ? "Sign in" : "Create your account"}</h1>
        <p className="lede">
          {mode === "signin"
            ? "Client credit reports are behind this login."
            : "You'll add the clients whose credit you check in the next step."}
        </p>
      </header>

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

      <form onSubmit={onSubmit}>
        {mode === "signup" && (
          <label className="field">
            <span>Full name</span>
            <input
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>

        <button className="button" type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "signin" ? "Create an account instead" : "I already have an account"}
        </button>
      </p>
    </main>
  );
}
