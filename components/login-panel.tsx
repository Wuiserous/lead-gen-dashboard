"use client";

import { useState } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AppRole } from "@/lib/types";

function homeFor(role: AppRole) {
  if (role === "admin") return "/admin";
  if (role === "team_lead") return "/team";
  return "/sales";
}

export function LoginPanel() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserSupabase();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setError("The email or password is incorrect.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/me", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.user) {
      await supabase.auth.signOut();
      setError(result.error ?? "This account is not active.");
      setLoading(false);
      return;
    }

    router.replace(
      result.user.must_change_password
        ? "/change-password"
        : homeFor(result.user.role),
    );
    router.refresh();
  }

  return (
    <div className="login-card">
      <span className="eyebrow">EMPLOYEE PORTAL</span>
      <h2>Welcome back</h2>
      <p className="muted">
        Sign in with the credentials issued by your Persevex Admin.
      </p>

      <form onSubmit={submit} className="stack-form">
        <label>
          Work email
          <span className="input-shell">
            <Mail size={18} />
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@persevex.com"
              required
            />
          </span>
        </label>
        <label>
          Password
          <span className="input-shell">
            <LockKeyhole size={18} />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </span>
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button wide" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in securely"}
          {!loading && <ArrowRight size={18} />}
        </button>
      </form>

      <p className="login-help">
        Students and Campus Ambassadors do not sign in here.
      </p>
    </div>
  );
}
